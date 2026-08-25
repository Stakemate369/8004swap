// Exemplo de agente "taker": conecta no Relay, pede uma cotação, imprime a
// melhor resposta recebida e encerra.
//
// Rodar: node --env-file=.env --experimental-strip-types examples/takerClient.ts
// com TAKER_PRIVATE_KEY, MAKER_TOKEN, TAKER_TOKEN e TAKER_AMOUNT no ambiente.

import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import type { BestQuotesMsg } from "../src/types.js";

const RELAY_URL = process.env.RELAY_URL ?? "ws://127.0.0.1:8787";
const account = privateKeyToAccount(process.env.TAKER_PRIVATE_KEY as Hex);
const MAKER_TOKEN = process.env.MAKER_TOKEN as Address; // o que o taker quer receber
const TAKER_TOKEN = process.env.TAKER_TOKEN as Address; // o que o taker vai pagar
const TAKER_AMOUNT = process.env.TAKER_AMOUNT ?? "1000000";

const ws = new WebSocket(RELAY_URL);

ws.on("open", () => console.log(`[taker ${account.address}] conectado ao Relay`));

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());

  switch (msg.type) {
    case "auth_challenge": {
      const signature = await account.signMessage({ message: `Login to 8004Swap Relay: ${msg.nonce}` });
      ws.send(JSON.stringify({ type: "auth_response", address: account.address, signature }));
      break;
    }

    case "auth_ok": {
      const requestId = randomUUID();
      console.log(`[taker] pedindo cotação ${requestId}: pagando ${TAKER_AMOUNT} de ${TAKER_TOKEN} por ${MAKER_TOKEN}`);
      ws.send(
        JSON.stringify({
          type: "rfq_request",
          requestId,
          takerToken: TAKER_TOKEN,
          takerAmount: TAKER_AMOUNT,
          makerToken: MAKER_TOKEN,
          minMakerAmount: "0",
          expiresInMs: 3000,
        })
      );
      break;
    }

    case "best_quotes": {
      const best = msg as BestQuotesMsg;
      if (best.quotes.length === 0) {
        console.log("[taker] nenhuma cotação recebida dentro da janela");
      } else {
        console.log(`[taker] ${best.quotes.length} cotação(ões) recebida(s), melhor primeiro:`);
        for (const q of best.quotes) {
          console.log(`  maker=${q.maker} oferece ${q.makerAmount} makerToken por ${q.takerAmount} takerToken`);
        }
        console.log("[taker] próximo passo seria chamar settlement.fillQuote(quotes[0], signature) on-chain");
      }
      ws.close();
      process.exit(0);
      break;
    }

    case "error":
      console.error("[taker] erro do Relay:", msg.message);
      break;
  }
});
