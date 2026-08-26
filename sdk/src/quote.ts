import { verifyTypedData, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Quote } from "./types.js";

// tem que bater exatamente com EIP712("AgentRFQSettlement", "1") e o QUOTE_TYPEHASH
// de contracts/Settlement.sol — mudar aqui sem mudar lá (ou vice-versa) faz toda
// assinatura falhar a verificação on-chain
export function quoteDomain(chainId: number, settlementAddress: Address) {
  return {
    name: "AgentRFQSettlement",
    version: "1",
    chainId,
    verifyingContract: settlementAddress,
  } as const;
}

export const QUOTE_TYPES = {
  Quote: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "makerToken", type: "address" },
    { name: "takerToken", type: "address" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export async function signQuote(
  account: PrivateKeyAccount,
  chainId: number,
  settlementAddress: Address,
  quote: Quote
): Promise<Hex> {
  return account.signTypedData({
    domain: quoteDomain(chainId, settlementAddress),
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message: quote,
  });
}

export async function verifyQuoteSignature(
  chainId: number,
  settlementAddress: Address,
  quote: Quote,
  signature: Hex,
  expectedSigner: Address
): Promise<boolean> {
  return verifyTypedData({
    address: expectedSigner,
    domain: quoteDomain(chainId, settlementAddress),
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message: quote,
    signature,
  });
}
