// Human-readable ABIs for all DEX contracts (ethers.js v6 format)

export const ROUTER_ABI = [
  'function factory() external view returns (address)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
  'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB)',
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
  'function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts)',
  'function getPrice(address tokenA, address tokenB) external view returns (uint256 price)',
];

export const ERC20_ABI = [
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function faucet(address to) external',
];

export const PAIR_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function totalSupply() external view returns (uint256)',
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
];

export const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function allPairs(uint256 index) external view returns (address pair)',
  'function allPairsLength() external view returns (uint256)',
  'function createPair(address tokenA, address tokenB) external returns (address pair)',
];

export const FARM_ABI = [
  'function rewardToken() external view returns (address)',
  'function rewardPerBlock() external view returns (uint256)',
  'function totalAllocPoint() external view returns (uint256)',
  'function poolLength() external view returns (uint256)',
  'function getPoolInfo(uint256 pid) external view returns (address lpToken, uint256 allocPoint, uint256 lastRewardBlock, uint256 accRewardPerShare, uint256 totalStaked, string memory name)',
  'function getUserInfo(uint256 pid, address user) external view returns (uint256 amount, uint256 rewardDebt)',
  'function pendingReward(uint256 pid, address user) external view returns (uint256)',
  'function deposit(uint256 pid, uint256 amount) external',
  'function withdraw(uint256 pid, uint256 amount) external',
  'function harvest(uint256 pid) external',
];
