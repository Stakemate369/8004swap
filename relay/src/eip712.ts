import { verifyTypedData, type Address, type Hex } from "viem";
import type { Quote } from "./types.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`eip712: variável de ambiente ${name} não definida`);
  }
  return value;
}

// só depende de SETTLEMENT_ADDRESS/CHAIN_ID — de propósito, não importa o config.ts
// do servidor inteiro (que exige BASE_RPC_URL/REGISTRY_ADDRESS), porque os clientes
// de exemplo (maker/taker) também importam este arquivo e não precisam do resto
//
// tem que bater exatamente com o EIP712("AgentRFQSettlement", "1") do Settlement.sol —
// mudar qualquer coisa aqui sem mudar lá (ou vice-versa) faz toda assinatura falhar
export const QUOTE_DOMAIN = {
  name: "AgentRFQSettlement",
  version: "1",
  chainId: Number(process.env.CHAIN_ID ?? 8453),
  verifyingContract: requireEnv("SETTLEMENT_ADDRESS") as Address,
} as const;

// mesma ordem de campos do QUOTE_TYPEHASH em Settlement.sol
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

export async function verifyQuoteSignature(quote: Quote, signature: Hex, expectedSigner: Address): Promise<boolean> {
  return verifyTypedData({
    address: expectedSigner,
    domain: QUOTE_DOMAIN,
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message: quote,
    signature,
  });
}
