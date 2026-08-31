import { randomBytes } from "node:crypto";
import { toHex, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

// x402 protocol v2 (https://github.com/coinbase/x402, specs/x402-specification-v2.md +
// specs/transports-v2/http.md + specs/schemes/exact/scheme_exact_evm.md). Implements
// the CLIENT/payer side only, "exact" scheme, "eip3009" asset transfer method
// (transferWithAuthorization) — the recommended path for EIP-3009 tokens like USDC.
// Facilitator-side verification/settlement is out of scope here: this is what an agent
// signs to pay for someone else's x402-gated resource, not a resource server itself.

interface PaymentRequirements {
  scheme: string;
  network: string; // CAIP-2, e.g. "eip155:84532"
  amount: string; // atomic units
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra?: { name?: string; version?: string; assetTransferMethod?: string };
}

interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirements[];
}

interface SettlementResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
  amount?: string;
}

export class X402Error extends Error {}

function decodeHeaderJson<T>(value: string | null, headerName: string): T {
  if (!value) throw new X402Error(`missing ${headerName} header`);
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
  } catch {
    throw new X402Error(`malformed ${headerName} header (not base64 JSON)`);
  }
}

function encodeHeaderJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function pickRequirement(accepts: PaymentRequirements[], maxAmountAtomic: bigint): PaymentRequirements {
  const exact = accepts.filter((a) => a.scheme === "exact");
  if (exact.length === 0) throw new X402Error(`no "exact" scheme in accepts (got: ${accepts.map((a) => a.scheme).join(", ")})`);

  const supported = exact.filter((a) => {
    const method = a.extra?.assetTransferMethod ?? "eip3009";
    return method === "eip3009";
  });
  if (supported.length === 0) {
    throw new X402Error(
      `no accepted payment method is supported (this client only implements eip3009); server wants: ` +
        exact.map((a) => a.extra?.assetTransferMethod ?? "eip3009").join(", ")
    );
  }

  const affordable = supported.filter((a) => BigInt(a.amount) <= maxAmountAtomic);
  if (affordable.length === 0) {
    throw new X402Error(
      `all offered amounts exceed maxAmountAtomic (${maxAmountAtomic}): ` + supported.map((a) => a.amount).join(", ")
    );
  }

  // cheapest affordable option
  return affordable.reduce((best, cur) => (BigInt(cur.amount) < BigInt(best.amount) ? cur : best));
}

async function signPayment(account: PrivateKeyAccount, requirement: PaymentRequirements) {
  const [, chainIdStr] = requirement.network.split(":");
  const chainId = Number(chainIdStr);
  if (!chainId) throw new X402Error(`unsupported network format (expected CAIP-2 "eip155:<chainId>"): ${requirement.network}`);
  if (!requirement.extra?.name || !requirement.extra?.version) {
    throw new X402Error(`payment requirement is missing extra.name/extra.version, needed for the EIP-712 domain`);
  }

  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + requirement.maxTimeoutSeconds);
  const nonce = toHex(randomBytes(32));

  const domain = {
    name: requirement.extra.name,
    version: requirement.extra.version,
    chainId,
    verifyingContract: requirement.asset,
  } as const;

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  } as const;

  const message = {
    from: account.address,
    to: requirement.payTo,
    value: BigInt(requirement.amount),
    validAfter,
    validBefore,
    nonce,
  } as const;

  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message,
  });

  return {
    signature,
    authorization: {
      from: account.address,
      to: requirement.payTo,
      value: requirement.amount,
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    },
  };
}

export interface PayX402Params {
  url: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  /** Refuses to pay more than this many atomic units of the asset, across all offered amounts. Required — there is no default cap. */
  maxAmountAtomic: bigint;
}

export interface PayX402Result {
  status: number;
  body: string;
  paid: boolean;
  accepted?: PaymentRequirements;
  settlement?: SettlementResponse;
}

/**
 * Pays for an x402-gated HTTP resource (protocol v2, "exact" scheme, EIP-3009 asset
 * transfer) and returns the final response. If the resource doesn't require payment
 * (no 402), returns the first response unchanged.
 */
export async function payX402Resource(account: PrivateKeyAccount, params: PayX402Params): Promise<PayX402Result> {
  const { url, method = "GET", body, headers = {} } = params;

  const first = await fetch(url, { method, body, headers });
  if (first.status !== 402) {
    return { status: first.status, body: await first.text(), paid: false };
  }

  const paymentRequired = decodeHeaderJson<PaymentRequired>(first.headers.get("PAYMENT-REQUIRED"), "PAYMENT-REQUIRED");
  if (paymentRequired.x402Version !== 2) {
    throw new X402Error(`unsupported x402Version: ${paymentRequired.x402Version} (this client implements v2 only)`);
  }

  const accepted = pickRequirement(paymentRequired.accepts, params.maxAmountAtomic);
  const { signature, authorization } = await signPayment(account, accepted);

  const paymentPayload = {
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted,
    payload: { signature, authorization },
  };

  const second = await fetch(url, {
    method,
    body,
    headers: { ...headers, "PAYMENT-SIGNATURE": encodeHeaderJson(paymentPayload) },
  });

  const settlementHeader = second.headers.get("PAYMENT-RESPONSE");
  const settlement = settlementHeader ? decodeHeaderJson<SettlementResponse>(settlementHeader, "PAYMENT-RESPONSE") : undefined;

  return {
    status: second.status,
    body: await second.text(),
    paid: settlement?.success ?? second.status < 400,
    accepted,
    settlement,
  };
}
