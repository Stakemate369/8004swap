# @8004swap/mcp-server

Exposes 8004Swap as [MCP](https://modelcontextprotocol.io) tools, so any MCP-capable
agent (Claude, or any other MCP client) can request quotes, settle trades, and check
Registry status directly — no human clicking through a UI in between.

Thin wrapper around `@8004swap/agent-sdk`; see [`../PROTOCOL.md`](../PROTOCOL.md) for
what actually happens on the wire.

## Tools

- **`check_agent_status`** — read-only, no key needed. Checks if an address is
  registered + active on the 8004Swap Registry.
- **`register_agent`** — one-time self-registration on the Registry. Signs + broadcasts
  a transaction with `AGENT_PRIVATE_KEY`.
- **`request_quote`** — acts as taker: broadcasts an RFQ over the Relay, returns signed
  quotes from subscribed makers. Needs `AGENT_PRIVATE_KEY` to authenticate to the Relay
  (this step costs no gas, it's an off-chain login signature).
- **`fill_quote`** — acts as taker: settles a quote returned by `request_quote` on-chain
  via `Settlement.fillQuote` (or `fillQuoteWithPermit` if you pass a `permit`). Signs +
  broadcasts a transaction.
- **`pay_x402`** — pays for *any* [x402](https://github.com/coinbase/x402)-gated HTTP
  resource (protocol v2) using the configured agent's funds: fetches the URL, and if it
  answers 402 with a payment requirement, signs an EIP-3009 `transferWithAuthorization`
  and retries. Only the `exact` scheme with the `eip3009` transfer method is supported
  (the common case for USDC-like tokens); Permit2/ERC-7710 offers are rejected. Not
  specific to 8004Swap's own protocol — this is how an agent that just swapped into
  USDC via `fill_quote` can turn around and pay some other agent's x402-gated service
  with it. `maxAmountAtomic` is required on every call and is the only spending limit —
  always set it to the most you're willing to authorize for that one call.

There's currently no tool for acting as a *maker* (subscribing to a pair and responding
to broadcasts) — that role needs a long-lived connection reacting to inbound RFQs,
which doesn't fit MCP's request/response tool-call model well. Use
`sdk`/`relay/examples/makerClient.ts` directly for that role today.

## Setup

```shell
npm install
npm run build
cp .env.example .env   # fill in AGENT_PRIVATE_KEY if you want to sign anything
```

Defaults in `.env.example` point at the current Base Sepolia deployment — override
`RPC_URL`/`CHAIN_ID`/`REGISTRY_ADDRESS`/`SETTLEMENT_ADDRESS`/`RELAY_URL` for a different
network once one exists.

**`AGENT_PRIVATE_KEY` is only needed for `register_agent`, `request_quote`, and
`fill_quote`.** Generate a dedicated wallet for this agent — never point this at a key
that holds funds outside this testnet. There is no key rotation or scoping built in:
whoever has this env var can sign as that address.

## Running

As a standalone stdio MCP server:

```shell
npm start
```

Point an MCP client at it, e.g. in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "8004swap": {
      "command": "node",
      "args": ["/absolute/path/to/8004swap/mcp-server/dist/index.js"],
      "env": {
        "AGENT_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

## Status

Testnet only, same as the rest of the repo. No formal audit. `fill_quote` and
`register_agent` broadcast real (testnet) transactions — there is no dry-run mode.
