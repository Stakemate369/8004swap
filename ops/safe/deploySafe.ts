// Deploys a 2-of-3 Safe on Base Sepolia to become the new owner of Registry/Settlement.
// Deployer is the plain Sepolia deployer key (not Turnkey) — deploying a Safe doesn't
// require the current contract owner's signature, any funded address can do it.
//
// Rodar: node --env-file=../../.env.sepolia-deployer --env-file=.env.safe-signers --experimental-strip-types deploySafe.ts
//
// Requer no ambiente: PRIVATE_KEY (deployer), BASE_RPC_URL (opcional, default sepolia.base.org),
// OWNER_ADDRESS (signer 1, o Turnkey "8004Swap-Owner" atual), SIGNER_2, SIGNER_3.

import Safe from "@safe-global/protocol-kit";
import { privateKeyToAccount } from "viem/accounts";

const RPC_URL = process.env.BASE_RPC_URL ?? "https://sepolia.base.org";

async function main() {
  const owner1 = process.env.OWNER_ADDRESS as `0x${string}`;
  const owner2 = process.env.SIGNER_2 as `0x${string}`;
  const owner3 = process.env.SIGNER_3 as `0x${string}`;

  if (!owner1 || !owner2 || !owner3) {
    throw new Error("Faltam OWNER_ADDRESS / SIGNER_2 / SIGNER_3 no ambiente");
  }

  const deployerAccount = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

  console.log("Deployer:", deployerAccount.address);
  console.log("Owners do Safe:", [owner1, owner2, owner3]);
  console.log("Threshold: 2-de-3");

  const protocolKit = await Safe.init({
    provider: RPC_URL,
    signer: process.env.PRIVATE_KEY,
    predictedSafe: {
      safeAccountConfig: {
        owners: [owner1, owner2, owner3],
        threshold: 2,
      },
    },
  });

  const safeAddress = await protocolKit.getAddress();
  console.log("Endereço previsto do Safe:", safeAddress);

  const deploymentTransaction = await protocolKit.createSafeDeploymentTransaction();

  const client = await protocolKit.getSafeProvider().getExternalSigner();
  if (!client) throw new Error("Sem signer externo");

  const hash = await client.sendTransaction({
    account: deployerAccount,
    to: deploymentTransaction.to as `0x${string}`,
    value: BigInt(deploymentTransaction.value),
    data: deploymentTransaction.data as `0x${string}`,
    chain: null,
  });

  console.log("Tx de deploy enviada:", hash);

  const deployedSafe = await Safe.init({
    provider: RPC_URL,
    signer: process.env.PRIVATE_KEY,
    safeAddress,
  });

  const isDeployed = await deployedSafe.isSafeDeployed();
  console.log("Safe deployado:", isDeployed);
  console.log("\nUSE ESTE ENDEREÇO NO transferOwnership:", safeAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
