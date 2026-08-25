import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyMessage, type Address } from "viem";
import { config } from "./config.js";
import { isAgentActive } from "./registryClient.js";
import { verifyQuoteSignature } from "./eip712.js";
import { RfqManager, type RankedQuote } from "./rfqManager.js";
import { FixedWindowRateLimiter } from "./rateLimit.js";
import type {
  InboundMsg,
  OutboundMsg,
  QuoteResponseMsg,
  RfqRequestMsg,
  SubscribePairMsg,
} from "./types.js";

interface ConnState {
  id: string;
  socket: WebSocket;
  address: Address | null;
  challengeNonce: string;
}

const manager = new RfqManager();
const rfqRateLimiter = new FixedWindowRateLimiter(config.rfqRateLimitPerMinute, 60_000);
const connections = new Map<string, ConnState>();

function send(conn: ConnState, msg: OutboundMsg): void {
  if (conn.socket.readyState === conn.socket.OPEN) {
    conn.socket.send(JSON.stringify(msg));
  }
}

function loginMessage(nonce: string): string {
  return `Login to 8004Swap Relay: ${nonce}`;
}

function toRankedQuote(q: QuoteResponseMsg["quote"]): RankedQuote {
  return {
    maker: q.maker,
    taker: q.taker,
    makerToken: q.makerToken,
    takerToken: q.takerToken,
    makerAmount: BigInt(q.makerAmount),
    takerAmount: BigInt(q.takerAmount),
    expiry: BigInt(q.expiry),
    nonce: BigInt(q.nonce),
  };
}

function toWireQuote(q: RankedQuote): QuoteResponseMsg["quote"] {
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

async function handleAuthResponse(conn: ConnState, msg: Extract<InboundMsg, { type: "auth_response" }>) {
  const validSig = await verifyMessage({
    address: msg.address,
    message: loginMessage(conn.challengeNonce),
    signature: msg.signature,
  }).catch(() => false);

  if (!validSig) {
    send(conn, { type: "error", message: "assinatura de login inválida" });
    return;
  }

  const active = await isAgentActive(msg.address).catch(() => false);
  if (!active) {
    send(conn, { type: "error", message: "endereço não registrado ou pausado no Registry" });
    return;
  }

  conn.address = msg.address;
  send(conn, { type: "auth_ok", address: msg.address });
}

function handleSubscribePair(conn: ConnState, msg: SubscribePairMsg) {
  if (!conn.address) return send(conn, { type: "error", message: "autentique-se antes de se inscrever" });
  manager.subscribe(conn.id, msg.makerToken, msg.takerToken);
}

async function handleRfqRequest(conn: ConnState, msg: RfqRequestMsg) {
  if (!conn.address) return send(conn, { type: "error", message: "autentique-se antes de pedir cotação" });

  if (!rfqRateLimiter.tryConsume(conn.address.toLowerCase())) {
    return send(conn, { type: "error", requestId: msg.requestId, message: "limite de pedidos por minuto excedido" });
  }

  const requestId = msg.requestId || randomUUID();
  const taker = conn.address;
  const takerAmount = BigInt(msg.takerAmount);
  const minMakerAmount = BigInt(msg.minMakerAmount ?? "0");
  const windowMs = Math.min(msg.expiresInMs ?? config.rfqWindowMs, 30_000); // teto de 30s pra não segurar recurso indefinidamente

  const subscribers = manager.subscribersFor(msg.makerToken, msg.takerToken);
  const expiresAt = Date.now() + windowMs;
  for (const subId of subscribers) {
    const sub = connections.get(subId);
    if (!sub || sub.id === conn.id) continue;
    send(sub, {
      type: "rfq_broadcast",
      requestId,
      taker,
      takerToken: msg.takerToken,
      takerAmount: msg.takerAmount,
      makerToken: msg.makerToken,
      expiresAt,
    });
  }

  manager.openRfq(
    { requestId, taker, takerToken: msg.takerToken, takerAmount, makerToken: msg.makerToken, minMakerAmount },
    windowMs,
    (id, quotes) => {
      send(conn, { type: "best_quotes", requestId: id, quotes: quotes.map(toWireQuote) });
    }
  );
}

async function handleQuoteResponse(conn: ConnState, msg: QuoteResponseMsg) {
  if (!conn.address) return send(conn, { type: "error", message: "autentique-se antes de cotar" });
  if (msg.quote.maker.toLowerCase() !== conn.address.toLowerCase()) {
    return send(conn, { type: "error", requestId: msg.requestId, message: "maker da cotação difere do endereço autenticado" });
  }

  const quote = toRankedQuote(msg.quote);

  const [makerActive, takerActive] = await Promise.all([
    isAgentActive(quote.maker),
    isAgentActive(quote.taker),
  ]);
  if (!makerActive || !takerActive) {
    return send(conn, { type: "error", requestId: msg.requestId, message: "maker ou taker inativo no Registry" });
  }

  const validSig = await verifyQuoteSignature(quote, msg.signature, quote.maker).catch(() => false);
  if (!validSig) {
    return send(conn, { type: "error", requestId: msg.requestId, message: "assinatura da cotação inválida" });
  }

  const result = manager.submitQuote(msg.requestId, quote);
  if (!result.ok) {
    send(conn, { type: "error", requestId: msg.requestId, message: result.reason });
  }
}

export function startServer(): WebSocketServer {
  // servidor HTTP explícito, não só o WS — proxies de ingress (Akash, load balancers em
  // geral) costumam fazer uma checagem HTTP simples antes de liberar tráfego; um
  // WebSocketServer criado só com {port} não responde requisição HTTP normal nenhuma,
  // o que trava a checagem e derruba a conexão com 502
  const httpServer = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("8004Swap Relay ok");
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket) => {
    const conn: ConnState = {
      id: randomUUID(),
      socket,
      address: null,
      challengeNonce: randomBytes(16).toString("hex"),
    };
    connections.set(conn.id, conn);
    send(conn, { type: "auth_challenge", nonce: conn.challengeNonce });

    socket.on("message", (raw) => {
      let msg: InboundMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(conn, { type: "error", message: "JSON inválido" });
      }

      switch (msg.type) {
        case "auth_response":
          void handleAuthResponse(conn, msg);
          break;
        case "subscribe_pair":
          handleSubscribePair(conn, msg);
          break;
        case "rfq_request":
          void handleRfqRequest(conn, msg);
          break;
        case "quote_response":
          void handleQuoteResponse(conn, msg);
          break;
        default:
          send(conn, { type: "error", message: "tipo de mensagem desconhecido" });
      }
    });

    socket.on("close", () => {
      manager.unsubscribeAll(conn.id);
      connections.delete(conn.id);
    });
  });

  httpServer.listen(config.port, () => {
    console.log(`Relay ouvindo na porta ${config.port}`);
  });
  return wss;
}

startServer();
