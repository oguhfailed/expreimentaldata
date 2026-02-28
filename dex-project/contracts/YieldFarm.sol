// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RewardToken
 * @dev Governance/reward token minted exclusively by YieldFarm.
 */
contract RewardToken is ERC20, Ownable {
    constructor(address farm) ERC20("DEX Reward Token", "DRWD") Ownable(farm) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

/**
 * @title YieldFarm
 * @dev Stake LP tokens to earn DRWD reward tokens.
 *
 * Architecture (MasterChef-inspired):
 *   - Multiple pools, each accepting a different LP token
 *   - Rewards distributed proportionally to stake share
 *   - Configurable per-block emission rate
 *   - Deposit / Withdraw / Harvest / Emergency Withdraw
 *
 * Reward math:
 *   accRewardPerShare tracks cumulative reward per LP token (scaled 1e12).
 *   pending = user.amount * accRewardPerShare / 1e12 - user.rewardDebt
 */
contract YieldFarm is Ownable, ReentrancyGuard {
    // ── Data structures ───────────────────────────────────────────────────────

    struct UserInfo {
        uint256 amount;       // LP tokens staked
        uint256 rewardDebt;   // Already-accounted reward
    }

    struct PoolInfo {
        IERC20  lpToken;              // LP token to stake
        uint256 allocPoint;           // Allocation weight
        uint256 lastRewardBlock;      // Last block rewards were computed
        uint256 accRewardPerShare;    // Accumulated rewards per share (scaled 1e12)
        uint256 totalStaked;          // Total LP tokens staked in this pool
        string  name;                 // Human-readable pool label
    }

    // ── State ─────────────────────────────────────────────────────────────────

    RewardToken public immutable rewardToken;

    uint256 public rewardPerBlock;       // DRWD emitted per block (across all pools)
    uint256 public totalAllocPoint;      // Sum of all allocPoints

    PoolInfo[] public poolInfo;
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    mapping(address => bool) private _lpTokenAdded; // prevent duplicate pools

    // ── Events ────────────────────────────────────────────────────────────────

    event PoolAdded(uint256 indexed pid, address lpToken, uint256 allocPoint, string name);
    event PoolUpdated(uint256 indexed pid, uint256 allocPoint);
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Harvest(address indexed user, uint256 indexed pid, uint256 reward);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event RewardPerBlockUpdated(uint256 newRate);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(uint256 _rewardPerBlock, address initialOwner) Ownable(initialOwner) {
        rewardPerBlock = _rewardPerBlock;
        rewardToken = new RewardToken(address(this));
    }

    // ── Pool management (owner only) ──────────────────────────────────────────

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    /**
     * @notice Add a new LP token pool.
     * @param _allocPoint  Weight relative to other pools (higher = more rewards).
     * @param _lpToken     LP token contract to stake.
     * @param _name        Human-readable label (e.g. "ETH-USDC LP").
     */
    function addPool(
        uint256 _allocPoint,
        address _lpToken,
        string calldata _name
    ) external onlyOwner {
        require(!_lpTokenAdded[_lpToken], "YieldFarm: LP_TOKEN_ALREADY_ADDED");
        _massUpdatePools();
        _lpTokenAdded[_lpToken] = true;
        totalAllocPoint += _allocPoint;
        poolInfo.push(PoolInfo({
            lpToken: IERC20(_lpToken),
            allocPoint: _allocPoint,
            lastRewardBlock: block.number,
            accRewardPerShare: 0,
            totalStaked: 0,
            name: _name
        }));
        emit PoolAdded(poolInfo.length - 1, _lpToken, _allocPoint, _name);
    }

    /**
     * @notice Update allocation points of an existing pool.
     */
    function setPool(uint256 _pid, uint256 _allocPoint) external onlyOwner {
        _massUpdatePools();
        totalAllocPoint = totalAllocPoint - poolInfo[_pid].allocPoint + _allocPoint;
        poolInfo[_pid].allocPoint = _allocPoint;
        emit PoolUpdated(_pid, _allocPoint);
    }

    /**
     * @notice Change per-block reward emission.
     */
    function setRewardPerBlock(uint256 _rewardPerBlock) external onlyOwner {
        _massUpdatePools();
        rewardPerBlock = _rewardPerBlock;
        emit RewardPerBlockUpdated(_rewardPerBlock);
    }

    // ── Reward accounting ─────────────────────────────────────────────────────

    function _massUpdatePools() internal {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; pid++) {
            _updatePool(pid);
        }
    }

    /// @notice Update reward state for a single pool.
    function updatePool(uint256 _pid) external {
        _updatePool(_pid);
    }

    function _updatePool(uint256 _pid) internal {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) return;

        uint256 lpSupply = pool.totalStaked;
        if (lpSupply == 0 || totalAllocPoint == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }

        uint256 blocks = block.number - pool.lastRewardBlock;
        uint256 reward = (blocks * rewardPerBlock * pool.allocPoint) / totalAllocPoint;
        rewardToken.mint(address(this), reward);
        pool.accRewardPerShare += (reward * 1e12) / lpSupply;
        pool.lastRewardBlock = block.number;
    }

    // ── View: pending rewards ─────────────────────────────────────────────────

    /**
     * @notice View how many DRWD tokens a user can harvest from a given pool.
     */
    function pendingReward(uint256 _pid, address _user) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];

        uint256 accRewardPerShare = pool.accRewardPerShare;
        uint256 lpSupply = pool.totalStaked;

        if (block.number > pool.lastRewardBlock && lpSupply > 0 && totalAllocPoint > 0) {
            uint256 blocks = block.number - pool.lastRewardBlock;
            uint256 reward = (blocks * rewardPerBlock * pool.allocPoint) / totalAllocPoint;
            accRewardPerShare += (reward * 1e12) / lpSupply;
        }

        return (user.amount * accRewardPerShare) / 1e12 - user.rewardDebt;
    }

    // ── User actions ──────────────────────────────────────────────────────────

    /**
     * @notice Stake LP tokens into a pool.
     * @param _pid    Pool index
     * @param _amount Amount of LP tokens to stake
     */
    function deposit(uint256 _pid, uint256 _amount) external nonReentrant {
        require(_amount > 0, "YieldFarm: ZERO_AMOUNT");
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        _updatePool(_pid);

        // Harvest any accrued rewards first
        if (user.amount > 0) {
            uint256 pending = (user.amount * pool.accRewardPerShare) / 1e12 - user.rewardDebt;
            if (pending > 0) {
                rewardToken.transfer(msg.sender, pending);
                emit Harvest(msg.sender, _pid, pending);
            }
        }

        pool.lpToken.transferFrom(msg.sender, address(this), _amount);
        user.amount += _amount;
        pool.totalStaked += _amount;
        user.rewardDebt = (user.amount * pool.accRewardPerShare) / 1e12;

        emit Deposit(msg.sender, _pid, _amount);
    }

    /**
     * @notice Withdraw staked LP tokens (and auto-harvest pending rewards).
     * @param _pid    Pool index
     * @param _amount Amount of LP tokens to withdraw
     */
    function withdraw(uint256 _pid, uint256 _amount) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "YieldFarm: INSUFFICIENT_BALANCE");

        _updatePool(_pid);

        // Harvest pending rewards
        uint256 pending = (user.amount * pool.accRewardPerShare) / 1e12 - user.rewardDebt;
        if (pending > 0) {
            rewardToken.transfer(msg.sender, pending);
            emit Harvest(msg.sender, _pid, pending);
        }

        if (_amount > 0) {
            user.amount -= _amount;
            pool.totalStaked -= _amount;
            pool.lpToken.transfer(msg.sender, _amount);
        }

        user.rewardDebt = (user.amount * pool.accRewardPerShare) / 1e12;
        emit Withdraw(msg.sender, _pid, _amount);
    }

    /**
     * @notice Harvest DRWD rewards without touching staked LP tokens.
     */
    function harvest(uint256 _pid) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        _updatePool(_pid);

        uint256 pending = (user.amount * pool.accRewardPerShare) / 1e12 - user.rewardDebt;
        require(pending > 0, "YieldFarm: NOTHING_TO_HARVEST");

        user.rewardDebt = (user.amount * pool.accRewardPerShare) / 1e12;
        rewardToken.transfer(msg.sender, pending);
        emit Harvest(msg.sender, _pid, pending);
    }

    /**
     * @notice Emergency withdraw — skip reward accounting, return LP tokens immediately.
     *         Use only if the farm has a critical bug.
     */
    function emergencyWithdraw(uint256 _pid) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        require(amount > 0, "YieldFarm: NOTHING_TO_WITHDRAW");

        user.amount = 0;
        user.rewardDebt = 0;
        pool.totalStaked -= amount;
        pool.lpToken.transfer(msg.sender, amount);

        emit EmergencyWithdraw(msg.sender, _pid, amount);
    }

    // ── Pool info helpers ─────────────────────────────────────────────────────

    function getPoolInfo(uint256 _pid)
        external
        view
        returns (
            address lpToken,
            uint256 allocPoint,
            uint256 lastRewardBlock,
            uint256 accRewardPerShare,
            uint256 totalStaked,
            string memory name
        )
    {
        PoolInfo storage pool = poolInfo[_pid];
        return (
            address(pool.lpToken),
            pool.allocPoint,
            pool.lastRewardBlock,
            pool.accRewardPerShare,
            pool.totalStaked,
            pool.name
        );
    }

    function getUserInfo(uint256 _pid, address _user)
        external
        view
        returns (uint256 amount, uint256 rewardDebt)
    {
        UserInfo storage user = userInfo[_pid][_user];
        return (user.amount, user.rewardDebt);
    }
}
