// Transfere a ownership de Registry.sol e/ou Settlement.sol pro novo Safe (2-de-3),
// assinando via Turnkey (Service User "8004swap-automation").
//
// Rodar: node --env-file=../../.env.turnkey-automation --experimental-strip-types transferOwnership.ts <registry|settlement|both> <novoOwnerAddress>
//
// Requer no ambiente: TURNKEY_ORG_ID, TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY,
// OWNER_ADDRESS (wallet Turnkey dona dos contratos hoje), REGISTRY_ADDRESS, SETTLEMENT_ADDRESS,
// BASE_RPC_URL.

import { Turnkey } from "@turnkey/sdk-server";
import { createAccount } from "@turnkey/viem";
import { createWalletClient, createPublicClient, http, defineChain } from "viem";

const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.BASE_RPC_URL ?? "https://sepolia.base.org"] } },
});

const OWNABLE_ABI = [
  { type: "function", name: "transferOwnership", inputs: [{ name: "newOwner", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "owner", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
] as const;

async function main() {
  const [target, newOwnerArg] = process.argv.slice(2);
  const newOwner = newOwnerArg as `0x${string}`;

  if (!["registry", "settlement", "both"].includes(target) || !newOwner) {
    throw new Error("Uso: transferOwnership.ts <registry|settlement|both> <novoOwnerAddress>");
  }

  const turnkeyClient = new Turnkey({
    apiBaseUrl: "https://api.turnkey.com",
    apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.TURNKEY_ORG_ID!,
  }).apiClient();

  const account = await createAccount({
    client: turnkeyClient,
    organizationId: process.env.TURNKEY_ORG_ID!,
    signWith: process.env.OWNER_ADDRESS as `0x${string}`,
  });

  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

  const targets: Array<[string, `0x${string}`]> = [];
  if (target === "registry" || target === "both") targets.push(["Registry", process.env.REGISTRY_ADDRESS as `0x${string}`]);
  if (target === "settlement" || target === "both") targets.push(["Settlement", process.env.SETTLEMENT_ADDRESS as `0x${string}`]);

  for (const [label, address] of targets) {
    const currentOwner = await publicClient.readContract({ address, abi: OWNABLE_ABI, functionName: "owner" });
    console.log(`${label} (${address}) owner atual: ${currentOwner}`);

    const hash = await walletClient.writeContract({
      address,
      abi: OWNABLE_ABI,
      functionName: "transferOwnership",
      args: [newOwner],
    });
    console.log(`${label}: tx enviada ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`${label}: confirmada no bloco ${receipt.blockNumber}, status=${receipt.status}`);

    const confirmedOwner = await publicClient.readContract({ address, abi: OWNABLE_ABI, functionName: "owner" });
    console.log(`${label}: novo owner confirmado on-chain: ${confirmedOwner}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
