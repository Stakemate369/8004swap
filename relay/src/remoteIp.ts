// lógica pura (sem WebSocket/HTTP) de propósito, pra dar pra testar sem abrir
// conexão nenhuma — mesmo padrão de rfqManager.ts
//
// cada proxy confiável na frente ACRESCENTA (não sobrescreve) o IP que recebeu ao
// fim da cadeia x-forwarded-for. Com N hops confiáveis configurados
// (trustedProxyHops), a entrada do cliente real é a que fica N posições antes do
// fim — as últimas N entradas foram escritas por infra confiável, então não são
// forjáveis; qualquer coisa antes disso, incluindo o que o próprio cliente mandar,
// é ignorada. Usar a primeira entrada (ou não contar hops) seria um bug de
// segurança: o cliente pode mandar "X-Forwarded-For: 1.2.3.4" e a cadeia final vira
// "1.2.3.4, <ip real>", derrotando o cap de conexões por IP. Mudar de topologia
// (CDN, 2º proxy) exige atualizar TRUSTED_PROXY_HOPS, não este código. Sem nenhum
// header (dev local, sem proxy), cai pro IP direto do socket TCP.
export function remoteIp(
  xForwardedFor: string | string[] | undefined,
  socketRemoteAddress: string | undefined,
  trustedProxyHops: number
): string {
  const chainStr = Array.isArray(xForwardedFor) ? xForwardedFor.join(",") : xForwardedFor;
  if (!chainStr) return socketRemoteAddress || "unknown";

  const parts = chainStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // se a cadeia é mais curta que o nº de hops confiáveis configurado, é uma
  // divergência entre config e topologia real — nenhuma entrada do header pode ser
  // atribuída com confiança ao hop esperado. Cair pra entrada mais à esquerda seria
  // voltar a confiar em algo forjável pelo próprio cliente; o IP do socket TCP (a
  // conexão real, nunca forjável) é o fallback seguro.
  if (parts.length < trustedProxyHops) return socketRemoteAddress || "unknown";

  const clientIdx = parts.length - trustedProxyHops;
  return parts[clientIdx] || socketRemoteAddress || "unknown";
}
