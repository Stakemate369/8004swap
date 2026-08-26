import type { Address, Hex } from "viem";

// espelha exatamente o struct Quote do Settlement.sol — ver PROTOCOL.md na raiz do
// repo pra spec completa das mensagens do Relay. Deliberadamente não importa nada
// de relay/src: este pacote é publicável e não deve depender do processo do Relay.
export interface Quote {
  maker: Address;
  taker: Address; // zeroAddress = qualquer taker registrado pode preencher (evite: ver PROTOCOL.md)
  makerToken: Address;
  takerToken: Address;
  makerAmount: bigint;
  takerAmount: bigint;
  expiry: bigint;
  nonce: bigint;
}

export interface SignedQuote extends Quote {
  signature: Hex;
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

export interface WireQuote extends WireQuoteTerms {
  signature: Hex;
}

export interface AuthChallengeMsg {
  type: "auth_challenge";
  nonce: string;
}

export interface AuthOkMsg {
  type: "auth_ok";
  address: Address;
}

export interface RfqBroadcastMsg {
  type: "rfq_broadcast";
  requestId: string;
  taker: Address;
  takerToken: Address;
  takerAmount: string;
  makerToken: Address;
  expiresAt: number;
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

export type InboundMsg = AuthChallengeMsg | AuthOkMsg | RfqBroadcastMsg | BestQuotesMsg | ErrorMsg;

export interface AuthResponseMsg {
  type: "auth_response";
  address: Address;
  signature: Hex;
}

export interface SubscribePairMsg {
  type: "subscribe_pair";
  makerToken: Address;
  takerToken: Address;
}

export interface RfqRequestMsg {
  type: "rfq_request";
  requestId: string;
  makerToken: Address;
  takerToken: Address;
  takerAmount: string;
  minMakerAmount?: string;
  expiresInMs?: number;
}

export interface QuoteResponseMsg {
  type: "quote_response";
  requestId: string;
  quote: WireQuoteTerms;
  signature: Hex;
}

export type OutboundMsg = AuthResponseMsg | SubscribePairMsg | RfqRequestMsg | QuoteResponseMsg;

export function quoteTermsToWire(q: Quote): WireQuoteTerms {
  return {
    maker: q.maker,
    taker: q.taker,
    makerToken: q.makerToken,
    takerToken: q.takerToken,
    makerAmount: q.makerAmount.toString(),
    takerAmount: q.takerAmount.toString(),
    expiry: q.expiry.toString(),
    nonce: q.nonce.toString(),
  };
}

export function quoteToWire(q: SignedQuote): WireQuote {
  return { ...quoteTermsToWire(q), signature: q.signature };
}

export function quoteFromWire(w: WireQuote): SignedQuote {
  return {
    maker: w.maker,
    taker: w.taker,
    makerToken: w.makerToken,
    takerToken: w.takerToken,
    makerAmount: BigInt(w.makerAmount),
    takerAmount: BigInt(w.takerAmount),
    expiry: BigInt(w.expiry),
    nonce: BigInt(w.nonce),
    signature: w.signature,
  };
}
