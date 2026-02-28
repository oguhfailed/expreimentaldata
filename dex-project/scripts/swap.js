/**
 * swap.js
 * ───────
 * Demonstrates how to swap tokens on the DEX.
 *
 * Scenarios covered:
 *   A) Direct swap:  USDC → WBTC
 *   B) Multi-hop:    USDC → WBTC → LINK  (through two pools)
 *   C) Exact-out:    want exactly 100 LINK, pay USDC
 *
 * Run: npx hardhat run scripts/swap.js --network localhost
 */

const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");
const { ethers } = hre;

async function main() {
  const [signer] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments.json")));

  const router   = await ethers.getContractAt("DEXRouter",    dep.router,   signer);
  const factory  = await ethers.getContractAt("DEXFactory",   dep.factory,  signer);
  const usdc     = await ethers.getContractAt("GenericERC20", dep.tokens.USDC, signer);
  const wbtc     = await ethers.getContractAt("GenericERC20", dep.tokens.WBTC, signer);
  const link     = await ethers.getContractAt("GenericERC20", dep.tokens.LINK, signer);

  const deadline = Math.floor(Date.now() / 1000) + 3600;

  // ─── Helper ────────────────────────────────────────────────────────────────
  async function printBalance(label, token, addr, decimals) {
    const bal = await token.balanceOf(addr);
    console.log(`  ${label}: ${ethers.formatUnits(bal, decimals)}`);
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  DEX SWAP DEMO");
  console.log("══════════════════════════════════════════════════════════════\n");

  // ─── A) Direct swap: USDC → WBTC ─────────────────────────────────────────
  console.log("── A) Swap 1000 USDC → WBTC ────────────────────────────────");
  const amountIn_A = ethers.parseUnits("1000", 6); // 1000 USDC (6 decimals)

  // Quote first
  const amountsOut_A = await router.getAmountsOut(amountIn_A, [dep.tokens.USDC, dep.tokens.WBTC]);
  console.log(`  Quote: 1000 USDC → ${ethers.formatUnits(amountsOut_A[1], 8)} WBTC`);

  // Approve & swap
  await usdc.approve(dep.router, amountIn_A);
  const tx_A = await router.swapExactTokensForTokens(
    amountIn_A,
    0,                        // amountOutMin: 0 for demo (use slippage in production!)
    [dep.tokens.USDC, dep.tokens.WBTC],
    signer.address,
    deadline
  );
  await tx_A.wait();
  console.log(`  ✓ Swap executed — tx: ${tx_A.hash}`);
  await printBalance("  USDC balance", usdc, signer.address, 6);
  await printBalance("  WBTC balance", wbtc, signer.address, 8);

  // ─── B) Multi-hop swap: USDC → WBTC → LINK ───────────────────────────────
  console.log("\n── B) Multi-hop: 500 USDC → WBTC → LINK ───────────────────");
  const amountIn_B = ethers.parseUnits("500", 6);
  const path_B = [dep.tokens.USDC, dep.tokens.WBTC, dep.tokens.LINK];

  const amountsOut_B = await router.getAmountsOut(amountIn_B, path_B);
  console.log(
    `  Quote: 500 USDC → ${ethers.formatUnits(amountsOut_B[1], 8)} WBTC` +
    ` → ${ethers.formatUnits(amountsOut_B[2], 18)} LINK`
  );

  await usdc.approve(dep.router, amountIn_B);
  const tx_B = await router.swapExactTokensForTokens(
    amountIn_B,
    0,
    path_B,
    signer.address,
    deadline
  );
  await tx_B.wait();
  console.log(`  ✓ Swap executed — tx: ${tx_B.hash}`);
  await printBalance("  LINK balance", link, signer.address, 18);

  // ─── C) Exact-out swap: get exactly 100 LINK, pay USDC ───────────────────
  console.log("\n── C) Exact-out: get 100 LINK, pay USDC ───────────────────");
  const amountOut_C = ethers.parseUnits("100", 18);
  const path_C = [dep.tokens.USDC, dep.tokens.LINK];
  const amountsIn_C = await router.getAmountsIn(amountOut_C, path_C);
  console.log(`  Quote: pay ${ethers.formatUnits(amountsIn_C[0], 6)} USDC to receive 100 LINK`);

  const maxIn_C = amountsIn_C[0] * 110n / 100n; // +10% slippage buffer
  await usdc.approve(dep.router, maxIn_C);
  const tx_C = await router.swapTokensForExactTokens(
    amountOut_C,
    maxIn_C,
    path_C,
    signer.address,
    deadline
  );
  await tx_C.wait();
  console.log(`  ✓ Swap executed — tx: ${tx_C.hash}`);
  await printBalance("  LINK balance", link, signer.address, 18);

  console.log("\n✅  All swap demos completed!\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
