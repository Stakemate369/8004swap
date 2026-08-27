# Security Policy

## Status

8004Swap is pre-audit and currently deployed only on **Base Sepolia (testnet)** —
no real funds are at risk today. `contracts/Deploy.s.sol` (mainnet) exists but has
not been run. Treat any finding against the deployed testnet contracts as a
finding against the codebase, not against live funds.

There is no paid bug bounty program yet. Serious findings are credited publicly
(see [`CONTRIBUTING.md`](./CONTRIBUTING.md)) — that is the reward until a funded
bounty program exists.

## Reporting a vulnerability

Preferred: use GitHub's **[private vulnerability reporting](../../security/advisories/new)**
(Security tab → "Report a vulnerability"). It opens a private draft advisory
visible only to maintainers — no public issue, no email required.

If you cannot use that flow, open a GitHub issue with **no exploit details**,
just "possible security issue, would like a private channel" — a maintainer
will follow up to get details privately.

Please do not:
- Open a public issue or PR describing an unpatched vulnerability
- Test findings against anything beyond the deployed Base Sepolia contracts
  (no other network, no third party's Relay instance, no denial-of-service testing)

## Scope

In scope:
- `contracts/Registry.sol`, `contracts/Settlement.sol` and their deployment scripts
- `relay/` (matching, authentication, EIP-712 verification)
- `sdk/` (`@8004swap/agent-sdk`)

Out of scope:
- Third-party infrastructure the project doesn't control (RPC providers,
  Chainlink oracles themselves, Akash provider nodes)
- Findings that require the contract owner or a Relay operator to be malicious
  (that's a trust-model discussion, not a vulnerability — open an issue instead)

## What happens after a report

1. Acknowledgement as soon as a maintainer sees it (best-effort, no SLA — this is
   an unfunded project).
2. If confirmed, a fix and regression test land in `test/` before any public
   disclosure.
3. Credit in the advisory and in `CONTRIBUTING.md`, unless you ask to stay
   anonymous.
4. Coordinated disclosure timeline is negotiated case by case — there's no fixed
   90-day clock, but we won't sit on a real fix indefinitely either.
