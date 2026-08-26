// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/Registry.sol";
import "../contracts/Settlement.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockERC20Permit.sol";
import "./mocks/MockOracle.sol";

// fillQuoteWithPermit: cobre o caminho novo (permit poupando o approve prévio do
// taker) sem duplicar toda a bateria de checagens já coberta em Settlement.t.sol
// (fillQuote e fillQuoteWithPermit compartilham o mesmo _fillQuote interno)
contract SettlementPermitTest is Test {
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    Registry registry;
    Settlement settlement;
    MockERC20 weth; // maker token, 18 casas, sem permit (representa WETH real)
    MockERC20Permit usdc; // taker token, 6 casas, com permit
    MockOracle oracle;

    uint256 makerKey;
    uint256 takerKey;
    address maker;
    address taker;

    uint256 constant ETH_PRICE = 2000e8;

    function setUp() public {
        (maker, makerKey) = makeAddrAndKey("maker");
        (taker, takerKey) = makeAddrAndKey("taker");

        registry = new Registry();
        settlement = new Settlement(address(registry));
        registry.setSettlement(address(settlement));

        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        usdc = new MockERC20Permit("USD Coin", "USDC", 6);
        oracle = new MockOracle(int256(ETH_PRICE), 8);

        vm.prank(maker);
        registry.registerAgent(maker, "ipfs://maker");
        vm.prank(taker);
        registry.registerAgent(taker, "ipfs://taker");

        weth.mint(maker, 1_000e18);
        usdc.mint(taker, 1_000_000e6);

        // maker aprova normalmente (opera continuamente, permit não é o foco dele aqui)
        vm.prank(maker);
        weth.approve(address(settlement), type(uint256).max);

        settlement.setPriceOracle(address(weth), address(usdc), address(oracle));
        settlement.setTradingEnabled(true);
    }

    function _quote(uint256 nonce) internal view returns (Settlement.Quote memory) {
        return Settlement.Quote({
            maker: maker,
            taker: address(0),
            makerToken: address(weth),
            takerToken: address(usdc),
            makerAmount: 1e18,
            takerAmount: 2000e6,
            expiry: block.timestamp + 1 hours,
            nonce: nonce
        });
    }

    function _sign(uint256 pk, Settlement.Quote memory q) internal view returns (bytes memory) {
        bytes32 digest = settlement.hashQuote(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signPermit(uint256 pk, address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (Settlement.PermitData memory)
    {
        uint256 nonce = usdc.nonces(owner);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return Settlement.PermitData({value: value, deadline: deadline, v: v, r: r, s: s});
    }

    // caminho principal: taker nunca chamou approve, só assina o permit — o fill
    // deve funcionar exatamente como o fillQuote normal funcionaria com approve prévio
    function test_FillQuoteWithPermit_NoPriorApprove_Succeeds() public {
        assertEq(usdc.allowance(taker, address(settlement)), 0);

        Settlement.Quote memory q = _quote(1);
        bytes memory makerSig = _sign(makerKey, q);
        Settlement.PermitData memory permit =
            _signPermit(takerKey, taker, address(settlement), 2000e6, block.timestamp + 1 hours);

        uint256 takerUsdcBefore = usdc.balanceOf(taker);

        vm.prank(taker);
        settlement.fillQuoteWithPermit(q, makerSig, permit);

        assertEq(usdc.balanceOf(taker), takerUsdcBefore - 2000e6);
        assertEq(weth.balanceOf(taker), 1e18);
    }

    // deadline == 0 é o sinal explícito de "sem permit" — precisa se comportar
    // idêntico ao fillQuote (exige allowance convencional já existente)
    function test_FillQuoteWithPermit_ZeroDeadline_SkipsPermit_UsesExistingApproval() public {
        vm.prank(taker);
        usdc.approve(address(settlement), 2000e6);

        Settlement.Quote memory q = _quote(1);
        bytes memory makerSig = _sign(makerKey, q);
        Settlement.PermitData memory noPermit =
            Settlement.PermitData({value: 0, deadline: 0, v: 0, r: bytes32(0), s: bytes32(0)});

        vm.prank(taker);
        settlement.fillQuoteWithPermit(q, makerSig, noPermit);

        assertEq(weth.balanceOf(taker), 1e18);
    }

    // permit inválido (assinado pela chave errada) não deve travar a transação — o
    // try/catch engole a falha do permit, e o fill segue pra checagem normal de
    // allowance, que reverte pelo motivo certo (allowance insuficiente), não pelo
    // permit em si
    function test_FillQuoteWithPermit_InvalidPermitSignature_FallsThroughToAllowanceCheck() public {
        Settlement.Quote memory q = _quote(1);
        bytes memory makerSig = _sign(makerKey, q);
        // assinado pela chave do maker, não do taker (owner do permit é `taker`) — inválido
        Settlement.PermitData memory badPermit =
            _signPermit(makerKey, taker, address(settlement), 2000e6, block.timestamp + 1 hours);

        vm.prank(taker);
        vm.expectRevert(); // ERC20InsufficientAllowance, não o revert do permit
        settlement.fillQuoteWithPermit(q, makerSig, badPermit);
    }

    // permit válido mas já consumido por terceiro antes do fill (ex: front-run do
    // próprio permit) não deve travar o fill se a allowance já ficou setada
    function test_FillQuoteWithPermit_AlreadyConsumedPermit_StillFillsViaExistingAllowance() public {
        Settlement.Quote memory q = _quote(1);
        bytes memory makerSig = _sign(makerKey, q);
        Settlement.PermitData memory permit =
            _signPermit(takerKey, taker, address(settlement), 2000e6, block.timestamp + 1 hours);

        // alguém (ou o próprio taker) já submeteu esse permit antes do fillQuoteWithPermit
        usdc.permit(taker, address(settlement), permit.value, permit.deadline, permit.v, permit.r, permit.s);

        vm.prank(taker);
        settlement.fillQuoteWithPermit(q, makerSig, permit); // permit reverte internamente (nonce usado), catch engole, allowance já está lá

        assertEq(weth.balanceOf(taker), 1e18);
    }
}
