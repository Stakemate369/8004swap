import { createPublicClient, http, type Address } from "viem";
import { config } from "./config.js";

const REGISTRY_ABI = [
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

const client = createPublicClient({
  transport: http(config.rpcUrl),
});

const cache = new Map<Address, { active: boolean; expiresAt: number }>();

// consulta o Registry on-chain (com cache curto) — é a única fonte de verdade sobre
// quem pode operar; o Relay nunca decide isso sozinho
export async function isAgentActive(agent: Address): Promise<boolean> {
  const cached = cache.get(agent);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.active;
  }

  const active = await client.readContract({
    address: config.registryAddress,
    abi: REGISTRY_ABI,
    functionName: "isActive",
    args: [agent],
  });

  cache.set(agent, { active, expiresAt: Date.now() + config.registryCacheTtlMs });
  return active;
}
