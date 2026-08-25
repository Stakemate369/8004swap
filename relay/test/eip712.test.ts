import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { QUOTE_DOMAIN, QUOTE_TYPES, verifyQuoteSignature } from "../src/eip712.js";
import type { Quote } from "../src/types.js";

// chave de teste conhecida (Anvil #0) — nunca usar em mainnet de verdade
const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const account = privateKeyToAccount(TEST_PRIVATE_KEY);

function sampleQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    maker: account.address,
    taker: "0x0000000000000000000000000000000000000000",
    makerToken: "0x1111111111111111111111111111111111111111",
    takerToken: "0x2222222222222222222222222222222222222222",
    makerAmount: 1_000_000n,
    takerAmount: 2_000_000n,
    expiry: 9_999_999_999n,
    nonce: 1n,
    ...overrides,
  };
}

describe("eip712", () => {
  it("verifica uma cotação assinada corretamente", async () => {
    const quote = sampleQuote();
    const signature = await account.signTypedData({
      domain: QUOTE_DOMAIN,
      types: QUOTE_TYPES,
      primaryType: "Quote",
      message: quote,
    });

    const valid = await verifyQuoteSignature(quote, signature, account.address);
    expect(valid).toBe(true);
  });

  it("rejeita assinatura de uma cotação com valor alterado depois de assinada", async () => {
    const quote = sampleQuote();
    const signature = await account.signTypedData({
      domain: QUOTE_DOMAIN,
      types: QUOTE_TYPES,
      primaryType: "Quote",
      message: quote,
    });

    const tampered: Quote = { ...quote, makerAmount: 999_999_999n };
    const valid = await verifyQuoteSignature(tampered, signature, account.address);
    expect(valid).toBe(false);
  });

  it("rejeita assinatura verificada contra o endereço errado", async () => {
    const quote = sampleQuote();
    const signature = await account.signTypedData({
      domain: QUOTE_DOMAIN,
      types: QUOTE_TYPES,
      primaryType: "Quote",
      message: quote,
    });

    const valid = await verifyQuoteSignature(quote, signature, "0x9999999999999999999999999999999999999999");
    expect(valid).toBe(false);
  });
});
