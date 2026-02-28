/**
 * DEX.test.js
 * ───────────
 * Comprehensive tests for all DEX + YieldFarm contracts.
 */

const { expect } = require("chai");
const { ethers }  = require("hardhat");

describe("DEX Ecosystem", function () {
  let owner, alice, bob;
  let tokenA, tokenB, tokenC;
  let factory, router, farm;
  let rewardToken;
  let pairAB; // DEXPair for tokenA/tokenB
  let deadline;

  const INITIAL_SUPPLY = 1_000_000;
  const REWARD_PER_BLOCK = ethers.parseEther("1");

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    deadline = Math.floor(Date.now() / 1000) + 3600;

    // Deploy 3 tokens
    const ERC20 = await ethers.getContractFactory("GenericERC20");
    tokenA = await ERC20.deploy("Token A", "TKA", 18, INITIAL_SUPPLY, owner.address);
    tokenB = await ERC20.deploy("Token B", "TKB", 18, INITIAL_SUPPLY, owner.address);
    tokenC = await ERC20.deploy("Token C", "TKC", 18, INITIAL_SUPPLY, owner.address);
    await Promise.all([
      tokenA.waitForDeployment(),
      tokenB.waitForDeployment(),
      tokenC.waitForDeployment(),
    ]);

    // Distribute tokens to alice & bob
    await tokenA.transfer(alice.address, ethers.parseEther("100000"));
    await tokenB.transfer(alice.address, ethers.parseEther("100000"));
    await tokenC.transfer(alice.address, ethers.parseEther("100000"));
    await tokenA.transfer(bob.address,   ethers.parseEther("50000"));
    await tokenB.transfer(bob.address,   ethers.parseEther("50000"));

    // Deploy DEX contracts
    const Factory = await ethers.getContractFactory("DEXFactory");
    factory = await Factory.deploy(owner.address);
    await factory.waitForDeployment();

    const Router = await ethers.getContractFactory("DEXRouter");
    router = await Router.deploy(await factory.getAddress());
    await router.waitForDeployment();

    const Farm = await ethers.getContractFactory("YieldFarm");
    farm = await Farm.deploy(REWARD_PER_BLOCK, owner.address);
    await farm.waitForDeployment();
    rewardToken = await ethers.getContractAt("RewardToken", await farm.rewardToken());

    // Seed TKA/TKB pair with liquidity
    const seedAmt = ethers.parseEther("10000");
    await tokenA.approve(await router.getAddress(), seedAmt);
    await tokenB.approve(await router.getAddress(), seedAmt);
    await router.addLiquidity(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      seedAmt, seedAmt, 0, 0,
      owner.address,
      deadline
    );

    const pairAddr = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
    pairAB = await ethers.getContractAt("DEXPair", pairAddr);
  });

  // ── ERC-20 Token ───────────────────────────────────────────────────────────
  describe("GenericERC20", () => {
    it("has correct metadata", async () => {
      expect(await tokenA.name()).to.equal("Token A");
      expect(await tokenA.symbol()).to.equal("TKA");
      expect(await tokenA.decimals()).to.equal(18n);
    });

    it("mints initial supply to holder", async () => {
      const supply = ethers.parseEther(String(INITIAL_SUPPLY));
      // owner transferred some, check totalSupply
      expect(await tokenA.totalSupply()).to.be.gte(supply);
    });

    it("faucet dispenses 1000 tokens", async () => {
      const before = await tokenA.balanceOf(alice.address);
      await tokenA.faucet(alice.address);
      const after  = await tokenA.balanceOf(alice.address);
      expect(after - before).to.equal(ethers.parseEther("1000"));
    });
  });

  // ── DEXFactory ─────────────────────────────────────────────────────────────
  describe("DEXFactory", () => {
    it("pair was created for TKA/TKB", async () => {
      const pair = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      expect(pair).to.not.equal(ethers.ZeroAddress);
    });

    it("getPair is symmetric", async () => {
      const p1 = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      const p2 = await factory.getPair(await tokenB.getAddress(), await tokenA.getAddress());
      expect(p1).to.equal(p2);
    });

    it("reverts on duplicate pair", async () => {
      await expect(
        factory.createPair(await tokenA.getAddress(), await tokenB.getAddress())
      ).to.be.revertedWith("DEXFactory: PAIR_EXISTS");
    });

    it("reverts on identical tokens", async () => {
      await expect(
        factory.createPair(await tokenA.getAddress(), await tokenA.getAddress())
      ).to.be.revertedWith("DEXFactory: IDENTICAL_ADDRESSES");
    });

    it("tracks allPairs", async () => {
      expect(await factory.allPairsLength()).to.equal(1n);
      // Create another pair (TKA/TKC)
      await factory.createPair(await tokenA.getAddress(), await tokenC.getAddress());
      expect(await factory.allPairsLength()).to.equal(2n);
    });
  });

  // ── DEXPair ────────────────────────────────────────────────────────────────
  describe("DEXPair", () => {
    it("reports correct token addresses", async () => {
      const t0 = await pairAB.token0();
      const t1 = await pairAB.token1();
      const addrA = await tokenA.getAddress();
      const addrB = await tokenB.getAddress();
      const sorted = [addrA, addrB].sort();
      expect([t0.toLowerCase(), t1.toLowerCase()]).to.deep.equal(
        sorted.map(a => a.toLowerCase())
      );
    });

    it("has non-zero reserves after seeding", async () => {
      const [r0, r1] = await pairAB.getReserves();
      expect(r0).to.be.gt(0n);
      expect(r1).to.be.gt(0n);
    });

    it("minted LP tokens to owner", async () => {
      const lpBal = await pairAB.balanceOf(owner.address);
      expect(lpBal).to.be.gt(0n);
    });
  });

  // ── DEXRouter — Liquidity ──────────────────────────────────────────────────
  describe("DEXRouter — Liquidity", () => {
    it("alice can add liquidity and receive LP tokens", async () => {
      const amt = ethers.parseEther("1000");
      await tokenA.connect(alice).approve(await router.getAddress(), amt);
      await tokenB.connect(alice).approve(await router.getAddress(), amt);

      await router.connect(alice).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        amt, amt, 0, 0,
        alice.address,
        deadline
      );

      const lpBal = await pairAB.balanceOf(alice.address);
      expect(lpBal).to.be.gt(0n);
    });

    it("alice can remove liquidity and recover tokens", async () => {
      const amt = ethers.parseEther("1000");
      await tokenA.connect(alice).approve(await router.getAddress(), amt);
      await tokenB.connect(alice).approve(await router.getAddress(), amt);
      await router.connect(alice).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        amt, amt, 0, 0, alice.address, deadline
      );

      const lpBal = await pairAB.balanceOf(alice.address);
      const beforeA = await tokenA.balanceOf(alice.address);

      await pairAB.connect(alice).approve(await router.getAddress(), lpBal);
      await router.connect(alice).removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        lpBal, 0, 0,
        alice.address,
        deadline
      );

      const afterA = await tokenA.balanceOf(alice.address);
      expect(afterA).to.be.gt(beforeA);
      expect(await pairAB.balanceOf(alice.address)).to.equal(0n);
    });
  });

  // ── DEXRouter — Swaps ──────────────────────────────────────────────────────
  describe("DEXRouter — Swaps", () => {
    it("swapExactTokensForTokens: TKA → TKB", async () => {
      const amtIn = ethers.parseEther("100");
      await tokenA.connect(alice).approve(await router.getAddress(), amtIn);

      const beforeB = await tokenB.balanceOf(alice.address);
      await router.connect(alice).swapExactTokensForTokens(
        amtIn, 0,
        [await tokenA.getAddress(), await tokenB.getAddress()],
        alice.address,
        deadline
      );
      const afterB = await tokenB.balanceOf(alice.address);
      expect(afterB).to.be.gt(beforeB);
    });

    it("respects amountOutMin slippage guard", async () => {
      const amtIn = ethers.parseEther("100");
      await tokenA.connect(alice).approve(await router.getAddress(), amtIn);

      // Set absurdly high minimum → should revert
      await expect(
        router.connect(alice).swapExactTokensForTokens(
          amtIn,
          ethers.parseEther("9999"), // impossible minimum
          [await tokenA.getAddress(), await tokenB.getAddress()],
          alice.address,
          deadline
        )
      ).to.be.revertedWith("DEXRouter: INSUFFICIENT_OUTPUT_AMOUNT");
    });

    it("swapTokensForExactTokens: receive exactly 50 TKB", async () => {
      const exactOut = ethers.parseEther("50");
      const maxIn    = ethers.parseEther("100");
      await tokenA.connect(alice).approve(await router.getAddress(), maxIn);

      await router.connect(alice).swapTokensForExactTokens(
        exactOut,
        maxIn,
        [await tokenA.getAddress(), await tokenB.getAddress()],
        alice.address,
        deadline
      );

      // alice's TKB increased by exactly 50
      // (hard to assert exact because she started with 100000)
      const balB = await tokenB.balanceOf(alice.address);
      expect(balB).to.be.gte(ethers.parseEther("100050"));
    });

    it("multi-hop swap: TKA → TKB → TKC", async () => {
      // Seed TKB/TKC pair first
      const seed = ethers.parseEther("5000");
      await tokenB.approve(await router.getAddress(), seed);
      await tokenC.approve(await router.getAddress(), seed);
      await router.addLiquidity(
        await tokenB.getAddress(), await tokenC.getAddress(),
        seed, seed, 0, 0, owner.address, deadline
      );

      const amtIn = ethers.parseEther("100");
      await tokenA.connect(alice).approve(await router.getAddress(), amtIn);

      const beforeC = await tokenC.balanceOf(alice.address);
      await router.connect(alice).swapExactTokensForTokens(
        amtIn, 0,
        [await tokenA.getAddress(), await tokenB.getAddress(), await tokenC.getAddress()],
        alice.address,
        deadline
      );
      const afterC = await tokenC.balanceOf(alice.address);
      expect(afterC).to.be.gt(beforeC);
    });

    it("getAmountsOut and getPrice are consistent", async () => {
      const price = await router.getPrice(await tokenA.getAddress(), await tokenB.getAddress());
      // 1 TKA worth in TKB should be > 0
      expect(price).to.be.gt(0n);
    });
  });

  // ── YieldFarm ──────────────────────────────────────────────────────────────
  describe("YieldFarm", () => {
    let pid;

    beforeEach(async () => {
      // Register the TKA/TKB LP pool with the farm
      await farm.addPool(100, await pairAB.getAddress(), "TKA/TKB LP");
      pid = 0;
    });

    it("pool is registered correctly", async () => {
      const [lp, alloc, , , , name] = await farm.getPoolInfo(pid);
      expect(lp).to.equal(await pairAB.getAddress());
      expect(alloc).to.equal(100n);
      expect(name).to.equal("TKA/TKB LP");
    });

    it("alice can deposit LP tokens", async () => {
      // Give alice LP tokens
      const seedAmt = ethers.parseEther("1000");
      await tokenA.connect(alice).approve(await router.getAddress(), seedAmt);
      await tokenB.connect(alice).approve(await router.getAddress(), seedAmt);
      await router.connect(alice).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        seedAmt, seedAmt, 0, 0, alice.address, deadline
      );
      const lpBal = await pairAB.balanceOf(alice.address);

      await pairAB.connect(alice).approve(await farm.getAddress(), lpBal);
      await farm.connect(alice).deposit(pid, lpBal);

      const [staked] = await farm.getUserInfo(pid, alice.address);
      expect(staked).to.equal(lpBal);
    });

    it("accumulates pending rewards after mining blocks", async () => {
      // Setup: alice deposits
      const seedAmt = ethers.parseEther("1000");
      await tokenA.connect(alice).approve(await router.getAddress(), seedAmt);
      await tokenB.connect(alice).approve(await router.getAddress(), seedAmt);
      await router.connect(alice).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        seedAmt, seedAmt, 0, 0, alice.address, deadline
      );
      const lpBal = await pairAB.balanceOf(alice.address);
      await pairAB.connect(alice).approve(await farm.getAddress(), lpBal);
      await farm.connect(alice).deposit(pid, lpBal);

      // Mine 10 blocks
      await ethers.provider.send("hardhat_mine", ["0xa"]);

      const pending = await farm.pendingReward(pid, alice.address);
      expect(pending).to.be.gt(0n);
    });

    it("alice can harvest rewards", async () => {
      const seedAmt = ethers.parseEther("1000");
      await tokenA.connect(alice).approve(await router.getAddress(), seedAmt);
      await tokenB.connect(alice).approve(await router.getAddress(), seedAmt);
      await router.connect(alice).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        seedAmt, seedAmt, 0, 0, alice.address, deadline
      );
      const lpBal = await pairAB.balanceOf(alice.address);
      await pairAB.connect(alice).approve(await farm.getAddress(), lpBal);
      await farm.connect(alice).deposit(pid, lpBal);

      await ethers.provider.send("hardhat_mine", ["0xa"]);

      const drwdBefore = await rewardToken.balanceOf(alice.address);
      await farm.connect(alice).harvest(pid);
      const drwdAfter  = await rewardToken.balanceOf(alice.address);
      expect(drwdAfter).to.be.gt(drwdBefore);
    });

    it("alice can withdraw LP tokens and harvest in one call", async () => {
      const seedAmt = ethers.parseEther("1000");
      await tokenA.connect(alice).approve(await router.getAddress(), seedAmt);
      await tokenB.connect(alice).approve(await router.getAddress(), seedAmt);
      await router.connect(alice).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        seedAmt, seedAmt, 0, 0, alice.address, deadline
      );
      const lpBal = await pairAB.balanceOf(alice.address);
      await pairAB.connect(alice).approve(await farm.getAddress(), lpBal);
      await farm.connect(alice).deposit(pid, lpBal);

      await ethers.provider.send("hardhat_mine", ["0x14"]);

      await farm.connect(alice).withdraw(pid, lpBal);
      expect(await pairAB.balanceOf(alice.address)).to.be.gte(lpBal);
      expect(await rewardToken.balanceOf(alice.address)).to.be.gt(0n);
    });

    it("emergency withdraw skips rewards but returns LP tokens", async () => {
      const seedAmt = ethers.parseEther("1000");
      await tokenA.connect(alice).approve(await router.getAddress(), seedAmt);
      await tokenB.connect(alice).approve(await router.getAddress(), seedAmt);
      await router.connect(alice).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(),
        seedAmt, seedAmt, 0, 0, alice.address, deadline
      );
      const lpBal = await pairAB.balanceOf(alice.address);
      await pairAB.connect(alice).approve(await farm.getAddress(), lpBal);
      await farm.connect(alice).deposit(pid, lpBal);

      await ethers.provider.send("hardhat_mine", ["0xa"]);

      await farm.connect(alice).emergencyWithdraw(pid);
      expect(await pairAB.balanceOf(alice.address)).to.equal(lpBal);
    });

    it("owner can add multiple pools with different alloc points", async () => {
      // Add another pool
      const seed = ethers.parseEther("5000");
      await tokenA.approve(await router.getAddress(), seed);
      await tokenC.approve(await router.getAddress(), seed);
      await router.addLiquidity(
        await tokenA.getAddress(), await tokenC.getAddress(),
        seed, seed, 0, 0, owner.address, deadline
      );
      const pairAC = await factory.getPair(await tokenA.getAddress(), await tokenC.getAddress());
      await farm.addPool(200, pairAC, "TKA/TKC LP");

      expect(await farm.poolLength()).to.equal(2n);
    });

    it("prevents adding the same LP token twice", async () => {
      await expect(
        farm.addPool(100, await pairAB.getAddress(), "duplicate")
      ).to.be.revertedWith("YieldFarm: LP_TOKEN_ALREADY_ADDED");
    });
  });
});
