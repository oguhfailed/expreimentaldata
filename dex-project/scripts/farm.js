/**
 * farm.js
 * ───────
 * Demonstrates the full yield farming lifecycle:
 *   1. Stake LP tokens into pool #0 (USDC/WBTC)
 *   2. Fast-forward blocks (hardhat_mine)
 *   3. Check pending rewards
 *   4. Harvest rewards
 *   5. Unstake LP tokens
 *
 * Run: npx hardhat run scripts/farm.js --network localhost
 */

const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");
const { ethers } = hre;

async function main() {
  const [signer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments.json")));

  const router      = await ethers.getContractAt("DEXRouter",    dep.router,       signer);
  const farm        = await ethers.getContractAt("YieldFarm",    dep.farm,         signer);
  const rewardToken = await ethers.getContractAt("GenericERC20", dep.rewardToken,  signer);
  const usdc        = await ethers.getContractAt("GenericERC20", dep.tokens.USDC,  signer);
  const wbtc        = await ethers.getContractAt("GenericERC20", dep.tokens.WBTC,  signer);

  const deadline = Math.floor(Date.now() / 1000) + 3600;

  // Pool 0 = USDC/WBTC
  const POOL_ID = 0;
  const pairAddr = dep.pairs["USDC/WBTC"];
  const lpToken  = await ethers.getContractAt("DEXPair", pairAddr, signer);

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  YIELD FARMING DEMO");
  console.log("══════════════════════════════════════════════════════════════\n");

  // ─── 1. Get LP tokens by adding liquidity ─────────────────────────────────
  console.log("── Step 1: Get LP tokens (add USDC/WBTC liquidity) ──────────");
  const usdcAmt = ethers.parseUnits("2000", 6);
  const wbtcAmt = ethers.parseUnits("2000", 8);
  await usdc.approve(dep.router, usdcAmt);
  await wbtc.approve(dep.router, wbtcAmt);

  await router.addLiquidity(
    dep.tokens.USDC, dep.tokens.WBTC,
    usdcAmt, wbtcAmt,
    0, 0,
    signer.address,
    deadline
  );
  const lpBal = await lpToken.balanceOf(signer.address);
  console.log(`  LP tokens in wallet: ${ethers.formatEther(lpBal)}`);

  // ─── 2. Stake LP tokens ───────────────────────────────────────────────────
  console.log("\n── Step 2: Stake LP tokens into pool #0 ────────────────────");
  await lpToken.approve(dep.farm, lpBal);
  const stakeTx = await farm.deposit(POOL_ID, lpBal);
  await stakeTx.wait();
  console.log(`  ✓ Staked ${ethers.formatEther(lpBal)} LP tokens`);

  // ─── 3. Mine 100 blocks to accumulate rewards ─────────────────────────────
  console.log("\n── Step 3: Mining 100 blocks to accumulate rewards ──────────");
  await hre.network.provider.send("hardhat_mine", ["0x64"]); // 0x64 = 100
  console.log("  ✓ 100 blocks mined");

  // ─── 4. Check pending rewards ─────────────────────────────────────────────
  console.log("\n── Step 4: Check pending rewards ────────────────────────────");
  const pending = await farm.pendingReward(POOL_ID, signer.address);
  console.log(`  Pending DRWD rewards: ${ethers.formatEther(pending)}`);

  const [poolLp, poolAlloc, , , totalStaked, poolName] = await farm.getPoolInfo(POOL_ID);
  console.log(`  Pool name      : ${poolName}`);
  console.log(`  Total staked   : ${ethers.formatEther(totalStaked)} LP`);
  console.log(`  Alloc points   : ${poolAlloc}`);

  // ─── 5. Harvest rewards ───────────────────────────────────────────────────
  console.log("\n── Step 5: Harvest rewards ──────────────────────────────────");
  const harvestTx = await farm.harvest(POOL_ID);
  await harvestTx.wait();
  const drwdBal = await rewardToken.balanceOf(signer.address);
  console.log(`  ✓ Harvested — DRWD balance: ${ethers.formatEther(drwdBal)}`);

  // ─── 6. Mine more blocks, then withdraw ───────────────────────────────────
  console.log("\n── Step 6: Mine 50 more blocks, then withdraw all ───────────");
  await hre.network.provider.send("hardhat_mine", ["0x32"]); // 0x32 = 50

  const pendingBeforeWithdraw = await farm.pendingReward(POOL_ID, signer.address);
  console.log(`  Pending before withdraw: ${ethers.formatEther(pendingBeforeWithdraw)} DRWD`);

  // Withdraw auto-harvests
  const withdrawTx = await farm.withdraw(POOL_ID, lpBal);
  await withdrawTx.wait();
  console.log(`  ✓ Withdrawn ${ethers.formatEther(lpBal)} LP tokens`);

  const finalDrwd = await rewardToken.balanceOf(signer.address);
  const finalLp   = await lpToken.balanceOf(signer.address);
  console.log(`  Final DRWD balance : ${ethers.formatEther(finalDrwd)}`);
  console.log(`  Final LP balance   : ${ethers.formatEther(finalLp)}`);

  // ─── 7. Show all available pools ─────────────────────────────────────────
  console.log("\n── Step 7: All farm pools ───────────────────────────────────");
  const poolCount = await farm.poolLength();
  console.log(`  Total pools: ${poolCount}`);
  for (let i = 0; i < Math.min(Number(poolCount), 5); i++) {
    const [lp, alloc, , , staked, name] = await farm.getPoolInfo(i);
    console.log(`  [${i}] ${name} — allocPts: ${alloc}, staked: ${ethers.formatEther(staked)} LP`);
  }
  if (poolCount > 5n) console.log(`  ... and ${poolCount - 5n} more pools`);

  console.log("\n✅  Yield farming demo complete!\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
