/**
 * deploy.js
 * ─────────
 * Deploys the full DEX ecosystem:
 *   1. 30 ERC-20 tokens (each with 1,000,000 initial supply)
 *   2. DEXFactory
 *   3. DEXRouter
 *   4. YieldFarm + RewardToken
 *   5. Creates trading pairs for all tokens against a "base" token (TOKEN0)
 *   6. Adds initial liquidity to each pair
 *   7. Registers every LP token with YieldFarm
 *   8. Saves all addresses to deployments.json
 */

const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");
const { ethers } = hre;

// ─── Token definitions (30 tokens) ───────────────────────────────────────────
const TOKENS = [
  { name: "USD Coin",            symbol: "USDC",  decimals: 6  },
  { name: "Wrapped Bitcoin",     symbol: "WBTC",  decimals: 8  },
  { name: "Wrapped Ether",       symbol: "WETH",  decimals: 18 },
  { name: "Chainlink",           symbol: "LINK",  decimals: 18 },
  { name: "Uniswap",             symbol: "UNI",   decimals: 18 },
  { name: "Aave",                symbol: "AAVE",  decimals: 18 },
  { name: "Compound",            symbol: "COMP",  decimals: 18 },
  { name: "Maker",               symbol: "MKR",   decimals: 18 },
  { name: "Synthetix",           symbol: "SNX",   decimals: 18 },
  { name: "Curve DAO",           symbol: "CRV",   decimals: 18 },
  { name: "Yearn Finance",       symbol: "YFI",   decimals: 18 },
  { name: "SushiSwap",           symbol: "SUSHI", decimals: 18 },
  { name: "Balancer",            symbol: "BAL",   decimals: 18 },
  { name: "1inch",               symbol: "1INCH", decimals: 18 },
  { name: "dYdX",                symbol: "DYDX",  decimals: 18 },
  { name: "GMX",                 symbol: "GMX",   decimals: 18 },
  { name: "Convex Finance",      symbol: "CVX",   decimals: 18 },
  { name: "Lido DAO",            symbol: "LDO",   decimals: 18 },
  { name: "Rocket Pool",         symbol: "RPL",   decimals: 18 },
  { name: "Frax Share",          symbol: "FXS",   decimals: 18 },
  { name: "PancakeSwap",         symbol: "CAKE",  decimals: 18 },
  { name: "Radiant Capital",     symbol: "RDNT",  decimals: 18 },
  { name: "Pendle",              symbol: "PENDLE",decimals: 18 },
  { name: "Velodrome Finance",   symbol: "VELO",  decimals: 18 },
  { name: "Aerodrome Finance",   symbol: "AERO",  decimals: 18 },
  { name: "Stargate Finance",    symbol: "STG",   decimals: 18 },
  { name: "Arbitrum",            symbol: "ARB",   decimals: 18 },
  { name: "Optimism",            symbol: "OP",    decimals: 18 },
  { name: "Blur",                symbol: "BLUR",  decimals: 18 },
  { name: "Ondo Finance",        symbol: "ONDO",  decimals: 18 },
];

// Reward per block: 1 DRWD (in wei)
const REWARD_PER_BLOCK = ethers.parseEther("1");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("\n🚀  Deploying DEX ecosystem");
  console.log("    Deployer:", deployer.address);
  console.log("    Balance: ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  const deployments = { tokens: {}, pairs: {}, farmPools: {} };

  // ─── 1. Deploy 30 ERC-20 tokens ────────────────────────────────────────────
  console.log("── Step 1: Deploying 30 ERC-20 tokens ──────────────────────────");
  const GenericERC20 = await ethers.getContractFactory("GenericERC20");
  const tokenContracts = [];

  for (const t of TOKENS) {
    const token = await GenericERC20.deploy(
      t.name,
      t.symbol,
      t.decimals,
      1_000_000,          // initial supply (in whole units)
      deployer.address
    );
    await token.waitForDeployment();
    const addr = await token.getAddress();
    tokenContracts.push({ ...t, address: addr, contract: token });
    deployments.tokens[t.symbol] = addr;
    console.log(`  ✓ ${t.symbol.padEnd(7)} → ${addr}`);
  }

  // ─── 2. Deploy DEXFactory ───────────────────────────────────────────────────
  console.log("\n── Step 2: DEXFactory ──────────────────────────────────────────");
  const DEXFactory = await ethers.getContractFactory("DEXFactory");
  const factory = await DEXFactory.deploy(deployer.address);
  await factory.waitForDeployment();
  deployments.factory = await factory.getAddress();
  console.log("  ✓ DEXFactory →", deployments.factory);

  // ─── 3. Deploy DEXRouter ────────────────────────────────────────────────────
  console.log("\n── Step 3: DEXRouter ───────────────────────────────────────────");
  const DEXRouter = await ethers.getContractFactory("DEXRouter");
  const router = await DEXRouter.deploy(deployments.factory);
  await router.waitForDeployment();
  deployments.router = await router.getAddress();
  console.log("  ✓ DEXRouter →", deployments.router);

  // ─── 4. Deploy YieldFarm ────────────────────────────────────────────────────
  console.log("\n── Step 4: YieldFarm ───────────────────────────────────────────");
  const YieldFarm = await ethers.getContractFactory("YieldFarm");
  const farm = await YieldFarm.deploy(REWARD_PER_BLOCK, deployer.address);
  await farm.waitForDeployment();
  deployments.farm = await farm.getAddress();
  deployments.rewardToken = await farm.rewardToken();
  console.log("  ✓ YieldFarm    →", deployments.farm);
  console.log("  ✓ RewardToken  →", deployments.rewardToken);

  // ─── 5. Create pairs & add liquidity ────────────────────────────────────────
  // Use USDC (tokenContracts[0]) as base quote token for all pairs
  const base = tokenContracts[0]; // USDC
  console.log(`\n── Step 5: Creating pairs (base = ${base.symbol}) ──────────────────`);

  const deadline = Math.floor(Date.now() / 1000) + 3600;

  for (let i = 1; i < tokenContracts.length; i++) {
    const quote = tokenContracts[i];
    const pairLabel = `${base.symbol}/${quote.symbol}`;

    // Approve router
    const baseAmt  = ethers.parseUnits("10000", base.decimals);
    const quoteAmt = ethers.parseUnits("10000", quote.decimals);

    await base.contract.approve(deployments.router, baseAmt);
    await quote.contract.approve(deployments.router, quoteAmt);

    // Add liquidity (creates pair automatically on first call)
    await router.addLiquidity(
      base.address,
      quote.address,
      baseAmt,
      quoteAmt,
      0, 0,           // min amounts = 0 for initial seeding
      deployer.address,
      deadline
    );

    const pairAddr = await factory.getPair(base.address, quote.address);
    deployments.pairs[pairLabel] = pairAddr;
    console.log(`  ✓ ${pairLabel.padEnd(14)} pair → ${pairAddr}`);

    // ─── 6. Register pair with YieldFarm ─────────────────────────────────────
    await farm.addPool(100, pairAddr, `${pairLabel} LP`);
    const pid = i - 1;
    deployments.farmPools[pairLabel] = { pid, lpToken: pairAddr };
  }

  console.log(`\n  Total pairs created : ${Object.keys(deployments.pairs).length}`);
  console.log(`  Total farm pools    : ${Object.keys(deployments.farmPools).length}`);

  // ─── 7. Save deployments ────────────────────────────────────────────────────
  const outPath = path.join(__dirname, "..", "deployments.json");
  fs.writeFileSync(outPath, JSON.stringify(deployments, null, 2));
  console.log("\n── Deployments saved to deployments.json ───────────────────────");
  console.log("   Path:", outPath);

  console.log("\n✅  Deployment complete!\n");
  console.log("   To interact:");
  console.log("   npx hardhat run scripts/swap.js --network localhost");
  console.log("   npx hardhat run scripts/farm.js --network localhost");
  console.log("   npx hardhat run scripts/addLiquidity.js --network localhost\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
