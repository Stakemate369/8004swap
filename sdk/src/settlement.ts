import { zeroHash, type Address, type Hex, type WalletClient, type PublicClient, type Account, type Chain, type Transport } from "viem";
import type { Quote } from "./types.js";

// espelha o struct Quote do Settlement.sol (ver contracts/Settlement.sol)
const QUOTE_TUPLE_COMPONENTS = [
  { name: "maker", type: "address" },
  { name: "taker", type: "address" },
  { name: "makerToken", type: "address" },
  { name: "takerToken", type: "address" },
  { name: "makerAmount", type: "uint256" },
  { name: "takerAmount", type: "uint256" },
  { name: "expiry", type: "uint256" },
  { name: "nonce", type: "uint256" },
] as const;

export const SETTLEMENT_ABI = [
  {
    type: "function",
    name: "fillQuote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "q", type: "tuple", components: QUOTE_TUPLE_COMPONENTS },
      { name: "makerSignature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fillQuoteWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "q", type: "tuple", components: QUOTE_TUPLE_COMPONENTS },
      { name: "makerSignature", type: "bytes" },
      {
        name: "permit",
        type: "tuple",
        components: [
          { name: "value", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

export interface PermitData {
  value: bigint;
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
}

// deadline: 0n = "sem permit" (ver PermitData no Settlement.sol) — usa allowance
// convencional já existente em vez de tentar consumir um permit. r/s precisam ser
// bytes32 de verdade (32 bytes exatos) — "0x0" faz o encoder ABI do viem lançar
// AbiEncodingBytesSizeMismatchError antes mesmo de chegar na chain
export const NO_PERMIT: PermitData = { value: 0n, deadline: 0n, v: 0, r: zeroHash, s: zeroHash };

/** Chama Settlement.fillQuote(quote, signature) on-chain. Requer allowance prévio do taker sobre takerToken. */
export async function fillQuote(
  walletClient: WalletClient<Transport, Chain, Account>,
  settlementAddress: Address,
  quote: Quote,
  signature: Hex
): Promise<Hex> {
  return walletClient.writeContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "fillQuote",
    args: [quote, signature],
  });
}

/** Como fillQuote, mas aplica um permit EIP-2612 do taker sobre takerToken antes — poupa a tx de approve separada. */
export async function fillQuoteWithPermit(
  walletClient: WalletClient<Transport, Chain, Account>,
  settlementAddress: Address,
  quote: Quote,
  signature: Hex,
  permit: PermitData
): Promise<Hex> {
  return walletClient.writeContract({
    address: settlementAddress,
    abi: SETTLEMENT_ABI,
    functionName: "fillQuoteWithPermit",
    args: [quote, signature, permit],
  });
}

/** Aguarda a confirmação da tx de fill e devolve o receipt. */
export async function waitForFill(publicClient: PublicClient, hash: Hex) {
  return publicClient.waitForTransactionReceipt({ hash });
}
