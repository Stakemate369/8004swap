import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { Address } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { signQuote } from "./quote.js";
import { quoteFromWire, quoteTermsToWire } from "./types.js";
import type { InboundMsg, OutboundMsg, Quote, RfqBroadcastMsg, SignedQuote } from "./types.js";

export interface AgentClientOptions {
  relayUrl: string;
  account: PrivateKeyAccount;
  chainId: number;
  settlementAddress: Address;
  /** timeout do handshake de auth em connect(); default 10s. */
  authTimeoutMs?: number;
}

export interface RequestQuoteParams {
  makerToken: Address;
  takerToken: Address;
  takerAmount: bigint;
  minMakerAmount?: bigint;
  /** teto real aplicado pelo Relay é 30s, mesmo se você pedir mais (ver PROTOCOL.md) */
  expiresInMs?: number;
}

/** devolvido pelo maker em resposta a um rfq_broadcast; `null`/`undefined` = não cotar essa RFQ */
export type RfqHandler = (rfq: RfqBroadcastMsg) => Promise<Quote | null | undefined> | Quote | null | undefined;

/**
 * Cliente de agente pro Relay do 8004Swap: encapsula o handshake de autenticação
 * (assinatura de login), o fluxo de RFQ (subscribe/broadcast/quote/best_quotes) e a
 * assinatura EIP-712 das cotações. Não faz a liquidação on-chain — ver `settlement.ts`
 * para isso. Spec completa das mensagens em PROTOCOL.md na raiz do repo.
 */
export class AgentClient {
  private ws: WebSocket | null = null;
  private authWaiter: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private pendingRequests = new Map<string, (quotes: SignedQuote[]) => void>();
  private rfqHandler: RfqHandler | null = null;

  constructor(private readonly opts: AgentClientOptions) {}

  get address(): Address {
    return this.opts.account.address;
  }

  /**
   * Abre a conexão e resolve quando `auth_ok` chega (ou rejeita se a auth falhar,
   * fechar, ou não completar dentro de `authTimeoutMs`). Sem esse timeout, um relay
   * que aceita o socket mas nunca manda auth_challenge/auth_ok (sob carga, no meio
   * de um restart, um proxy intermediário que segura a conexão) travaria essa
   * promise pra sempre, sem `error` nem `close` disparando.
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.relayUrl);
      this.ws = ws;

      const timeoutMs = this.opts.authTimeoutMs ?? 10_000;
      const timer = setTimeout(() => {
        this.failAuth(new Error(`autenticação não completou em ${timeoutMs}ms`));
        ws.close();
      }, timeoutMs);

      this.authWaiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };

      ws.on("message", (raw) => void this.handleMessage(raw.toString()));
      ws.on("error", (err) => {
        this.failAuth(err instanceof Error ? err : new Error(String(err)));
        this.drainPendingRequests();
      });
      ws.on("close", () => {
        this.failAuth(new Error("conexão fechada antes de autenticar"));
        this.drainPendingRequests();
      });
    });
  }

  /** Registra o handler chamado a cada rfq_broadcast recebido (papel de maker). */
  onRfqBroadcast(handler: RfqHandler): void {
    this.rfqHandler = handler;
  }

  /** Inscreve esta conexão como maker no par (papel de maker). */
  subscribePair(makerToken: Address, takerToken: Address): void {
    this.send({ type: "subscribe_pair", makerToken, takerToken });
  }

  /**
   * Pede cotação e aguarda a janela de coleta do Relay fechar (papel de taker).
   * Resolve com a lista já rankeada (maior makerAmount primeiro); lista vazia = sem cotação.
   */
  requestQuote(params: RequestQuoteParams): Promise<SignedQuote[]> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      // manda primeiro, só registra em pendingRequests se o send funcionar — na
      // ordem inversa, um send() que lança (ex: chamado antes de connect() terminar)
      // deixaria a entrada no Map pra sempre, já que nada mais a removeria
      try {
        this.send({
          type: "rfq_request",
          requestId,
          makerToken: params.makerToken,
          takerToken: params.takerToken,
          takerAmount: params.takerAmount.toString(),
          minMakerAmount: (params.minMakerAmount ?? 0n).toString(),
          expiresInMs: params.expiresInMs,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.pendingRequests.set(requestId, resolve);
    });
  }

  close(): void {
    this.ws?.close();
  }

  private failAuth(err: Error): void {
    if (!this.authWaiter) return;
    this.authWaiter.reject(err);
    this.authWaiter = null;
  }

  // sem isso, um requestQuote() em andamento quando a conexão cai (queda de rede,
  // restart do relay) nunca resolve — a promise do chamador fica pendurada pra
  // sempre e a entrada correspondente vaza no Map por toda a vida do processo
  private drainPendingRequests(): void {
    for (const resolve of this.pendingRequests.values()) resolve([]);
    this.pendingRequests.clear();
  }

  private send(msg: OutboundMsg): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      throw new Error("AgentClient: não conectado (chame connect() antes)");
    }
    this.ws.send(JSON.stringify(msg));
  }

  private async handleMessage(raw: string): Promise<void> {
    let msg: InboundMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "auth_challenge": {
        const signature = await this.opts.account.signMessage({
          message: `Login to 8004Swap Relay: ${msg.nonce}`,
        });
        this.send({ type: "auth_response", address: this.opts.account.address, signature });
        break;
      }

      case "auth_ok":
        this.authWaiter?.resolve();
        this.authWaiter = null;
        break;

      case "rfq_broadcast":
        await this.handleRfqBroadcast(msg);
        break;

      case "best_quotes": {
        const resolve = this.pendingRequests.get(msg.requestId);
        if (resolve) {
          this.pendingRequests.delete(msg.requestId);
          resolve(msg.quotes.map(quoteFromWire));
        }
        break;
      }

      case "error":
        // erro ligado a um rfq_request pendente (ex: rate limit) resolve como
        // "nenhuma cotação" em vez de deixar a promise pendurada pra sempre
        if (msg.requestId) {
          const resolve = this.pendingRequests.get(msg.requestId);
          if (resolve) {
            this.pendingRequests.delete(msg.requestId);
            resolve([]);
          }
        }
        break;
    }
  }

  private async handleRfqBroadcast(rfq: RfqBroadcastMsg): Promise<void> {
    if (!this.rfqHandler) return;
    const quote = await this.rfqHandler(rfq);
    if (!quote) return;

    const signature = await signQuote(this.opts.account, this.opts.chainId, this.opts.settlementAddress, quote);
    this.send({ type: "quote_response", requestId: rfq.requestId, quote: quoteTermsToWire(quote), signature });
  }
}
