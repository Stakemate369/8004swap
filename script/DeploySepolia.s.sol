// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/Registry.sol";
import "../contracts/Settlement.sol";

/// Deploy de teste na Base Sepolia (chainId 84532) — ETH e USDC de faucet, sem valor
/// real. Versão simplificada da Deploy.s.sol (só o par WETH/USDC), pra validar o
/// sistema inteiro em rede pública antes de qualquer decisão de mainnet.
contract DeploySepolia is Script {
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    address constant ETH_USD_FEED = 0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1;
    address constant USDC_USD_FEED = 0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165;

    function run() external {
        require(block.chainid == 84532, "DeploySepolia: este script e so para Base Sepolia (chainId 84532)");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        Registry registry = new Registry();
        Settlement settlement = new Settlement(address(registry));
        registry.setSettlement(address(settlement));

        settlement.setPriceOracle(WETH, USDC, ETH_USD_FEED);

        // tetos bem pequenos de propósito — é teste, não precisa mover muito
        settlement.setMaxTradeAmount(WETH, 0.1e18);
        settlement.setMaxVolumePerWindow(WETH, 1e18);
        settlement.setMaxTradeAmount(USDC, 500e6);
        settlement.setMaxVolumePerWindow(USDC, 5_000e6);

        address feeRecipient = vm.envOr("FEE_RECIPIENT", address(0));
        if (feeRecipient != address(0)) {
            settlement.setFeeRecipient(feeRecipient);
            settlement.setFeeBps(30);
        } else {
            console2.log("AVISO: FEE_RECIPIENT nao configurado - taxa fica em 0%");
        }

        settlement.setTradingEnabled(true);

        vm.stopBroadcast();

        console2.log("Registry:", address(registry));
        console2.log("Settlement:", address(settlement));
        console2.log("tradingEnabled:", settlement.tradingEnabled());
    }
}
