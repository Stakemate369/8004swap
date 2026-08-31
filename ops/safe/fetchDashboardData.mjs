import { createPublicClient, http, defineChain, parseAbiItem, formatUnits } from "viem";

const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
});

const client = createPublicClient({ chain: baseSepolia, transport: http() });

const REGISTRY = "0x7Bb793b6Ada038cf9c26c6BB54cA15Db6BD35ed1";
const SETTLEMENT = "0x5Cc2558dF13739c05cb57Caf0E9cfe1629a6a945";
const SAFE = "0xa520Dbae06a187068e0F02333e3B02CDF7d4B7e3";
const ORACLE_ETH_USD = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1";
const ORACLE_USDC_USD = "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165";
const DEPLOY_BLOCK = 45900000n;

const SETTLEMENT_ABI = [
  parseAbiItem("function feeBps() view returns (uint256)"),
  parseAbiItem("function feeRecipient() view returns (address)"),
  parseAbiItem("function owner() view returns (address)"),
  parseAbiItem("function tradingEnabled() view returns (bool)"),
  parseAbiItem("function MAX_FEE_BPS() view returns (uint256)"),
  parseAbiItem(
    "event QuoteFilled(address indexed maker, address indexed taker, address makerToken, address takerToken, uint256 makerAmount, uint256 takerAmount, uint256 nonce)"
  ),
];

const REGISTRY_ABI = [
  parseAbiItem("function owner() view returns (address)"),
  parseAbiItem("event AgentRegistered(address indexed agent, address indexed owner, string metadataURI)"),
];

const ORACLE_ABI = [
  parseAbiItem(
    "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"
  ),
  parseAbiItem("function decimals() view returns (uint8)"),
];

const SAFE_ABI = [
  parseAbiItem("function getOwners() view returns (address[])"),
  parseAbiItem("function getThreshold() view returns (uint256)"),
];

async function getLogsChunked(address, event, fromBlock) {
  const latest = await client.getBlockNumber();
  const CHUNK = 9500n;
  let logs = [];
  for (let start = fromBlock; start <= latest; start += CHUNK) {
    const end = start + CHUNK > latest ? latest : start + CHUNK;
    const chunk = await client.getLogs({ address, event, fromBlock: start, toBlock: end });
    logs = logs.concat(chunk);
  }
  return logs;
}

async function main() {
  const [feeBps, feeRecipient, settlementOwner, tradingEnabled, maxFeeBps] = await Promise.all([
    client.readContract({ address: SETTLEMENT, abi: SETTLEMENT_ABI, functionName: "feeBps" }),
    client.readContract({ address: SETTLEMENT, abi: SETTLEMENT_ABI, functionName: "feeRecipient" }),
    client.readContract({ address: SETTLEMENT, abi: SETTLEMENT_ABI, functionName: "owner" }),
    client.readContract({ address: SETTLEMENT, abi: SETTLEMENT_ABI, functionName: "tradingEnabled" }),
    client.readContract({ address: SETTLEMENT, abi: SETTLEMENT_ABI, functionName: "MAX_FEE_BPS" }),
  ]);

  const registryOwner = await client.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: "owner" });

  const [safeOwners, safeThreshold] = await Promise.all([
    client.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getOwners" }),
    client.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getThreshold" }),
  ]);

  const [ethPrice, ethDecimals] = await Promise.all([
    client.readContract({ address: ORACLE_ETH_USD, abi: ORACLE_ABI, functionName: "latestRoundData" }),
    client.readContract({ address: ORACLE_ETH_USD, abi: ORACLE_ABI, functionName: "decimals" }),
  ]);
  const [usdcPrice, usdcDecimals] = await Promise.all([
    client.readContract({ address: ORACLE_USDC_USD, abi: ORACLE_ABI, functionName: "latestRoundData" }),
    client.readContract({ address: ORACLE_USDC_USD, abi: ORACLE_ABI, functionName: "decimals" }),
  ]);

  const quoteFilledEvent = SETTLEMENT_ABI.find((a) => a.name === "QuoteFilled");
  const agentRegisteredEvent = REGISTRY_ABI.find((a) => a.name === "AgentRegistered");

  const [fills, registrations] = await Promise.all([
    getLogsChunked(SETTLEMENT, quoteFilledEvent, DEPLOY_BLOCK),
    getLogsChunked(REGISTRY, agentRegisteredEvent, DEPLOY_BLOCK),
  ]);

  const fillBlocks = [...new Set(fills.map((f) => f.blockNumber))];
  const blockTimestamps = {};
  for (const bn of fillBlocks) {
    const block = await client.getBlock({ blockNumber: bn });
    blockTimestamps[bn.toString()] = Number(block.timestamp);
  }

  const trades = fills.map((f) => ({
    txHash: f.transactionHash,
    blockNumber: f.blockNumber.toString(),
    timestamp: blockTimestamps[f.blockNumber.toString()],
    maker: f.args.maker,
    taker: f.args.taker,
    makerToken: f.args.makerToken,
    takerToken: f.args.takerToken,
    makerAmount: f.args.makerAmount.toString(),
    takerAmount: f.args.takerAmount.toString(),
    nonce: f.args.nonce.toString(),
  }));

  const agents = registrations.map((r) => ({
    txHash: r.transactionHash,
    blockNumber: r.blockNumber.toString(),
    agent: r.args.agent,
    owner: r.args.owner,
    metadataURI: r.args.metadataURI,
  }));

  const latestBlock = await client.getBlockNumber();

  const output = {
    fetchedAt: new Date().toISOString(),
    latestBlock: latestBlock.toString(),
    contracts: { registry: REGISTRY, settlement: SETTLEMENT, safe: SAFE },
    settlement: {
      feeBps: feeBps.toString(),
      feeRecipient,
      owner: settlementOwner,
      tradingEnabled,
      maxFeeBps: maxFeeBps.toString(),
    },
    registry: { owner: registryOwner },
    safe: { owners: safeOwners, threshold: safeThreshold.toString() },
    oracles: {
      ethUsd: { price: formatUnits(ethPrice[1], ethDecimals), updatedAt: Number(ethPrice[3]) },
      usdcUsd: { price: formatUnits(usdcPrice[1], usdcDecimals), updatedAt: Number(usdcPrice[3]) },
    },
    trades,
    agents,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
