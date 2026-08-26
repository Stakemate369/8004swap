import type { Address } from "viem";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Relay: variável de ambiente ${name} não definida`);
  }
  return value;
}

// `?? fallback` só cobre null/undefined — uma env var setada como string vazia
// (ex: "MAX_CONNECTIONS_PER_IP=" sobrando de um .env copiado) passa direto e vira
// Number("") = 0, silenciosamente. Trata string vazia como "não definida" também.
// Um valor não-numérico (ex: "abc" por erro de digitação) vira NaN, e comparações
// com NaN são sempre `false` — pra um limite de segurança (rate limit, teto de
// conexão) isso faria a proteção nunca disparar, silenciosamente. Falha alto e
// explícito em vez disso, no mesmo padrão do requireEnv().
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  // Number("") === 0 e Number("   ") também === 0 (JS trata string em branco como
  // "0" numérico) — sem o trim() acima, "TRUSTED_PROXY_HOPS= " passaria a checagem
  // `!raw` (string não-vazia) e ainda assim viraria 0 silenciosamente
  if (!Number.isFinite(parsed)) {
    throw new Error(`Relay: variável de ambiente ${name}="${raw}" não é um número válido`);
  }
  return parsed;
}

export const config = {
  port: envInt("PORT", 8787),
  rpcUrl: requireEnv("BASE_RPC_URL"),
  registryAddress: requireEnv("REGISTRY_ADDRESS") as Address,
  // janela padrão pra coletar cotações dos makers antes de responder o taker
  rfqWindowMs: envInt("RFQ_WINDOW_MS", 3000),
  // quantas rfq_request um mesmo taker pode mandar por minuto
  rfqRateLimitPerMinute: envInt("RFQ_RATE_LIMIT_PER_MINUTE", 30),
  // por quanto tempo confiar num isActive() já consultado, antes de checar de novo on-chain
  registryCacheTtlMs: envInt("REGISTRY_CACHE_TTL_MS", 30_000),
  // teto de conexões WS simultâneas por IP, antes mesmo do handshake de auth — evita
  // esgotar memória/file descriptors com conexões não-autenticadas
  maxConnectionsPerIp: envInt("MAX_CONNECTIONS_PER_IP", 20),
  // quantos hops de proxy confiável ficam na frente do processo do Relay (hoje: só
  // o ingress do Akash, 1 hop) — usado por remoteIp() em server.ts pra saber qual
  // entrada da cadeia x-forwarded-for é a última acrescentada por infra confiável
  // (e não forjável pelo cliente). Mudar de topologia (CDN, 2º proxy) exige mudar
  // esse valor, não o código.
  trustedProxyHops: envInt("TRUSTED_PROXY_HOPS", 1),
};
