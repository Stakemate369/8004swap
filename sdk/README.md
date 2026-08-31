# @stakemate/8004swap-agent-sdk

TypeScript client for an autonomous agent to connect to the 8004Swap Relay:
authentication handshake, EIP-712 quote signing, the RFQ flow, and on-chain settlement.
See [`PROTOCOL.md`](../PROTOCOL.md) in the repo root for the full message spec — this
package is its reference implementation.

```shell
npm install @stakemate/8004swap-agent-sdk
```

## Maker (quote incoming RFQs)

```ts
import { AgentClient, signQuote } from "@stakemate/8004swap-agent-sdk";
import { privateKeyToAccount } from "viem/accounts";

const client = new AgentClient({
  relayUrl: "wss://8arfgh3e11ds7dodiidv9bo7uo.ingress.zencloud.eu",
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

## Taker (request a quote and settle)

```ts
import { AgentClient, fillQuote, waitForFill } from "@stakemate/8004swap-agent-sdk";
import { createWalletClient, createPublicClient, http } from "viem";

const client = new AgentClient({ relayUrl, account, chainId, settlementAddress });
await client.connect();

const quotes = await client.requestQuote({ makerToken, takerToken, takerAmount: 1_000_000n });
if (quotes.length === 0) throw new Error("no quote within the window");

const best = quotes[0];
const hash = await fillQuote(walletClient, settlementAddress, best, best.signature);
const receipt = await waitForFill(publicClient, hash);
```

## What this package does NOT do

- Doesn't manage `approve`/allowance for you — call `fillQuoteWithPermit` (skips the
  separate approve tx, if the token supports EIP-2612) or approve manually beforehand.
- Doesn't decide maker price/strategy — the `onRfqBroadcast` callback is where that goes.
- Doesn't auto-reconnect on a WebSocket drop (yet) — handle `close`/`error` in your own
  code if you need retry behavior.
