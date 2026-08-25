import type { Address } from "viem";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Relay: variável de ambiente ${name} não definida`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  rpcUrl: requireEnv("BASE_RPC_URL"),
  registryAddress: requireEnv("REGISTRY_ADDRESS") as Address,
  // janela padrão pra coletar cotações dos makers antes de responder o taker
  rfqWindowMs: Number(process.env.RFQ_WINDOW_MS ?? 3000),
  // quantas rfq_request um mesmo taker pode mandar por minuto
  rfqRateLimitPerMinute: Number(process.env.RFQ_RATE_LIMIT_PER_MINUTE ?? 30),
  // por quanto tempo confiar num isActive() já consultado, antes de checar de novo on-chain
  registryCacheTtlMs: Number(process.env.REGISTRY_CACHE_TTL_MS ?? 30_000),
};
