// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRegistry {
    function isActive(address agent) external view returns (bool);
    function recordFill(address agent) external;
}

// subconjunto da AggregatorV3Interface do Chainlink — feeds reais do Chainlink
// implementam isso direto, sem precisar de adaptador
interface IPriceOracle {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

/// Liquidação de RFQ: o maker assina uma Quote off-chain (EIP-712, sem gas);
/// o taker preenche chamando fillQuote diretamente, o que já conta como o
/// consentimento dele (não precisa de segunda assinatura).
contract Settlement is EIP712, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    struct Quote {
        address maker;
        address taker; // address(0) = qualquer taker registrado pode preencher
        address makerToken;
        address takerToken;
        uint256 makerAmount;
        uint256 takerAmount;
        uint256 expiry;
        uint256 nonce;
    }

    bytes32 private constant QUOTE_TYPEHASH = keccak256(
        "Quote(address maker,address taker,address makerToken,address takerToken,uint256 makerAmount,uint256 takerAmount,uint256 expiry,uint256 nonce)"
    );

    // assinatura EIP-2612 opcional pra evitar a tx de approve separada antes do fill;
    // deadline == 0 é o sinal de "sem permit" (taker já tem allowance pelo jeito
    // convencional) — só o taker usa isso hoje porque é quem faz o fill esporádico;
    // o maker, por operar continuamente, já mantém allowance permanente ao Settlement
    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    IRegistry public immutable registry;

    // false até o owner configurar oráculo/tetos e ativar explicitamente — evita
    // lançar em produção esquecendo de travar os limites de risco
    bool public tradingEnabled;

    mapping(address => mapping(uint256 => bool)) public usedNonces;

    struct OracleConfig {
        address oracle;
        uint8 decimalsA; // decimais de tokenA, cacheados no momento do cadastro
        uint8 decimalsB; // decimais de tokenB, cacheados no momento do cadastro
    }

    // par de token => oráculo Chainlink (obrigatório: sem oráculo cadastrado — em
    // nenhuma das duas ordens — o par não pode ser negociado). Cadastrar (tokenA,
    // tokenB) já libera negociação nos dois sentidos: fillQuote busca a ordem exata
    // primeiro e cai pra ordem invertida se não achar, sem precisar cadastrar as duas.
    mapping(address => mapping(address => OracleConfig)) public oracleConfig;
    uint256 public maxPriceDeviationBps = 500; // 5%
    uint256 public constant MAX_PRICE_DEVIATION_BPS = 2000; // teto de 20%, mesma lógica do MAX_FEE_BPS
    uint256 public maxOracleStaleness = 1 hours;

    uint256 public rateLimitWindow = 60;
    uint256 public maxTradesPerWindow = 20;
    mapping(address => uint256) public windowStart;
    mapping(address => uint256) public tradesInWindow;

    // teto de risco: por token, quanto pode mover numa única troca e no total dentro da janela
    mapping(address => uint256) public maxTradeAmount;
    mapping(address => uint256) public maxVolumePerWindow;
    uint256 public volumeWindowDuration = 1 days;
    mapping(address => uint256) public volumeWindowStart;
    mapping(address => uint256) public volumeInWindow;

    // taxa por troca (padrão Uniswap: cobrada uma vez, no lado que o taker paga) — tira
    // o "grátis" de esgotar o teto de volume via wash trading entre identidades sybil
    // do mesmo atacante. 0 por padrão; precisa ser configurada explicitamente (junto
    // com feeRecipient) antes do lançamento. 30 bps (0,3%) é o valor testado pela
    // Uniswap em produção há anos — bom ponto de partida.
    uint256 public feeBps;
    uint256 public constant MAX_FEE_BPS = 1000; // teto de 10%, contra fee absurda por engano
    address public feeRecipient;

    event QuoteFilled(
        address indexed maker,
        address indexed taker,
        address makerToken,
        address takerToken,
        uint256 makerAmount,
        uint256 takerAmount,
        uint256 nonce
    );

    constructor(address _registry) EIP712("AgentRFQSettlement", "1") Ownable(msg.sender) {
        require(_registry != address(0), "Settlement: zero registry");
        registry = IRegistry(_registry);
    }

    function setPriceOracle(address tokenA, address tokenB, address oracle) external onlyOwner {
        oracleConfig[tokenA][tokenB] = OracleConfig({
            oracle: oracle, decimalsA: IERC20Metadata(tokenA).decimals(), decimalsB: IERC20Metadata(tokenB).decimals()
        });
    }

    function setRateLimit(uint256 windowSeconds, uint256 maxTrades) external onlyOwner {
        rateLimitWindow = windowSeconds;
        maxTradesPerWindow = maxTrades;
    }

    function setMaxPriceDeviationBps(uint256 bps) external onlyOwner {
        require(bps <= MAX_PRICE_DEVIATION_BPS, "Settlement: deviation too high");
        maxPriceDeviationBps = bps;
    }

    function setMaxOracleStaleness(uint256 seconds_) external onlyOwner {
        maxOracleStaleness = seconds_;
    }

    function setMaxTradeAmount(address token, uint256 amount) external onlyOwner {
        maxTradeAmount[token] = amount;
    }

    function setMaxVolumePerWindow(address token, uint256 amount) external onlyOwner {
        maxVolumePerWindow[token] = amount;
        // reinicia a janela ao reconfigurar o teto — evita reaproveitar um acumulado
        // de um período em que o teto esteve desligado (amount == 0) ou era outro valor
        volumeWindowStart[token] = block.timestamp;
        volumeInWindow[token] = 0;
    }

    function setVolumeWindowDuration(uint256 durationSeconds) external onlyOwner {
        volumeWindowDuration = durationSeconds;
    }

    function setTradingEnabled(bool enabled) external onlyOwner {
        tradingEnabled = enabled;
    }

    function setFeeBps(uint256 bps) external onlyOwner {
        require(bps <= MAX_FEE_BPS, "Settlement: fee too high");
        feeBps = bps;
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        feeRecipient = recipient;
    }

    function hashQuote(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH,
                    q.maker,
                    q.taker,
                    q.makerToken,
                    q.takerToken,
                    q.makerAmount,
                    q.takerAmount,
                    q.expiry,
                    q.nonce
                )
            )
        );
    }

    function fillQuote(Quote calldata q, bytes calldata makerSignature) external nonReentrant {
        _fillQuote(q, makerSignature, _noPermit());
    }

    // idêntico ao fillQuote, mas aplica um permit EIP-2612 do taker sobre takerToken
    // antes do fill — poupa a tx de approve separada. `permit.deadline == 0` pula o
    // permit (equivalente a chamar fillQuote direto); permit já usado ou token sem
    // suporte a EIP-2612 não derruba o fill, só é ignorado (try/catch), porque o
    // transferFrom seguinte já falha sozinho se a allowance real não for suficiente.
    // O permit só é aplicado depois de TODAS as validações em _fillQuote passarem
    // (checks-effects-interactions) — chamar permit() num q.takerToken arbitrário
    // antes de saber se a quote é sequer válida chamaria um contrato escolhido pelo
    // atacante sem necessidade.
    function fillQuoteWithPermit(Quote calldata q, bytes calldata makerSignature, PermitData calldata permit)
        external
        nonReentrant
    {
        _fillQuote(q, makerSignature, permit);
    }

    function _noPermit() internal pure returns (PermitData memory) {
        return PermitData({value: 0, deadline: 0, v: 0, r: bytes32(0), s: bytes32(0)});
    }

    function _fillQuote(Quote calldata q, bytes calldata makerSignature, PermitData memory permit) internal {
        require(tradingEnabled, "Settlement: trading not enabled");
        require(msg.sender != q.maker, "Settlement: self fill");
        require(q.makerAmount > 0 && q.takerAmount > 0, "Settlement: zero amount");
        require(registry.isActive(q.maker), "Settlement: maker inactive");
        require(registry.isActive(msg.sender), "Settlement: taker inactive");
        require(q.taker == address(0) || q.taker == msg.sender, "Settlement: quote not for this taker");
        require(block.timestamp <= q.expiry, "Settlement: quote expired");
        require(!usedNonces[q.maker][q.nonce], "Settlement: nonce used");
        require(feeBps == 0 || feeRecipient != address(0), "Settlement: fee recipient not set");

        address signer = hashQuote(q).recover(makerSignature);
        require(signer == q.maker, "Settlement: bad maker signature");

        _checkRateLimit(msg.sender);
        _checkPriceSanity(q);
        _checkAndTrackVolume(q.makerToken, q.makerAmount);
        _checkAndTrackVolume(q.takerToken, q.takerAmount);

        usedNonces[q.maker][q.nonce] = true;

        if (permit.deadline != 0) {
            try IERC20Permit(q.takerToken).permit(
                msg.sender, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s
            ) {} catch {}
        }

        IERC20(q.makerToken).safeTransferFrom(q.maker, msg.sender, q.makerAmount);
        // taxa cobrada uma vez só, no lado que o taker paga (o "input" da troca do
        // ponto de vista de quem inicia o fill) — mesmo padrão da Uniswap
        _transferWithFee(q.takerToken, msg.sender, q.maker, q.takerAmount);

        registry.recordFill(q.maker);
        registry.recordFill(msg.sender);

        emit QuoteFilled(q.maker, msg.sender, q.makerToken, q.takerToken, q.makerAmount, q.takerAmount, q.nonce);
    }

    // taxa cobrada sobre o valor bruto da perna paga pelo taker (não afeta a checagem
    // de preço nem os tetos de volume, que continuam olhando o valor combinado entre
    // as partes); o maker recebe o líquido e o feeRecipient recebe a taxa, ambos
    // puxados diretamente do taker, sem o Settlement custodiar fundo em trânsito
    function _transferWithFee(address token, address payer, address recipient, uint256 amount) internal {
        uint256 fee = (amount * feeBps) / 10000;
        uint256 net = amount - fee;
        if (net > 0) {
            IERC20(token).safeTransferFrom(payer, recipient, net);
        }
        if (fee > 0) {
            IERC20(token).safeTransferFrom(payer, feeRecipient, fee);
        }
    }

    // reseta o contador quando a janela vira, soma `amount` e devolve o total acumulado
    // — usado tanto pelo rate limit (amount=1) quanto pelo teto de volume (amount=valor
    // do trade), pra não duplicar a mesma lógica de janela deslizante em dois lugares
    function _rollingWindowConsume(
        mapping(address => uint256) storage startMap,
        mapping(address => uint256) storage counterMap,
        address key,
        uint256 duration,
        uint256 amount
    ) internal returns (uint256 total) {
        if (block.timestamp > startMap[key] + duration) {
            startMap[key] = block.timestamp;
            counterMap[key] = 0;
        }
        counterMap[key] += amount;
        return counterMap[key];
    }

    function _checkRateLimit(address agent) internal {
        uint256 total = _rollingWindowConsume(windowStart, tradesInWindow, agent, rateLimitWindow, 1);
        require(total <= maxTradesPerWindow, "Settlement: rate limit exceeded");
    }

    function _checkAndTrackVolume(address token, uint256 amount) internal {
        uint256 tradeCap = maxTradeAmount[token];
        require(tradeCap == 0 || amount <= tradeCap, "Settlement: exceeds per-trade cap");

        uint256 windowCap = maxVolumePerWindow[token];
        if (windowCap == 0) return;

        uint256 total = _rollingWindowConsume(volumeWindowStart, volumeInWindow, token, volumeWindowDuration, amount);
        require(total <= windowCap, "Settlement: token volume cap exceeded");
    }

    // sem oráculo cadastrado pro par, em nenhuma das duas ordens = par bloqueado
    // (nega por padrão, não permite por padrão)
    function _checkPriceSanity(Quote calldata q) internal view {
        OracleConfig memory cfg = oracleConfig[q.makerToken][q.takerToken];
        bool reversed = false;
        if (cfg.oracle == address(0)) {
            cfg = oracleConfig[q.takerToken][q.makerToken];
            reversed = true;
        }
        require(cfg.oracle != address(0), "Settlement: pair not listed");

        (, int256 answer,, uint256 updatedAt,) = IPriceOracle(cfg.oracle).latestRoundData();
        require(answer > 0, "Settlement: bad oracle answer");
        require(block.timestamp - updatedAt <= maxOracleStaleness, "Settlement: stale oracle");
        uint8 oracleDec = IPriceOracle(cfg.oracle).decimals();

        // se o oráculo foi cadastrado na ordem inversa (tokenA=takerToken,
        // tokenB=makerToken), decimalsA/decimalsB também estão invertidos em relação
        // a maker/taker — usa os decimais certos sem precisar de nova chamada externa
        uint8 makerDec = reversed ? cfg.decimalsB : cfg.decimalsA;
        uint8 takerDec = reversed ? cfg.decimalsA : cfg.decimalsB;

        // preço implícito da troca, normalizado pelas casas decimais de cada token antes
        // de comparar com o oráculo — sem isso, pares com decimais diferentes (ex: WETH
        // 18 vs USDC 6) dão uma comparação sem sentido. Quando invertido, o oráculo
        // representa o preço na direção oposta, então maker/taker trocam de posição na
        // fórmula em vez de tentar inverter o valor do oráculo (o que perderia precisão)
        uint256 impliedPrice = reversed
            ? (q.makerAmount * (10 ** takerDec) * (10 ** oracleDec)) / (q.takerAmount * (10 ** makerDec))
            : (q.takerAmount * (10 ** makerDec) * (10 ** oracleDec)) / (q.makerAmount * (10 ** takerDec));
        uint256 oraclePrice = uint256(answer);

        uint256 diff = impliedPrice > oraclePrice ? impliedPrice - oraclePrice : oraclePrice - impliedPrice;
        uint256 deviationBps = (diff * 10000) / oraclePrice;

        require(deviationBps <= maxPriceDeviationBps, "Settlement: price deviates from oracle");
    }
}
