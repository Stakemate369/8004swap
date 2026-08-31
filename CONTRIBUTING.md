# Contributing to 8004Swap

Early-stage project (testnet), no budget for a formal audit, dedicated paid infra, or
a core team. The areas below are open to anyone who wants to contribute — via public
credit/recognition, not cash payment, unless an issue says otherwise.

## Where help matters most right now

1. **Run your own Relay (federation).** The Relay is self-hostable
   (`relay/Dockerfile`, `relay/deploy.akash.yaml`) and connects to the same
   Registry/Settlement already on Base Sepolia. Today there's a single, centrally
   operated Relay — that's the protocol's biggest single point of failure. Running an
   independent instance and reporting compatibility issues already helps the network
   become genuinely decentralized.

2. **Volunteer security review.** No budget for Code4rena/Sherlock for now. An
   adversarial read of `contracts/Registry.sol` and `contracts/Settlement.sol` (41
   Foundry tests already cover expected behavior — see `test/`) is very welcome via
   issue or PR. Serious findings go into [`SECURITY.md`](./SECURITY.md) with public
   credit.

3. **SDK in other languages.** There's already a TypeScript SDK (`sdk/`,
   `@stakemate/8004swap-agent-sdk`) following `PROTOCOL.md`. A Python/Rust/Go equivalent opens
   the network to more agents.

4. **Port to another chain.** The architecture (mandatory per-pair Chainlink oracle,
   configurable risk caps) isn't Base-specific — replicating it on another L2 with
   active Chainlink feeds is a good first contract PR.

5. **Listing in ERC-8004/MCP ecosystem directories.** Help drafting/proposing a
   listing in public agent indexes is welcome.

## What you get for contributing

No budget, so the payoff isn't money — it's one of these three, depending on the size
of the contribution:

1. **Public credit.** Name in the GitHub history, cited in README/CONTRIBUTING, and
   in any future `SECURITY.md`/changelog acknowledging serious findings. Counts as
   public portfolio proof in a space (autonomous agents + crypto) that's growing
   right now.

2. **On-chain reputation, verifiable forever.** Since 8004Swap's own differentiator
   is reputation via ERC-8004, serious contributors can be registered as founding
   collaborators in a way that's recorded on-chain — not a "thanks" that fades, but
   permanent public proof, using literally the same technology the project uses for
   everything else.

3. **A seat of trust.** Consistent, serious contribution can turn into merge access
   on the repository or a co-signer position on the contracts' multisig (once it
   exists) — real decision-making power, not just recognition.

**What we don't offer yet:** a share of protocol fees or any token — `feeBps` exists
in the contract but is set to zero today, and there is no token. Promising a slice of
something that doesn't exist is exactly the kind of unbacked promise we avoid here; if
real revenue or a real token ever exists, that gets formalized then, not before.

## How to propose

- Open an issue describing the problem/proposal before a large PR — avoids wasted
  work if the direction doesn't match the rest of the architecture.
- Changes to `contracts/` must come with a Foundry test covering the case (positive
  case and, where applicable, the attack case the change prevents).
- Changes to `relay/` must pass `npm test` and, when they touch the settlement flow,
  an end-to-end test against a local chain (Anvil) — not just an isolated unit test.

## What won't be merged externally without prior alignment

- Mainnet deployment decisions.
- Changing the contracts' `owner()` address (currently under Turnkey, not a multisig
  yet).
- Anything involving the "8004Swap" brand/name.

These stay with the project maintainer — open a discussion issue instead of a direct
PR.
