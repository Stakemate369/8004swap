import { describe, expect, it } from "vitest";
import { remoteIp } from "../src/remoteIp.js";

describe("remoteIp", () => {
  it("sem proxy (dev local): cai pro IP do socket TCP", () => {
    expect(remoteIp(undefined, "127.0.0.1", 1)).toBe("127.0.0.1");
  });

  it("1 hop confiável (ingress do Akash): usa a última entrada, não a primeira", () => {
    // cliente manda "1.2.3.4" (forjado); o ingress acrescenta o IP real ao fim
    expect(remoteIp("1.2.3.4, 203.0.113.9", "10.0.0.1", 1)).toBe("203.0.113.9");
  });

  it("cliente forjando X-Forwarded-For sozinho (sem proxy de verdade) não muda o resultado com 1 hop configurado", () => {
    // só 1 entrada na cadeia mas trustedProxyHops=1 espera que essa entrada já
    // tenha sido escrita pelo proxy confiável, não pelo cliente direto — cenário
    // de topologia mal configurada, mas o comportamento tem que ser determinístico
    expect(remoteIp("9.9.9.9", "10.0.0.1", 1)).toBe("9.9.9.9");
  });

  it("2 hops confiáveis: pega a penúltima entrada, não a última", () => {
    expect(remoteIp("1.2.3.4, 203.0.113.9, 10.0.0.5", "10.0.0.1", 2)).toBe("203.0.113.9");
  });

  it("cadeia mais curta que o nº de hops configurado: cai pro IP do socket (seguro), não pra entrada do header (forjável)", () => {
    // config divergente da topologia real (ex: TRUSTED_PROXY_HOPS=5 mas só 1 hop
    // existe) não pode resultar em confiar numa entrada que o próprio cliente
    // controla — "203.0.113.9" aqui podia ser forjado pelo atacante
    expect(remoteIp("203.0.113.9", "10.0.0.1", 5)).toBe("10.0.0.1");
  });

  it("aceita o header como array (múltiplos X-Forwarded-For) e trata como uma cadeia só", () => {
    expect(remoteIp(["1.2.3.4", "203.0.113.9"], "10.0.0.1", 1)).toBe("203.0.113.9");
  });

  it("entradas com espaço em branco ao redor da vírgula são normalizadas", () => {
    expect(remoteIp("1.2.3.4 ,  203.0.113.9  ", "10.0.0.1", 1)).toBe("203.0.113.9");
  });
});
