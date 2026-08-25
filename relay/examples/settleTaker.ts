// Variante do takerClient.ts que, em vez de só imprimir a melhor cotação, chama
// settlement.fillQuote() on-chain de verdade — fecha o ciclo ponta a ponta
// (relay -> quote assinada -> liquidação) contra o deploy real da Sepolia.
//
// Rodar: npx tsx examples/settleTaker.ts
// com TAKER_PRIVATE_KEY, MAKER_TOKEN, TAKER_TOKEN, TAKER_AMOUNT, SETTLEMENT_ADDRESS,
// BASE_RPC_URL, CHAIN_ID no ambiente.

import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import type { BestQuotesMsg } from "../src/types.js";

const RELAY_URL = process.env.RELAY_URL ?? "ws://127.0.0.1:8787";
const account = privateKeyToAccount(process.env.TAKER_PRIVATE_KEY as Hex);
const MAKER_TOKEN = process.env.MAKER_TOKEN as Address;
const TAKER_TOKEN = process.env.TAKER_TOKEN as Address;
const TAKER_AMOUNT = process.env.TAKER_AMOUNT ?? "1000000";
const SETTLEMENT_ADDRESS = process.env.SETTLEMENT_ADDRESS as Address;
const RPC_URL = process.env.BASE_RPC_URL as string;
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 84532);

const chain = defineChain({
  id: CHAIN_ID,
  name: "custom",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

const FILL_QUOTE_ABI = [
  {
    type: "function",
    name: "fillQuote",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "q",
        type: "tuple",
        components: [
          { name: "maker", type: "address" },
          { name: "taker", type: "address" },
          { name: "makerToken", type: "address" },
          { name: "takerToken", type: "address" },
          { name: "makerAmount", type: "uint256" },
          { name: "takerAmount", type: "uint256" },
          { name: "expiry", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { name: "makerSignature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

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
        ws.close();
        process.exit(1);
      }

      const q = best.quotes[0];
      console.log(`[taker] fechando com maker=${q.maker}: ${q.makerAmount} makerToken por ${q.takerAmount} takerToken`);

      const quoteStruct = {
        maker: q.maker as Address,
        taker: (q.taker ?? "0x0000000000000000000000000000000000000000") as Address,
        makerToken: q.makerToken as Address,
        takerToken: q.takerToken as Address,
        makerAmount: BigInt(q.makerAmount),
        takerAmount: BigInt(q.takerAmount),
        expiry: BigInt(q.expiry),
        nonce: BigInt(q.nonce),
      };

      try {
        const hash = await walletClient.writeContract({
          address: SETTLEMENT_ADDRESS,
          abi: FILL_QUOTE_ABI,
          functionName: "fillQuote",
          args: [quoteStruct, q.signature as Hex],
        });
        console.log(`[taker] fillQuote enviado: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`[taker] confirmado no bloco ${receipt.blockNumber}, status=${receipt.status}`);
        ws.close();
        process.exit(receipt.status === "success" ? 0 : 1);
      } catch (err) {
        console.error("[taker] fillQuote falhou:", err instanceof Error ? err.message : err);
        ws.close();
        process.exit(1);
      }
      break;
    }

    case "error":
      console.error("[taker] erro do Relay:", msg.message);
      break;
  }
});
