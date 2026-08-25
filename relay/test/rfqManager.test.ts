import { describe, expect, it, vi } from "vitest";
import { RfqManager, rankQuotes, type RankedQuote } from "../src/rfqManager.js";

const MAKER_A = "0x1111111111111111111111111111111111111111" as const;
const MAKER_B = "0x2222222222222222222222222222222222222222" as const;
const TAKER = "0x3333333333333333333333333333333333333333" as const;
const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

function quote(overrides: Partial<RankedQuote> = {}): RankedQuote {
  return {
    maker: MAKER_A,
    taker: TAKER,
    makerToken: TOKEN_A,
    takerToken: TOKEN_B,
    makerAmount: 100n,
    takerAmount: 50n,
    expiry: 9_999_999_999n,
    nonce: 1n,
    ...overrides,
  };
}

describe("rankQuotes", () => {
  it("ordena do maior makerAmount pro menor", () => {
    const quotes = [quote({ makerAmount: 90n }), quote({ makerAmount: 110n }), quote({ makerAmount: 100n })];
    const ranked = rankQuotes(quotes, 0n);
    expect(ranked.map((q) => q.makerAmount)).toEqual([110n, 100n, 90n]);
  });

  it("descarta cotação abaixo do piso pedido", () => {
    const quotes = [quote({ makerAmount: 50n }), quote({ makerAmount: 150n })];
    const ranked = rankQuotes(quotes, 100n);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].makerAmount).toBe(150n);
  });
});

describe("RfqManager", () => {
  it("distribui inscritos só pro par certo", () => {
    const manager = new RfqManager();
    manager.subscribe("conn-1", TOKEN_A, TOKEN_B);
    manager.subscribe("conn-2", TOKEN_B, TOKEN_A); // par invertido, não deve aparecer

    expect(manager.subscribersFor(TOKEN_A, TOKEN_B)).toEqual(["conn-1"]);
  });

  it("remove inscrição ao desconectar", () => {
    const manager = new RfqManager();
    manager.subscribe("conn-1", TOKEN_A, TOKEN_B);
    manager.unsubscribeAll("conn-1");

    expect(manager.subscribersFor(TOKEN_A, TOKEN_B)).toEqual([]);
  });

  it("resolve com as cotações rankeadas depois da janela de tempo", () => {
    vi.useFakeTimers();
    const manager = new RfqManager();
    const onResolve = vi.fn();

    manager.openRfq(
      { requestId: "req-1", taker: TAKER, takerToken: TOKEN_B, takerAmount: 50n, makerToken: TOKEN_A, minMakerAmount: 0n },
      1000,
      onResolve
    );

    manager.submitQuote("req-1", quote({ maker: MAKER_A, makerAmount: 90n }));
    manager.submitQuote("req-1", quote({ maker: MAKER_B, makerAmount: 110n }));

    vi.advanceTimersByTime(1000);

    expect(onResolve).toHaveBeenCalledOnce();
    const [requestId, quotes] = onResolve.mock.calls[0];
    expect(requestId).toBe("req-1");
    expect(quotes.map((q: RankedQuote) => q.maker)).toEqual([MAKER_B, MAKER_A]);

    vi.useRealTimers();
  });

  it("rejeita cotação com termos diferentes do pedido original", () => {
    const manager = new RfqManager();
    const onResolve = vi.fn();

    manager.openRfq(
      { requestId: "req-1", taker: TAKER, takerToken: TOKEN_B, takerAmount: 50n, makerToken: TOKEN_A, minMakerAmount: 0n },
      1000,
      onResolve
    );

    const result = manager.submitQuote("req-1", quote({ takerAmount: 999n })); // valor diferente do pedido
    expect(result.ok).toBe(false);
  });

  it("rejeita cotação pra rfq que não existe (expirada ou nunca aberta)", () => {
    const manager = new RfqManager();
    const result = manager.submitQuote("req-inexistente", quote());
    expect(result.ok).toBe(false);
  });
});
