# @8004swap/agent-sdk

Cliente TypeScript pra um agente autônomo se conectar ao Relay do 8004Swap: handshake
de autenticação, assinatura EIP-712 de cotações, fluxo de RFQ e liquidação on-chain.
Ver [`PROTOCOL.md`](../PROTOCOL.md) na raiz do repo para a spec completa das mensagens
— este pacote é a implementação de referência dela.

Ainda não publicado no npm. Uso local: `npm install ../sdk` a partir do seu projeto,
ou copie o `dist/` depois de `npm run build`.

## Maker (cotar RFQs recebidas)

```ts
import { AgentClient, signQuote } from "@8004swap/agent-sdk";
import { privateKeyToAccount } from "viem/accounts";

const client = new AgentClient({
  relayUrl: "wss://tfafa12os5cu5fo0i4bakg8384.ingress.akash-palmito.org",
  account: privateKeyToAccount(process.env.MAKER_PRIVATE_KEY as `0x${string}`),
  chainId: 84532, // Base Sepolia
  settlementAddress: "0x5Cc2558dF13739c05cb57Caf0E9cfe1629a6a945",
});

await client.connect();
client.subscribePair(MAKER_TOKEN, TAKER_TOKEN);

client.onRfqBroadcast((rfq) => ({
  maker: client.address,
  taker: rfq.taker,
  makerToken: rfq.makerToken,
  takerToken: rfq.takerToken,
  makerAmount: (BigInt(rfq.takerAmount) * RATE_NUMERATOR) / RATE_DENOMINATOR,
  takerAmount: BigInt(rfq.takerAmount),
  expiry: BigInt(Math.floor(Date.now() / 1000) + 300),
  nonce: BigInt(Date.now()),
}));
```

## Taker (pedir cotação e liquidar)

```ts
import { AgentClient, fillQuote, waitForFill } from "@8004swap/agent-sdk";
import { createWalletClient, createPublicClient, http } from "viem";

const client = new AgentClient({ relayUrl, account, chainId, settlementAddress });
await client.connect();

const quotes = await client.requestQuote({ makerToken, takerToken, takerAmount: 1_000_000n });
if (quotes.length === 0) throw new Error("sem cotação dentro da janela");

const best = quotes[0];
const hash = await fillQuote(walletClient, settlementAddress, best, best.signature);
const receipt = await waitForFill(publicClient, hash);
```

## O que este pacote NÃO faz

- Não gerencia `approve`/allowance por você — chame `fillQuoteWithPermit` (evita a tx
  de approve separada, se o token suportar EIP-2612) ou aprove manualmente antes.
- Não decide preço/estratégia de maker — o callback `onRfqBroadcast` é onde isso entra.
- Não reconecta automaticamente numa queda de WebSocket (ainda) — trate `close`/`error`
  no seu próprio código se precisar de retry.
