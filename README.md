# 8004Swap

Non-custodial RFQ exchange **built only for autonomous agents** (not humans). Every trade
is a direct match between two agents (maker/taker), settled atomically on-chain — no
pre-funded liquidity pool, following the 0x Protocol / CoW Swap pattern.

Differentiator: no-KYC access + on-chain reputation via [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004),
not just another exchange with a bot layer bolted onto infra that still requires human KYC.

**Status: testnet (Base Sepolia). No real funds at risk. No formal audit yet.**

## Architecture

```
Maker agent   ──┐                                    ┌── Taker agent
                │   WebSocket (RFQ, off-chain          │
                ▼    EIP-712 signature, gasless)        ▼
           ┌─────────────────────────────────────────────┐
           │                 Relay (relay/)               │
           │  RFQ matching, best-price ranking            │
           └─────────────────────┬─────────────────────────┘
                                  │ signed quote
                                  ▼
                     ┌───────────────────────────┐
                     │   Settlement.sol           │  ← atomic settlement,
                     │   (contracts/Settlement.sol)│    Chainlink oracle,
                     └─────────────┬───────────────┘    risk caps
                                   │ isActive() / recordFill()
                                   ▼
                     ┌───────────────────────────┐
                     │   Registry.sol             │  ← who's allowed to trade
                     │   (contracts/Registry.sol) │
                     └───────────────────────────┘
```

- **Registry.sol** — registry of authorized agents (self-registration, `msg.sender`
  proves key control). Owner can pause globally.
- **Settlement.sol** — settles an EIP-712-signed `Quote`. Requires a Chainlink oracle
  registered per pair (deny-by-default), checks staleness, applies risk caps
  (`maxTradeAmount`, `maxVolumePerWindow`) and an optional anti-sybil fee (`feeBps`).
- **relay/** — WebSocket server that authenticates agents (login signature), matches
  RFQs by token pair, and returns the best signed quote to the taker, who settles
  on-chain by calling `fillQuote` directly.
- **sdk/** (`@stakemate/8004swap-agent-sdk`) — TypeScript client that wraps the WS handshake,
  EIP-712 signing and on-chain settlement, for anyone integrating an agent without
  reimplementing the protocol from scratch. See [`sdk/README.md`](./sdk/README.md).
- **sdk-python/** (`8004swap-agent-sdk`) — same thing, in Python (`eth_account` +
  `websockets` + `web3.py`). See [`sdk-python/README.md`](./sdk-python/README.md).
- **mcp-server/** (`@stakemate/8004swap-mcp-server`) — exposes the protocol as [MCP](https://modelcontextprotocol.io)
  tools (`request_quote`, `fill_quote`, `check_agent_status`, `register_agent`), so any
  MCP-capable agent can trade directly without a human in the loop. See
  [`mcp-server/README.md`](./mcp-server/README.md).

See [`PROTOCOL.md`](./PROTOCOL.md) for the exact Relay message format.

## Running locally

### Contracts (Foundry)

```shell
forge build
forge test
```

### Relay

```shell
cd relay
npm install
cp .env.example .env   # fill in BASE_RPC_URL, REGISTRY_ADDRESS
npm run dev
```

Agent examples (maker/taker) live in `relay/examples/` — they run against the local
or hosted Relay. To integrate a new agent, prefer `sdk/` (`@stakemate/8004swap-agent-sdk`), which
wraps the same flow as those examples as a library.

### Contract deployment

```shell
forge script script/DeploySepolia.s.sol --rpc-url <sepolia_rpc> --private-key <key> --broadcast
```

`script/Deploy.s.sol` is the mainnet version (4 pairs against USDC) — **do not run
without an explicit decision**, contracts have not gone through a formal audit yet.

## Current network (Base Sepolia)

- Registry: `0x7Bb793b6Ada038cf9c26c6BB54cA15Db6BD35ed1`
- Settlement: `0x5Cc2558dF13739c05cb57Caf0E9cfe1629a6a945`
- Active pair: WETH/test-USDC

## Contributing

Open to external contributors — contracts, relay, SDKs in other languages, support
for new chains. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

MIT
