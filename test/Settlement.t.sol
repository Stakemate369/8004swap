// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/Registry.sol";
import "../contracts/Settlement.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockOracle.sol";

contract SettlementTest is Test {
    Registry registry;
    Settlement settlement;
    MockERC20 weth; // 18 casas
    MockERC20 usdc; // 6 casas
    MockOracle oracle; // ETH/USD, 8 casas

    uint256 makerKey;
    uint256 takerKey;
    address maker;
    address taker;

    uint256 constant ETH_PRICE = 2000e8; // 2000 USD, 8 casas (padrão Chainlink)

    function setUp() public {
        (maker, makerKey) = makeAddrAndKey("maker");
        (taker, takerKey) = makeAddrAndKey("taker");

        registry = new Registry();
        settlement = new Settlement(address(registry));
        registry.setSettlement(address(settlement));

        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        oracle = new MockOracle(int256(ETH_PRICE), 8);

        vm.prank(maker);
        registry.registerAgent(maker, "ipfs://maker");
        vm.prank(taker);
        registry.registerAgent(taker, "ipfs://taker");

        weth.mint(maker, 1_000e18);
        usdc.mint(taker, 1_000_000e6);

        vm.prank(maker);
        weth.approve(address(settlement), type(uint256).max);
        vm.prank(taker);
        usdc.approve(address(settlement), type(uint256).max);

        settlement.setPriceOracle(address(weth), address(usdc), address(oracle));
        settlement.setTradingEnabled(true);
    }

    function _quote(uint256 makerAmount, uint256 takerAmount, uint256 expiry, uint256 nonce)
        internal
        view
        returns (Settlement.Quote memory)
    {
        return Settlement.Quote({
            maker: maker,
            taker: address(0),
            makerToken: address(weth),
            takerToken: address(usdc),
            makerAmount: makerAmount,
            takerAmount: takerAmount,
            expiry: expiry,
            nonce: nonce
        });
    }

    function _sign(uint256 pk, Settlement.Quote memory q) internal view returns (bytes memory) {
        bytes32 digest = settlement.hashQuote(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // 1 WETH por 2000 USDC = preço exato do oráculo
    function _fairQuote(uint256 nonce) internal view returns (Settlement.Quote memory) {
        return _quote(1e18, 2000e6, block.timestamp + 1 hours, nonce);
    }

    // ---------- happy path ----------

    function test_FillQuote_Success() public {
        Settlement.Quote memory q = _fairQuote(1);
        bytes memory sig = _sign(makerKey, q);

        uint256 makerWethBefore = weth.balanceOf(maker);
        uint256 takerUsdcBefore = usdc.balanceOf(taker);

        vm.prank(taker);
        settlement.fillQuote(q, sig);

        assertEq(weth.balanceOf(maker), makerWethBefore - 1e18);
        assertEq(weth.balanceOf(taker), 1e18);
        assertEq(usdc.balanceOf(taker), takerUsdcBefore - 2000e6);
        assertEq(usdc.balanceOf(maker), 2000e6);

        (,,,, uint64 makerFills) = registry.agents(maker);
        (,,,, uint64 takerFills) = registry.agents(taker);
        assertEq(makerFills, 1);
        assertEq(takerFills, 1);
    }

    // regressão do bug de decimais: WETH (18 casas) vs USDC (6 casas) — sem a
    // normalização, esse preço correto seria rejeitado como "fora do mercado"
    function test_FillQuote_DecimalNormalization_CorrectPricePasses() public {
        Settlement.Quote memory q = _quote(2.5e18, 5000e6, block.timestamp + 1 hours, 1); // 1 WETH = 2000 USDC
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        settlement.fillQuote(q, sig); // não deve reverter
    }

    // ---------- controles de acesso / estado ----------

    function test_FillQuote_RevertsIfTradingDisabled() public {
        Settlement s2 = new Settlement(address(registry));
        registry.setSettlement(address(s2));
        s2.setPriceOracle(address(weth), address(usdc), address(oracle));
        // setTradingEnabled nunca chamado

        Settlement.Quote memory q = _quote(1e18, 2000e6, block.timestamp + 1 hours, 1);
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        vm.expectRevert("Settlement: trading not enabled");
        s2.fillQuote(q, sig);
    }

    function test_FillQuote_RevertsOnSelfFill() public {
        Settlement.Quote memory q = _fairQuote(1);
        bytes memory sig = _sign(makerKey, q);

        vm.prank(maker);
        vm.expectRevert("Settlement: self fill");
        settlement.fillQuote(q, sig);
    }

    function test_FillQuote_RevertsOnZeroAmount() public {
        Settlement.Quote memory q = _quote(0, 2000e6, block.timestamp + 1 hours, 1);
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        vm.expectRevert("Settlement: zero amount");
        settlement.fillQuote(q, sig);
    }

    function test_FillQuote_RevertsIfMakerInactive() public {
        vm.prank(maker);
        registry.pauseAgent(maker);

        Settlement.Quote memory q = _fairQuote(1);
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        vm.expectRevert("Settlement: maker inactive");
        settlement.fillQuote(q, sig);
    }

    function test_FillQuote_RevertsIfTakerNotRegistered() public {
        address stranger = makeAddr("stranger");
        Settlement.Quote memory q = _fairQuote(1);
        bytes memory sig = _sign(makerKey, q);

        vm.prank(stranger);
        vm.expectRevert("Settlement: taker inactive");
        settlement.fillQuote(q, sig);
    }

    function test_FillQuote_RevertsIfQuoteRestrictedToOtherTaker() public {
        Settlement.Quote memory q = _quote(1e18, 2000e6, block.timestamp + 1 hours, 1);
        q.taker = makeAddr("someoneElse");
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        vm.expectRevert("Settlement: quote not for this taker");
        settlement.fillQuote(q, sig);
    }

    // ---------- assinatura / replay / prazo ----------

    function test_FillQuote_RevertsOnBadSignature() public {
        Settlement.Quote memory q = _fairQuote(1);
        bytes memory sig = _sign(takerKey, q); // assinado pela chave errada

        vm.prank(taker);
        vm.expectRevert("Settlement: bad maker signature");
        settlement.fillQuote(q, sig);
    }

    function test_FillQuote_RevertsOnReplayedNonce() public {
        Settlement.Quote memory q = _fairQuote(1);
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        settlement.fillQuote(q, sig);

        vm.prank(taker);
        vm.expectRevert("Settlement: nonce used");
        settlement.fillQuote(q, sig);
    }

    function test_FillQuote_RevertsOnExpiredQuote() public {
        Settlement.Quote memory q = _quote(1e18, 2000e6, block.timestamp + 1, 1);
        bytes memory sig = _sign(makerKey, q);

        vm.warp(block.timestamp + 2);

        vm.prank(taker);
        vm.expectRevert("Settlement: quote expired");
        settlement.fillQuote(q, sig);
    }

    // ---------- oráculo ----------

    function test_FillQuote_RevertsIfPairNotListed() public {
        MockERC20 dai = new MockERC20("Dai", "DAI", 18);
        dai.mint(taker, 1_000e18);
        vm.prank(taker);
        dai.approve(address(settlement), type(uint256).max);

        Settlement.Quote memory q = Settlement.Quote({
            maker: maker,
            taker: address(0),
            makerToken: address(weth),
            takerToken: address(dai),
            makerAmount: 1e18,
            takerAmount: 2000e18,
            expiry: block.timestamp + 1 hours,
            nonce: 1
        });
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        vm.expectRevert("Settlement: pair not listed");
        settlement.fillQuote(q, sig);
    }

    function test_FillQuote_RevertsOnStaleOracle() public {
        oracle.setUpdatedAt(block.timestamp);
        vm.warp(block.timestamp + 2 hours); // maxOracleStaleness padrão = 1h

        Settlement.Quote memory q = _fairQuote(1);
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        vm.expectRevert("Settlement: stale oracle");
        settlement.fillQuote(q, sig);
    }

    function test_FillQuote_RevertsOnPriceDeviationTooHigh() public {
        // pede 2200 USDC por 1 WETH (10% acima do oráculo, cap padrão é 5%)
        Settlement.Quote memory q = _quote(1e18, 2200e6, block.timestamp + 1 hours, 1);
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        vm.expectRevert("Settlement: price deviates from oracle");
        settlement.fillQuote(q, sig);
    }

    function test_FillQuote_AllowsPriceWithinDeviation() public {
        // 2040 USDC por 1 WETH = 2% acima, dentro do cap de 5%
        Settlement.Quote memory q = _quote(1e18, 2040e6, block.timestamp + 1 hours, 1);
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        settlement.fillQuote(q, sig); // não deve reverter
    }

    // ---------- tetos de risco ----------

    function test_FillQuote_RevertsOnPerTradeCapExceeded() public {
        settlement.setMaxTradeAmount(address(weth), 0.5e18);

        Settlement.Quote memory q = _fairQuote(1); // 1 WETH, acima do teto de 0.5
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        vm.expectRevert("Settlement: exceeds per-trade cap");
        settlement.fillQuote(q, sig);
    }

    function test_FillQuote_RevertsOnVolumeWindowCapExceeded() public {
        settlement.setMaxVolumePerWindow(address(weth), 1.5e18);
        settlement.setVolumeWindowDuration(60); // janela curta pra não esbarrar no prazo da quote no teste

        Settlement.Quote memory q1 = _quote(1e18, 2000e6, block.timestamp + 1 hours, 1);
        bytes memory sig1 = _sign(makerKey, q1);
        vm.prank(taker);
        settlement.fillQuote(q1, sig1); // acumula 1e18, ok

        Settlement.Quote memory q2 = _quote(1e18, 2000e6, block.timestamp + 1 hours, 2);
        bytes memory sig2 = _sign(makerKey, q2);
        vm.prank(taker);
        vm.expectRevert("Settlement: token volume cap exceeded");
        settlement.fillQuote(q2, sig2); // acumularia 2e18, estoura 1.5e18

        // depois que a janela vira, o contador reseta
        vm.warp(block.timestamp + settlement.volumeWindowDuration() + 1);
        vm.prank(taker);
        settlement.fillQuote(q2, sig2); // não deve reverter
    }

    function test_FillQuote_RevertsOnRateLimitExceeded() public {
        settlement.setRateLimit(60, 2);

        Settlement.Quote memory q1 = _quote(1e18, 2000e6, block.timestamp + 1 hours, 1);
        bytes memory sig1 = _sign(makerKey, q1);
        vm.prank(taker);
        settlement.fillQuote(q1, sig1);

        Settlement.Quote memory q2 = _quote(1e18, 2000e6, block.timestamp + 1 hours, 2);
        bytes memory sig2 = _sign(makerKey, q2);
        vm.prank(taker);
        settlement.fillQuote(q2, sig2);

        Settlement.Quote memory q3 = _quote(1e18, 2000e6, block.timestamp + 1 hours, 3);
        bytes memory sig3 = _sign(makerKey, q3);
        vm.prank(taker);
        vm.expectRevert("Settlement: rate limit exceeded");
        settlement.fillQuote(q3, sig3);

        vm.warp(block.timestamp + 61);
        vm.prank(taker);
        settlement.fillQuote(q3, sig3); // janela renovada, passa
    }

    // ---------- taxa (padrão Uniswap: cobrada uma vez, no lado que o taker paga) ----------

    function test_FillQuote_ChargesFee_OnTakerLegOnly() public {
        address treasury = makeAddr("treasury");
        settlement.setFeeRecipient(treasury);
        settlement.setFeeBps(30); // 0,3%, padrão Uniswap

        Settlement.Quote memory q = _fairQuote(1); // 1 WETH por 2000 USDC
        bytes memory sig = _sign(makerKey, q);

        uint256 makerWethBefore = weth.balanceOf(maker);

        vm.prank(taker);
        settlement.fillQuote(q, sig);

        uint256 fee = (2000e6 * 30) / 10000; // 6 USDC
        assertEq(usdc.balanceOf(treasury), fee);
        assertEq(usdc.balanceOf(maker), 2000e6 - fee); // maker recebe líquido
        assertEq(weth.balanceOf(maker), makerWethBefore - 1e18); // perna do maker sem taxa
        assertEq(weth.balanceOf(taker), 1e18); // taker recebe o bruto, sem desconto
    }

    function test_SetFeeBps_RevertsAboveMax() public {
        vm.expectRevert("Settlement: fee too high");
        settlement.setFeeBps(1001); // acima do teto de 10%
    }

    // ---------- achados da revisão adversarial/code-review ----------

    // cadastrar só (weth, usdc) já libera negociação nos dois sentidos — não precisa
    // cadastrar (usdc, weth) separadamente
    function test_FillQuote_WorksWithReverseOracleOrder() public {
        Settlement.Quote memory q = Settlement.Quote({
            maker: maker, // agora vendendo USDC por WETH, direção oposta do setUp
            taker: address(0),
            makerToken: address(usdc),
            takerToken: address(weth),
            makerAmount: 2000e6,
            takerAmount: 1e18,
            expiry: block.timestamp + 1 hours,
            nonce: 1
        });
        usdc.mint(maker, 2000e6);
        vm.prank(maker);
        usdc.approve(address(settlement), type(uint256).max);
        weth.mint(taker, 1e18);
        vm.prank(taker);
        weth.approve(address(settlement), type(uint256).max);

        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        settlement.fillQuote(q, sig); // não deve reverter, mesmo sem oráculo (usdc,weth) cadastrado
    }

    function test_SetMaxPriceDeviationBps_RevertsAboveMax() public {
        vm.expectRevert("Settlement: deviation too high");
        settlement.setMaxPriceDeviationBps(2001);
    }

    function test_SetMaxVolumePerWindow_ResetsAccumulatedWindow() public {
        settlement.setMaxVolumePerWindow(address(weth), 1.5e18);

        Settlement.Quote memory q1 = _quote(1e18, 2000e6, block.timestamp + 1 hours, 1);
        bytes memory sig1 = _sign(makerKey, q1);
        vm.prank(taker);
        settlement.fillQuote(q1, sig1); // acumula 1e18 na janela

        // reconfigurar o teto (mesmo pro mesmo valor) reinicia o acumulado
        settlement.setMaxVolumePerWindow(address(weth), 1.5e18);

        Settlement.Quote memory q2 = _quote(1e18, 2000e6, block.timestamp + 1 hours, 2);
        bytes memory sig2 = _sign(makerKey, q2);
        vm.prank(taker);
        settlement.fillQuote(q2, sig2); // não deveria estourar, pois a janela foi zerada
    }

    function test_FillQuote_RevertsIfFeeConfiguredWithoutRecipient() public {
        settlement.setFeeBps(30); // sem setFeeRecipient

        Settlement.Quote memory q = _fairQuote(1);
        bytes memory sig = _sign(makerKey, q);

        vm.prank(taker);
        vm.expectRevert("Settlement: fee recipient not set");
        settlement.fillQuote(q, sig);
    }
}
