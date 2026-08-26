import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { signQuote, verifyQuoteSignature } from "../src/quote.js";
import type { Quote } from "../src/types.js";

// chave de teste conhecida (Anvil #0) — nunca usar em mainnet de verdade
const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(TEST_PRIVATE_KEY);
const CHAIN_ID = 84532;
const SETTLEMENT_ADDRESS = "0x5Cc2558dF13739c05cb57Caf0E9cfe1629a6a945" as const;

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

describe("signQuote / verifyQuoteSignature", () => {
  it("verifica uma cotação assinada corretamente", async () => {
    const quote = sampleQuote();
    const signature = await signQuote(account, CHAIN_ID, SETTLEMENT_ADDRESS, quote);
    const valid = await verifyQuoteSignature(CHAIN_ID, SETTLEMENT_ADDRESS, quote, signature, account.address);
    expect(valid).toBe(true);
  });

  it("rejeita assinatura de uma cotação com valor alterado depois de assinada", async () => {
    const quote = sampleQuote();
    const signature = await signQuote(account, CHAIN_ID, SETTLEMENT_ADDRESS, quote);
    const tampered = { ...quote, makerAmount: 999_999n };
    const valid = await verifyQuoteSignature(CHAIN_ID, SETTLEMENT_ADDRESS, tampered, signature, account.address);
    expect(valid).toBe(false);
  });

  it("rejeita assinatura contra chainId diferente do usado pra assinar (domain EIP-712 muda)", async () => {
    const quote = sampleQuote();
    const signature = await signQuote(account, CHAIN_ID, SETTLEMENT_ADDRESS, quote);
    const valid = await verifyQuoteSignature(8453, SETTLEMENT_ADDRESS, quote, signature, account.address);
    expect(valid).toBe(false);
  });

  it("rejeita assinatura contra settlementAddress diferente (verifyingContract muda o domain)", async () => {
    const quote = sampleQuote();
    const signature = await signQuote(account, CHAIN_ID, SETTLEMENT_ADDRESS, quote);
    const valid = await verifyQuoteSignature(
      CHAIN_ID,
      "0x9999999999999999999999999999999999999999",
      quote,
      signature,
      account.address
    );
    expect(valid).toBe(false);
  });
});
