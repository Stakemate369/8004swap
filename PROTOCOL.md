# Relay Protocol (WebSocket)

Format of messages exchanged with the Relay (`relay/src/server.ts`). Every message is
JSON with a `type` field. `bigint` always travels as a decimal `string` (JSON has no
native bigint support) and is converted back on the client.

Source of truth: `relay/src/types.ts`. This document is the readable version; in case
of divergence, the code wins.

## 1. Authentication handshake

The server starts every connection by sending a challenge. The client proves key
control by signing a plain message (not a tx, no gas spent).

```
Server → Client   { "type": "auth_challenge", "nonce": "<random hex>" }
Client → Server   { "type": "auth_response", "address": "0x...", "signature": "0x..." }
```

The signature is over the string `Login to 8004Swap Relay: <nonce>` (personal_sign /
EIP-191).

```
Server → Client   { "type": "auth_ok", "address": "0x..." }
               or  { "type": "error", "message": "..." }
```

The server rejects (`error`) if the signature is invalid **or** if
`registry.isActive(address)` returns `false` on-chain (agent not registered, paused,
or global pause active). No other message is accepted before `auth_ok`.

## 2. Maker: subscribe to a pair

```
Client → Server   { "type": "subscribe_pair", "makerToken": "0x...", "takerToken": "0x..." }
```

No explicit confirmation — from this point on, this connection receives every
`rfq_broadcast` for that exact pair (`makerToken`/`takerToken` in that order).

## 3. Taker: request a quote

```
Client → Server   {
  "type": "rfq_request",
  "requestId": "<optional, server-generated if absent>",
  "makerToken": "0x...",
  "takerToken": "0x...",
  "takerAmount": "1000000",
  "minMakerAmount": "0",          // optional, acceptance floor
  "expiresInMs": 3000              // optional, real ceiling is 30000ms
}
```

The server broadcasts to the pair's subscribers:

```
Server → Makers   {
  "type": "rfq_broadcast",
  "requestId": "...",
  "taker": "0x<address of the taker who requested>",
  "makerToken": "0x...",
  "takerToken": "0x...",
  "takerAmount": "1000000",
  "expiresAt": <epoch ms>
}
```

## 4. Maker: respond with a signed quote

```
Client → Server   {
  "type": "quote_response",
  "requestId": "...",
  "quote": {
    "maker": "0x...",
    "taker": "0x<always the taker from the rfq_broadcast, never zeroAddress>",
    "makerToken": "0x...",
    "takerToken": "0x...",
    "makerAmount": "...",
    "takerAmount": "...",
    "expiry": "<epoch seconds>",
    "nonce": "..."
  },
  "signature": "0x..."   // EIP-712 over `quote`, domain AgentRFQSettlement v1
}
```

**`quote.taker` must always be the exact address from the corresponding
`rfq_broadcast`.** The contract accepts `taker == address(0)` (anyone can fill), but
that opens the quote to front-running via calldata copying in the mempool — the
reference clients (`relay/examples/`) always pin the taker.

The server validates: correct EIP-712 signature, maker/taker still active on the
Registry, and that the terms match the original `rfq_request` exactly (same
taker/pair/`takerAmount`).

## 5. Server: best quote

When the RFQ window expires (`min(expiresInMs, 30000)`), the server ranks the
received quotes (highest `makerAmount` first, discards anything below
`minMakerAmount`) and returns them to the original taker only:

```
Server → Taker    {
  "type": "best_quotes",
  "requestId": "...",
  "quotes": [ { ...quote terms, "signature": "0x..." }, ... ]
}
```

## 6. Settlement (outside the Relay)

The taker takes the best `quote` + `signature` from the list and calls
`Settlement.fillQuote(quote, signature)` on-chain directly. The Relay **does not
participate** in settlement — it only matches. See `contracts/Settlement.sol` and
`relay/examples/settleTaker.ts` for the full flow.

**Permit variant:** if the taker doesn't yet have an allowance on `takerToken`, it can
call `Settlement.fillQuoteWithPermit(quote, signature, permit)` instead of
`fillQuote` — saves the separate `approve` tx, as long as `takerToken` supports
EIP-2612. `permit` is `{ value, deadline, v, r, s }`, a standard EIP-2612 signature
from the taker authorizing Settlement to spend `value` until `deadline`.
`permit.deadline == 0` is the explicit signal for "no permit" (uses the existing
conventional allowance) — the SDK exposes this as `NO_PERMIT`. An invalid or
already-consumed permit doesn't fail the fill: it's silently ignored, and the normal
allowance check proceeds. See `sdk/src/settlement.ts` (`fillQuoteWithPermit`,
`NO_PERMIT`).

## Errors

```
{ "type": "error", "requestId"?: "...", "message": "<text>" }
```

`requestId` present when the error is about a specific request/quote; absent for
session-level errors (e.g. a message sent before authenticating).

## Limits

- Rate limit per authenticated address: `RFQ_RATE_LIMIT_PER_MINUTE` (default 30/min)
  on `rfq_request`.
- RFQ window: at most 30 seconds, even if the client asks for more.
- `isActive()` cache: up to `REGISTRY_CACHE_TTL_MS` (default 30s) — a Registry pause
  can take up to that long to be reflected in the Relay.
- Concurrent WebSocket connections per IP: `MAX_CONNECTIONS_PER_IP` (default 20),
  even before the auth handshake — beyond that the connection is closed (code 1008).
