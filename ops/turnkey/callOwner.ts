// Chama uma funcao onlyOwner do Settlement.sol assinando via Turnkey (Service User
// "8004swap-automation"), sem precisar do Passkey do Root a cada chamada.
//
// Rodar: node --env-file=../../.env.turnkey-automation --experimental-strip-types callOwner.ts <fn> [args]
//
// Requer no ambiente: TURNKEY_ORG_ID, TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY,
// OWNER_ADDRESS (wallet Turnkey dona do contrato), SETTLEMENT_ADDRESS, BASE_RPC_URL.

import { Turnkey } from "@turnkey/sdk-server";
import { createAccount } from "@turnkey/viem";
import { createWalletClient, createPublicClient, http, defineChain } from "viem";

const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.BASE_RPC_URL ?? "https://sepolia.base.org"] } },
});

const SETTLEMENT_ABI = [
  { type: "function", name: "setFeeBps", inputs: [{ name: "bps", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setFeeRecipient", inputs: [{ name: "recipient", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "feeBps", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "feeRecipient", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
] as const;

async function main() {
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

  const settlement = process.env.SETTLEMENT_ADDRESS as `0x${string}`;
  const [fnName, ...args] = process.argv.slice(2);

  if (fnName === "read") {
    const bps = await publicClient.readContract({ address: settlement, abi: SETTLEMENT_ABI, functionName: "feeBps" });
    const recipient = await publicClient.readContract({ address: settlement, abi: SETTLEMENT_ABI, functionName: "feeRecipient" });
    console.log(`feeBps=${bps} feeRecipient=${recipient}`);
    return;
  }

  const parsedArgs = fnName === "setFeeBps" ? [BigInt(args[0])] : [args[0] as `0x${string}`];

  const hash = await walletClient.writeContract({
    address: settlement,
    abi: SETTLEMENT_ABI,
    functionName: fnName as "setFeeBps" | "setFeeRecipient",
    args: parsedArgs as never,
  });
  console.log(`tx enviada: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`confirmada no bloco ${receipt.blockNumber}, status=${receipt.status}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
