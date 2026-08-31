import type { Address } from "viem";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`8004Swap MCP server: missing required env var ${name}`);
  }
  return value;
}

export const config = {
  relayUrl: env("RELAY_URL", "wss://8arfgh3e11ds7dodiidv9bo7uo.ingress.zencloud.eu"),
  rpcUrl: env("RPC_URL", "https://sepolia.base.org"),
  chainId: Number(env("CHAIN_ID", "84532")),
  registryAddress: env("REGISTRY_ADDRESS", "0x7Bb793b6Ada038cf9c26c6BB54cA15Db6BD35ed1") as Address,
  settlementAddress: env("SETTLEMENT_ADDRESS", "0x5Cc2558dF13739c05cb57Caf0E9cfe1629a6a945") as Address,
  agentPrivateKey: process.env.AGENT_PRIVATE_KEY, // optional: only needed for tools that sign
};

export function requireAgentPrivateKey(): `0x${string}` {
  if (!config.agentPrivateKey) {
    throw new Error(
      "This tool signs on-chain/off-chain messages and needs AGENT_PRIVATE_KEY set in the MCP server's environment. " +
        "Generate a dedicated wallet for this agent (never reuse a key with real funds outside this testnet)."
    );
  }
  return config.agentPrivateKey as `0x${string}`;
}
