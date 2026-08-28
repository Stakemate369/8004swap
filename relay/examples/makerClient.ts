// Exemplo de agente "maker": conecta no Relay, se inscreve num par de token, e
// responde toda RFQ que receber com uma cotação assinada, a uma taxa fixa simples.
//
// Rodar: npx tsx --env-file=.env examples/makerClient.ts
// (node --experimental-strip-types falha em Node >=24 nesse arquivo: os imports
// usam extensao .js apontando pra .ts, resolucao que o strip-types nativo do
// node nao faz, so tsx) com MAKER_PRIVATE_KEY, MAKER_TOKEN, TAKER_TOKEN e
// RATE_NUMERATOR/RATE_DENOMINATOR definidos no ambiente.

import WebSocket from "ws";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { QUOTE_DOMAIN, QUOTE_TYPES } from "../src/eip712.js";
import type { RfqBroadcastMsg } from "../src/types.js";

const RELAY_URL = process.env.RELAY_URL ?? "ws://127.0.0.1:8787";
const account = privateKeyToAccount(process.env.MAKER_PRIVATE_KEY as Hex);
const MAKER_TOKEN = process.env.MAKER_TOKEN as Address;
const TAKER_TOKEN = process.env.TAKER_TOKEN as Address;
// quanto de makerToken o maker dá por unidade de takerToken recebido — expresso
// como fração exata (numerador/denominador) pra fazer a conta em bigint sem perder precisão
const RATE_NUMERATOR = BigInt(process.env.RATE_NUMERATOR ?? "1");
const RATE_DENOMINATOR = BigInt(process.env.RATE_DENOMINATOR ?? "1");

const ws = new WebSocket(RELAY_URL);

ws.on("open", () => console.log(`[maker ${account.address}] conectado ao Relay`));

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());

  switch (msg.type) {
    case "auth_challenge": {
      const signature = await account.signMessage({ message: `Login to 8004Swap Relay: ${msg.nonce}` });
      ws.send(JSON.stringify({ type: "auth_response", address: account.address, signature }));
      break;
    }

    case "auth_ok": {
      console.log(`[maker] autenticado, inscrevendo no par ${MAKER_TOKEN} <- ${TAKER_TOKEN}`);
      ws.send(JSON.stringify({ type: "subscribe_pair", makerToken: MAKER_TOKEN, takerToken: TAKER_TOKEN }));
      break;
    }

    case "rfq_broadcast": {
      const rfq = msg as RfqBroadcastMsg;
      const takerAmount = BigInt(rfq.takerAmount);
      const makerAmount = (takerAmount * RATE_NUMERATOR) / RATE_DENOMINATOR;

      const quote = {
        maker: account.address,
        taker: rfq.taker,
        makerToken: rfq.makerToken,
        takerToken: rfq.takerToken,
        makerAmount,
        takerAmount,
        expiry: BigInt(Math.floor(Date.now() / 1000) + 300),
        nonce: BigInt(Date.now()),
      };

      const signature = await account.signTypedData({
        domain: QUOTE_DOMAIN,
        types: QUOTE_TYPES,
        primaryType: "Quote",
        message: quote,
      });

      console.log(`[maker] cotando RFQ ${rfq.requestId}: ${makerAmount} makerToken por ${takerAmount} takerToken`);

      ws.send(
        JSON.stringify({
          type: "quote_response",
          requestId: rfq.requestId,
          quote: {
            maker: quote.maker,
            taker: quote.taker,
            makerToken: quote.makerToken,
            takerToken: quote.takerToken,
            makerAmount: quote.makerAmount.toString(),
            takerAmount: quote.takerAmount.toString(),
            expiry: quote.expiry.toString(),
            nonce: quote.nonce.toString(),
          },
          signature,
        })
      );
      break;
    }

    case "error":
      console.error("[maker] erro do Relay:", msg.message);
      break;
  }
});

