import type { Address } from "viem";
import { pairKey } from "./types.js";

export interface RankedQuote {
  maker: Address;
  taker: Address;
  makerToken: Address;
  takerToken: Address;
  makerAmount: bigint;
  takerAmount: bigint;
  expiry: bigint;
  nonce: bigint;
}

// maior makerAmount primeiro (quem dá mais, pro mesmo takerAmount, ganha); descarta
// qualquer cotação abaixo do piso que o taker pediu
export function rankQuotes(quotes: RankedQuote[], minMakerAmount: bigint): RankedQuote[] {
  return quotes
    .filter((q) => q.makerAmount >= minMakerAmount)
    .sort((a, b) => (a.makerAmount === b.makerAmount ? 0 : a.makerAmount > b.makerAmount ? -1 : 1));
}

interface OpenRfqParams {
  requestId: string;
  taker: Address;
  takerToken: Address;
  takerAmount: bigint;
  makerToken: Address;
  minMakerAmount: bigint;
}

interface PendingRfq extends OpenRfqParams {
  quotes: RankedQuote[];
  timer: ReturnType<typeof setTimeout>;
}

export type SubmitQuoteResult = { ok: true } | { ok: false; reason: string };

// lógica pura de matching — desacoplada do WebSocket de propósito, pra dar pra
// testar sem precisar abrir socket nenhum
export class RfqManager {
  private subscribers = new Map<string, Set<string>>(); // pairKey -> ids de conexão inscritos como maker
  private pending = new Map<string, PendingRfq>();

  subscribe(connId: string, makerToken: Address, takerToken: Address): void {
    const key = pairKey(makerToken, takerToken);
    if (!this.subscribers.has(key)) this.subscribers.set(key, new Set());
    this.subscribers.get(key)!.add(connId);
  }

  unsubscribeAll(connId: string): void {
    for (const set of this.subscribers.values()) set.delete(connId);
  }

  subscribersFor(makerToken: Address, takerToken: Address): string[] {
    return [...(this.subscribers.get(pairKey(makerToken, takerToken)) ?? [])];
  }

  openRfq(params: OpenRfqParams, windowMs: number, onResolve: (requestId: string, quotes: RankedQuote[]) => void): void {
    const timer = setTimeout(() => {
      const rfq = this.pending.get(params.requestId);
      this.pending.delete(params.requestId);
      if (rfq) onResolve(params.requestId, rankQuotes(rfq.quotes, rfq.minMakerAmount));
    }, windowMs);

    this.pending.set(params.requestId, { ...params, quotes: [], timer });
  }

  // confere que a cotação do maker bate com o que foi de fato pedido — um maker não
  // pode responder uma RFQ com termos diferentes do que o taker pediu
  submitQuote(requestId: string, quote: RankedQuote): SubmitQuoteResult {
    const rfq = this.pending.get(requestId);
    if (!rfq) return { ok: false, reason: "rfq desconhecida ou já expirada" };

    const sameTerms =
      quote.taker.toLowerCase() === rfq.taker.toLowerCase() &&
      quote.takerToken.toLowerCase() === rfq.takerToken.toLowerCase() &&
      quote.makerToken.toLowerCase() === rfq.makerToken.toLowerCase() &&
      quote.takerAmount === rfq.takerAmount;

    if (!sameTerms) {
      return { ok: false, reason: "cotação não corresponde ao pedido original" };
    }

    rfq.quotes.push(quote);
    return { ok: true };
  }
}
