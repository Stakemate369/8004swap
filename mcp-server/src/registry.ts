// Minimal ABI slice of contracts/Registry.sol — just the two functions this server needs.
export const REGISTRY_ABI = [
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "registerAgent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "ownerAddress", type: "address" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
] as const;
