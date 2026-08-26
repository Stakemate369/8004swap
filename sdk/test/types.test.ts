import { describe, expect, it } from "vitest";
import { quoteFromWire, quoteTermsToWire, quoteToWire } from "../src/types.js";
import type { Quote, SignedQuote } from "../src/types.js";

const quote: Quote = {
  maker: "0x1111111111111111111111111111111111111111",
  taker: "0x2222222222222222222222222222222222222222",
  makerToken: "0x3333333333333333333333333333333333333333",
  takerToken: "0x4444444444444444444444444444444444444444",
  makerAmount: 1_000_000_000_000_000_000n,
  takerAmount: 2_000_000n,
  expiry: 9_999_999_999n,
  nonce: 42n,
};

describe("conversão wire (bigint <-> string)", () => {
  it("quoteTermsToWire converte todo bigint pra string decimal", () => {
    const wire = quoteTermsToWire(quote);
    expect(wire.makerAmount).toBe("1000000000000000000");
    expect(wire.takerAmount).toBe("2000000");
    expect(wire.nonce).toBe("42");
  });

  it("quoteToWire/quoteFromWire faz round-trip sem perder precisão", () => {
    const signed: SignedQuote = { ...quote, signature: "0xabcd" };
    const roundTripped = quoteFromWire(quoteToWire(signed));
    expect(roundTripped).toEqual(signed);
  });
});
