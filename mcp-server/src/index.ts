#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AgentClient,
  fillQuote,
  fillQuoteWithPermit,
  quoteFromWire,
  quoteToWire,
  waitForFill,
  type WireQuote,
} from "@stakemate/8004swap-agent-sdk";
import { config, requireAgentPrivateKey } from "./config.js";
import { REGISTRY_ABI } from "./registry.js";
import { payX402Resource } from "./x402.js";

const chain = {
  id: config.chainId,
  name: `chain-${config.chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
} as const;

const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

const server = new McpServer({
  name: "8004swap",
  version: "0.1.0",
});

server.tool(
  "check_agent_status",
  "Check whether an address is registered and active on the 8004Swap Registry (i.e. allowed to trade). Read-only, no signing.",
  { address: z.string().describe("EVM address to check") },
  async ({ address }) => {
    const active = await publicClient.readContract({
      address: config.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "isActive",
      args: [address as Address],
    });
    return {
      content: [
        { type: "text", text: JSON.stringify({ address, active, registry: config.registryAddress }) },
      ],
    };
  }
);

server.tool(
  "register_agent",
  "Self-register the configured agent (AGENT_PRIVATE_KEY) on the 8004Swap Registry so it's allowed to trade. " +
    "One-time action per address; fails if already registered. Broadcasts a real (testnet) transaction.",
  {
    ownerAddress: z
      .string()
      .optional()
      .describe("Address allowed to pause/manage this agent later; defaults to the agent's own address"),
    metadataURI: z.string().optional().describe("Optional metadata URI for this agent, defaults to empty string"),
  },
  async ({ ownerAddress, metadataURI }) => {
    const account = privateKeyToAccount(requireAgentPrivateKey());
    const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
    const hash = await walletClient.writeContract({
      address: config.registryAddress,
      abi: REGISTRY_ABI,
      functionName: "registerAgent",
      args: [(ownerAddress as Address) ?? account.address, metadataURI ?? ""],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ agent: account.address, txHash: hash, status: receipt.status }),
        },
      ],
    };
  }
);

server.tool(
  "request_quote",
  "Act as taker: broadcast an RFQ over the 8004Swap Relay and collect signed quotes from maker agents subscribed " +
    "to this pair. Requires AGENT_PRIVATE_KEY (used to authenticate to the Relay, no gas spent). Resolves after " +
    "the Relay's collection window closes (a few seconds) with quotes ranked best-first.",
  {
    makerToken: z.string().describe("ERC-20 address the taker wants to receive"),
    takerToken: z.string().describe("ERC-20 address the taker is paying with"),
    takerAmount: z.string().describe("Amount of takerToken offered, in the token's smallest unit (wei-equivalent), as a decimal string"),
    minMakerAmount: z.string().optional().describe("Reject quotes offering less than this (smallest unit), default 0"),
    expiresInMs: z.number().optional().describe("Requested RFQ window; Relay caps it at 30000ms regardless"),
  },
  async ({ makerToken, takerToken, takerAmount, minMakerAmount, expiresInMs }) => {
    const account = privateKeyToAccount(requireAgentPrivateKey());
    const client = new AgentClient({
      relayUrl: config.relayUrl,
      account,
      chainId: config.chainId,
      settlementAddress: config.settlementAddress,
    });
    try {
      await client.connect();
      const quotes = await client.requestQuote({
        makerToken: makerToken as Address,
        takerToken: takerToken as Address,
        takerAmount: BigInt(takerAmount),
        minMakerAmount: minMakerAmount ? BigInt(minMakerAmount) : undefined,
        expiresInMs,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ quotes: quotes.map(quoteToWire) }) }],
      };
    } finally {
      client.close();
    }
  }
);

server.tool(
  "fill_quote",
  "Act as taker: settle a signed quote on-chain by calling Settlement.fillQuote (or fillQuoteWithPermit if a " +
    "permit is supplied). Requires AGENT_PRIVATE_KEY, and the taker must already hold + have approved takerToken " +
    "unless using a permit. Broadcasts a real transaction. Get `quote` from a prior request_quote call.",
  {
    quote: z
      .object({
        maker: z.string(),
        taker: z.string(),
        makerToken: z.string(),
        takerToken: z.string(),
        makerAmount: z.string(),
        takerAmount: z.string(),
        expiry: z.string(),
        nonce: z.string(),
        signature: z.string(),
      })
      .describe("A WireQuote as returned by request_quote (one entry from its `quotes` array)"),
    permit: z
      .object({
        value: z.string(),
        deadline: z.string(),
        v: z.number(),
        r: z.string(),
        s: z.string(),
      })
      .optional()
      .describe("Optional EIP-2612 permit on takerToken, to skip a separate approve() tx"),
  },
  async ({ quote, permit }) => {
    const account = privateKeyToAccount(requireAgentPrivateKey());
    const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
    const wire = quote as WireQuote;
    const parsed = quoteFromWire(wire);
    const { signature } = parsed;

    const hash = permit
      ? await fillQuoteWithPermit(walletClient, config.settlementAddress, parsed, signature, {
          value: BigInt(permit.value),
          deadline: BigInt(permit.deadline),
          v: permit.v,
          r: permit.r as Hex,
          s: permit.s as Hex,
        })
      : await fillQuote(walletClient, config.settlementAddress, parsed, signature);

    const receipt = await waitForFill(publicClient, hash);
    return {
      content: [{ type: "text", text: JSON.stringify({ txHash: hash, status: receipt.status }) }],
    };
  }
);

server.tool(
  "pay_x402",
  "Fetches an HTTP resource; if it replies with the x402 payment-required protocol (protocol v2, " +
    "github.com/coinbase/x402), signs an EIP-3009 authorization from the configured agent to satisfy it and " +
    "retries, returning the final response. Only the 'exact' scheme with 'eip3009' transfer method is supported " +
    "(rejects Permit2/ERC-7710 offers). Requires AGENT_PRIVATE_KEY. maxAmountAtomic bounds what this call may " +
    "authorize; there is no other limit, so callers should always pass the smallest value that covers the " +
    "expected price.",
  {
    url: z.string().describe("URL of the x402-gated resource"),
    method: z.string().optional().describe("HTTP method, default GET"),
    body: z.string().optional().describe("Raw request body, if any"),
    headers: z.record(z.string(), z.string()).optional().describe("Extra request headers"),
    maxAmountAtomic: z
      .string()
      .describe("Upper bound, in atomic units of the asset (e.g. USDC has 6 decimals), on what this call may authorize"),
  },
  async ({ url, method, body, headers, maxAmountAtomic }) => {
    const account = privateKeyToAccount(requireAgentPrivateKey());
    const result = await payX402Resource(account, {
      url,
      method,
      body,
      headers,
      maxAmountAtomic: BigInt(maxAmountAtomic),
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
