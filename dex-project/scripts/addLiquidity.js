/**
 * addLiquidity.js
 * ───────────────
 * Demonstrates adding and removing liquidity for DEX pairs.
 *
 * Run: npx hardhat run scripts/addLiquidity.js --network localhost
 */

const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");
const { ethers } = hre;

async function main() {
  const [signer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments.json")));

  const router = await ethers.getContractAt("DEXRouter",    dep.router,   signer);
  const usdc   = await ethers.getContractAt("GenericERC20", dep.tokens.USDC, signer);
  const link   = await ethers.getContractAt("GenericERC20", dep.tokens.LINK, signer);

  const deadline = Math.floor(Date.now() / 1000) + 3600;

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  LIQUIDITY MANAGEMENT DEMO");
  console.log("══════════════════════════════════════════════════════════════\n");

  // ─── Get current price ratio ───────────────────────────────────────────────
  const price = await router.getPrice(dep.tokens.USDC, dep.tokens.LINK);
  console.log(`── Current price: 1 USDC = ${ethers.formatEther(price)} LINK\n`);

  // ─── Add liquidity: USDC / LINK ────────────────────────────────────────────
  console.log("── Adding 5000 USDC + 5000 LINK liquidity ───────────────────");
  const usdcAmt = ethers.parseUnits("5000", 6);
  const linkAmt = ethers.parseUnits("5000", 18);

  await usdc.approve(dep.router, usdcAmt);
  await link.approve(dep.router, linkAmt);

  const addTx = await router.addLiquidity(
    dep.tokens.USDC,
    dep.tokens.LINK,
    usdcAmt,
    linkAmt,
    0, 0,
    signer.address,
    deadline
  );
  await addTx.wait();

  const pairAddr = dep.pairs["USDC/LINK"];
  const lpToken  = await ethers.getContractAt("DEXPair", pairAddr, signer);
  const lpBal    = await lpToken.balanceOf(signer.address);
  console.log(`  ✓ Liquidity added — tx: ${addTx.hash}`);
  console.log(`  LP tokens received: ${ethers.formatEther(lpBal)}`);

  // ─── Check reserves ────────────────────────────────────────────────────────
  const [r0, r1] = await lpToken.getReserves();
  const t0 = await lpToken.token0();
  const [usdcRes, linkRes] = t0.toLowerCase() === dep.tokens.USDC.toLowerCase()
    ? [r0, r1] : [r1, r0];
  console.log(`  Pool reserves: ${ethers.formatUnits(usdcRes, 6)} USDC / ${ethers.formatEther(linkRes)} LINK`);

  // ─── Remove half the liquidity ─────────────────────────────────────────────
  console.log("\n── Removing 50% of LP tokens ────────────────────────────────");
  const removeAmt = lpBal / 2n;

  await lpToken.approve(dep.router, removeAmt);
  const removeTx = await router.removeLiquidity(
    dep.tokens.USDC,
    dep.tokens.LINK,
    removeAmt,
    0, 0,
    signer.address,
    deadline
  );
  await removeTx.wait();
  console.log(`  ✓ Liquidity removed — tx: ${removeTx.hash}`);

  const usdcBack = await usdc.balanceOf(signer.address);
  const linkBack = await link.balanceOf(signer.address);
  console.log(`  USDC balance: ${ethers.formatUnits(usdcBack, 6)}`);
  console.log(`  LINK balance: ${ethers.formatEther(linkBack)}`);

  console.log("\n✅  Liquidity management demo complete!\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
