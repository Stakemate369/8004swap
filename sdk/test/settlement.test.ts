import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { NO_PERMIT, SETTLEMENT_ABI } from "../src/settlement.js";
import type { Quote } from "../src/types.js";

const quote: Quote = {
  maker: "0x1111111111111111111111111111111111111111",
  taker: "0x0000000000000000000000000000000000000000",
  makerToken: "0x2222222222222222222222222222222222222222",
  takerToken: "0x3333333333333333333333333333333333333333",
  makerAmount: 1_000_000n,
  takerAmount: 2_000_000n,
  expiry: 9_999_999_999n,
  nonce: 1n,
};

describe("NO_PERMIT", () => {
  // regressão: r/s como "0x0" (1 byte) em vez de bytes32 de 32 bytes fazia o
  // encoder ABI do viem lançar AbiEncodingBytesSizeMismatchError antes mesmo de
  // chegar na chain — exatamente no caminho "sem permit" que essa constante existe
  // pra cobrir
  it("codifica fillQuoteWithPermit(quote, sig, NO_PERMIT) sem lançar", () => {
    expect(() =>
      encodeFunctionData({
        abi: SETTLEMENT_ABI,
        functionName: "fillQuoteWithPermit",
        args: [quote, "0xabcd", NO_PERMIT],
      })
    ).not.toThrow();
  });
});
