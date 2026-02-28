# DEX Project — 30 ERC-20 Tokens + AMM Swaps + Yield Farming

A full Decentralized Exchange built in Solidity with:
- **30 ERC-20 tokens** (USDC, WBTC, WETH, LINK, UNI, AAVE, and 24 more)
- **AMM (Automated Market Maker)** — Uniswap V2 constant-product formula `x * y = k`
- **Swap** — single-hop and multi-hop token swaps with 0.3% fee
- **Liquidity Provision** — add/remove liquidity, earn LP tokens
- **Yield Farming** — stake LP tokens to earn DRWD reward tokens

---

## Project Structure

```
dex-project/
├── contracts/
│   ├── tokens/
│   │   └── GenericERC20.sol      ← Template for all 30 tokens
│   ├── interfaces/
│   │   ├── IDEXFactory.sol       ← Factory interface
│   │   └── IDEXPair.sol          ← Pair interface
│   ├── DEXFactory.sol            ← Creates & tracks trading pairs
│   ├── DEXPair.sol               ← AMM pool (LP token + swap logic)
│   ├── DEXRouter.sol             ← User-facing swap & liquidity contract
│   └── YieldFarm.sol             ← Stake LP tokens → earn DRWD rewards
├── scripts/
│   ├── deploy.js                 ← Deploy everything + seed 29 liquidity pairs
│   ├── swap.js                   ← Swap demo (direct, multi-hop, exact-out)
│   ├── addLiquidity.js           ← Liquidity add/remove demo
│   └── farm.js                   ← Yield farming stake/harvest/withdraw demo
├── test/
│   └── DEX.test.js               ← 20+ unit tests for all contracts
├── hardhat.config.js
└── package.json
```

---

## How to Run Locally

### 1. Install dependencies
```bash
npm install
```

### 2. Compile contracts
```bash
npx hardhat compile
```

### 3. Run tests
```bash
npx hardhat test
```

### 4. Start a local Hardhat node (in one terminal)
```bash
npx hardhat node
```

### 5. Deploy everything (in another terminal)
```bash
npx hardhat run scripts/deploy.js --network localhost
```

This will:
- Deploy all **30 ERC-20 tokens** (each with 1,000,000 supply)
- Deploy **DEXFactory**, **DEXRouter**, **YieldFarm** + **RewardToken (DRWD)**
- Create **29 trading pairs** (all against USDC as the base token)
- Seed each pair with **10,000 USDC + 10,000 TOKEN** as initial liquidity
- Register all 29 LP tokens with the **YieldFarm** (each pool gets 100 alloc points)
- Save all deployed addresses to `deployments.json`

---

## How to Swap

```bash
npx hardhat run scripts/swap.js --network localhost
```

**Swap A → USDC → WBTC** (direct swap):
```js
await router.swapExactTokensForTokens(
  amountIn,          // how many USDC to sell
  amountOutMin,      // minimum WBTC to accept (slippage protection)
  [USDC, WBTC],      // path: 1 hop
  recipient,
  deadline
);
```

**Multi-hop USDC → WBTC → LINK**:
```js
await router.swapExactTokensForTokens(
  amountIn,
  amountOutMin,
  [USDC, WBTC, LINK], // 2 hops: goes through USDC/WBTC pool, then WBTC/LINK pool
  recipient,
  deadline
);
```

**Buy exact output (swapTokensForExactTokens)**:
```js
// Want exactly 100 LINK, pay USDC
await router.swapTokensForExactTokens(
  ethers.parseEther("100"),   // exactOut
  maxUSDCWillingToPay,        // amountInMax
  [USDC, LINK],
  recipient,
  deadline
);
```

---

## How to Add/Remove Liquidity

```bash
npx hardhat run scripts/addLiquidity.js --network localhost
```

**Add liquidity**:
```js
// Approve router first
await usdc.approve(router.address, usdcAmount);
await link.approve(router.address, linkAmount);

// Add liquidity → receive LP tokens
await router.addLiquidity(
  USDC, LINK,
  usdcAmount, linkAmount,
  0, 0,           // min amounts (0 = accept any ratio, set properly in production)
  recipient,
  deadline
);
```

**Remove liquidity**:
```js
// Approve router to spend LP tokens
await lpToken.approve(router.address, lpAmount);

// Burn LP tokens → get USDC + LINK back
await router.removeLiquidity(
  USDC, LINK,
  lpAmount,
  0, 0,           // minimum amounts to receive back
  recipient,
  deadline
);
```

---

## How to Yield Farm

```bash
npx hardhat run scripts/farm.js --network localhost
```

**Step-by-step farming**:

```js
// 1. Get LP tokens by adding liquidity (see above)

// 2. Approve farm to spend LP tokens
await lpToken.approve(farm.address, lpAmount);

// 3. Stake LP tokens into pool 0 (USDC/WBTC)
await farm.deposit(0, lpAmount);

// 4. Wait... rewards accumulate every block

// 5. Check pending DRWD rewards
const pending = await farm.pendingReward(0, myAddress);

// 6. Harvest rewards (without withdrawing LP tokens)
await farm.harvest(0);

// 7. Withdraw LP tokens + auto-harvest remaining rewards
await farm.withdraw(0, lpAmount);

// 8. Emergency exit (skips rewards, returns LP tokens immediately)
await farm.emergencyWithdraw(0);
```

**Pool management (owner only)**:
```js
// Add a new farm pool
await farm.addPool(200, lpTokenAddress, "USDC/WETH LP");

// Change alloc points (higher = more DRWD per block)
await farm.setPool(poolId, newAllocPoints);

// Change emission rate
await farm.setRewardPerBlock(ethers.parseEther("2")); // 2 DRWD/block
```

---

## 30 Deployed Tokens

| # | Name | Symbol | Decimals |
|---|------|--------|----------|
| 1 | USD Coin | USDC | 6 |
| 2 | Wrapped Bitcoin | WBTC | 8 |
| 3 | Wrapped Ether | WETH | 18 |
| 4 | Chainlink | LINK | 18 |
| 5 | Uniswap | UNI | 18 |
| 6 | Aave | AAVE | 18 |
| 7 | Compound | COMP | 18 |
| 8 | Maker | MKR | 18 |
| 9 | Synthetix | SNX | 18 |
| 10 | Curve DAO | CRV | 18 |
| 11 | Yearn Finance | YFI | 18 |
| 12 | SushiSwap | SUSHI | 18 |
| 13 | Balancer | BAL | 18 |
| 14 | 1inch | 1INCH | 18 |
| 15 | dYdX | DYDX | 18 |
| 16 | GMX | GMX | 18 |
| 17 | Convex Finance | CVX | 18 |
| 18 | Lido DAO | LDO | 18 |
| 19 | Rocket Pool | RPL | 18 |
| 20 | Frax Share | FXS | 18 |
| 21 | PancakeSwap | CAKE | 18 |
| 22 | Radiant Capital | RDNT | 18 |
| 23 | Pendle | PENDLE | 18 |
| 24 | Velodrome Finance | VELO | 18 |
| 25 | Aerodrome Finance | AERO | 18 |
| 26 | Stargate Finance | STG | 18 |
| 27 | Arbitrum | ARB | 18 |
| 28 | Optimism | OP | 18 |
| 29 | Blur | BLUR | 18 |
| 30 | Ondo Finance | ONDO | 18 |

---

## Architecture Deep Dive

### AMM Math (x * y = k)

```
                  reserve0 × reserve1 = k (constant product)

  When you swap amountIn of token0 for amountOut of token1:
    new_reserve0 = reserve0 + amountIn
    new_reserve1 = k / new_reserve0

    amountOut = reserve1 - new_reserve1
              = reserve1 - (reserve0 × reserve1) / (reserve0 + amountIn)

  With 0.3% fee (997/1000 of input counts):
    effective_amountIn = amountIn × 997
    amountOut = (effective_amountIn × reserve1) / (reserve0 × 1000 + effective_amountIn)
```

### Yield Farm Math

```
  accRewardPerShare tracks cumulative rewards per LP token (×1e12 for precision).

  When pool state changes (deposit/withdraw/harvest):
    blocks_elapsed = block.number - lastRewardBlock
    new_rewards = blocks_elapsed × rewardPerBlock × (pool.allocPoint / totalAllocPoint)
    accRewardPerShare += new_rewards × 1e12 / totalStaked

  User's pending reward:
    pending = user.amount × accRewardPerShare / 1e12 - user.rewardDebt

  After claiming, rewardDebt is updated to current accRewardPerShare:
    user.rewardDebt = user.amount × accRewardPerShare / 1e12
```

---

## Testnet Deployment

```bash
cp .env.example .env
# Fill in: PRIVATE_KEY, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY

npx hardhat run scripts/deploy.js --network sepolia
```

---

## Security Notes

- All state-changing functions use `ReentrancyGuard`
- Swaps verify the `k` invariant after every trade
- All user functions require a `deadline` to prevent stale transactions
- `emergencyWithdraw` lets users exit the farm even if rewards are broken
- Farm prevents duplicate LP token pools
- Factory prevents duplicate pairs
