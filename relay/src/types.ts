import type { Address, Hex } from "viem";

// espelha exatamente o struct Quote do Settlement.sol — mesma ordem de campos
// importa pro EIP-712, embora aqui viem monte pelos nomes, não pela ordem
export interface Quote {
  maker: Address;
  taker: Address; // zeroAddress = qualquer taker registrado pode preencher
  makerToken: Address;
  takerToken: Address;
  makerAmount: bigint;
  takerAmount: bigint;
  expiry: bigint;
  nonce: bigint;
}

export interface AuthChallengeMsg {
  type: "auth_challenge";
  nonce: string;
}

export interface AuthResponseMsg {
  type: "auth_response";
  address: Address;
  signature: Hex;
}

export interface AuthOkMsg {
  type: "auth_ok";
  address: Address;
}

export interface SubscribePairMsg {
  type: "subscribe_pair";
  makerToken: Address;
  takerToken: Address;
}

export interface RfqRequestMsg {
  type: "rfq_request";
  requestId: string;
  takerToken: Address;
  takerAmount: string; // string na rede, bigint internamente (JSON não tem bigint)
  makerToken: Address;
  minMakerAmount?: string;
  expiresInMs?: number;
}

export interface RfqBroadcastMsg {
  type: "rfq_broadcast";
  requestId: string;
  taker: Address;
  takerToken: Address;
  takerAmount: string;
  makerToken: Address;
  expiresAt: number; // epoch ms
}

export interface WireQuoteTerms {
  maker: Address;
  taker: Address;
  makerToken: Address;
  takerToken: Address;
  makerAmount: string;
  takerAmount: string;
  expiry: string;
  nonce: string;
}

export interface QuoteResponseMsg {
  type: "quote_response";
  requestId: string;
  quote: WireQuoteTerms;
  signature: Hex;
}

// cotação pronta pra liquidar on-chain: mesmos campos do quote_response, mais a
// assinatura do maker — sem isso o taker recebe os termos mas não consegue chamar
// settlement.fillQuote() de verdade (a assinatura é obrigatória no contrato)
export interface WireQuote extends WireQuoteTerms {
  signature: Hex;
}

export interface BestQuotesMsg {
  type: "best_quotes";
  requestId: string;
  quotes: WireQuote[];
}

export interface ErrorMsg {
  type: "error";
  requestId?: string;
  message: string;
}

export type InboundMsg = AuthResponseMsg | SubscribePairMsg | RfqRequestMsg | QuoteResponseMsg;
export type OutboundMsg = AuthChallengeMsg | AuthOkMsg | RfqBroadcastMsg | BestQuotesMsg | ErrorMsg;

export function pairKey(makerToken: Address, takerToken: Address): string {
  return `${makerToken.toLowerCase()}:${takerToken.toLowerCase()}`;
}
