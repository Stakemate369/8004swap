// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/Registry.sol";
import "../contracts/Settlement.sol";

/// Deploy + configuração inicial na Base Mainnet. Endereços verificados manualmente
/// contra Basescan/docs oficiais nesta sessão (não confiar de cabeça em versões futuras
/// deste arquivo sem reconferir, endereço errado aqui é fundo indo pro lugar errado).
contract Deploy is Script {
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant DAI = 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb;
    address constant LINK = 0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196;

    // Chainlink price feeds na Base Mainnet — proxy padrão, não a variante SVR
    address constant ETH_USD_FEED = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
    address constant USDC_USD_FEED = 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B;
    address constant CBBTC_USD_FEED = 0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D;
    address constant DAI_USD_FEED = 0x591e79239a7d679378eC8c847e5038150364C78F;
    address constant LINK_USD_FEED = 0x17CAb8FE31E32f08326e5E27412894e49B0f9D65;

    function run() external {
        require(block.chainid == 8453, "Deploy: este script e so para Base Mainnet (chainId 8453)");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        Registry registry = new Registry();
        Settlement settlement = new Settlement(address(registry));
        registry.setSettlement(address(settlement));

        // cada ativo pareado contra USDC — o oráculo Chainlink só dá ativo/USD, não
        // par-a-par direto, então USDC (~1 USD) vira o "hub" de cotação. Agente que
        // quiser trocar LINK por cbBTC direto faz em duas pernas via USDC.
        settlement.setPriceOracle(WETH, USDC, ETH_USD_FEED);
        settlement.setPriceOracle(CBBTC, USDC, CBBTC_USD_FEED);
        settlement.setPriceOracle(DAI, USDC, DAI_USD_FEED);
        settlement.setPriceOracle(LINK, USDC, LINK_USD_FEED);

        // tetos de risco iniciais — chute conservador pra MVP sem auditoria, não uma
        // análise de capacidade real. Ajustar depois de ver volume de verdade.
        settlement.setMaxTradeAmount(WETH, 1e18); // 1 WETH/trade
        settlement.setMaxVolumePerWindow(WETH, 5e18); // 5 WETH/dia

        settlement.setMaxTradeAmount(USDC, 5_000e6); // 5.000 USDC/trade
        settlement.setMaxVolumePerWindow(USDC, 20_000e6); // 20.000 USDC/dia

        settlement.setMaxTradeAmount(CBBTC, 0.05e8); // 0,05 cbBTC/trade (8 casas)
        settlement.setMaxVolumePerWindow(CBBTC, 0.2e8); // 0,2 cbBTC/dia

        settlement.setMaxTradeAmount(DAI, 5_000e18); // 5.000 DAI/trade
        settlement.setMaxVolumePerWindow(DAI, 20_000e18); // 20.000 DAI/dia

        settlement.setMaxTradeAmount(LINK, 500e18); // 500 LINK/trade
        settlement.setMaxVolumePerWindow(LINK, 2_000e18); // 2.000 LINK/dia

        // taxa (mitigação do sybil wash trading) — só liga se FEE_RECIPIENT foi
        // passado; sem isso, feeBps>0 travaria TODO fillQuote (exige recipient != 0)
        address feeRecipient = vm.envOr("FEE_RECIPIENT", address(0));
        if (feeRecipient != address(0)) {
            settlement.setFeeRecipient(feeRecipient);
            settlement.setFeeBps(30); // 0,3%, padrão Uniswap
        } else {
            console2.log(
                "AVISO: FEE_RECIPIENT nao configurado - taxa fica em 0%, sem protecao contra wash trading sybil"
            );
        }

        // interruptor mestre — só liga depois de tudo configurado acima
        settlement.setTradingEnabled(true);

        vm.stopBroadcast();

        console2.log("Registry:", address(registry));
        console2.log("Settlement:", address(settlement));
        console2.log("tradingEnabled:", settlement.tradingEnabled());
        console2.log("feeBps:", settlement.feeBps());
    }
}
