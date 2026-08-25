// valores de teste — nunca usados pra assinar nada de valor real, só pra satisfazer
// o config.ts (que exige as env vars) durante os testes
process.env.BASE_RPC_URL ??= "http://127.0.0.1:8545";
process.env.CHAIN_ID ??= "8453";
process.env.REGISTRY_ADDRESS ??= "0x1000000000000000000000000000000000000000";
process.env.SETTLEMENT_ADDRESS ??= "0x2000000000000000000000000000000000000000";
