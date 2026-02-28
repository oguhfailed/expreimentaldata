// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ERC20: LP token that this pair contract itself IS (inherits from ERC20)
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// IERC20: standard interface to interact with tokenA and tokenB inside the pool
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// Math: provides Math.sqrt() and Math.min() for liquidity calculations
import "@openzeppelin/contracts/utils/math/Math.sol";
// ReentrancyGuard: prevents re-entrant calls (critical for DEX safety)
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IDEXFactory.sol";
import "./interfaces/IDEXPair.sol";

/**
 * @title  DEXPair
 * @author DEX Project
 *
 * @notice One trading pool for a specific token-pair (e.g. USDC / WBTC).
 *         Implements a Constant-Product Automated Market Maker (AMM):
 *
 *                   reserve0 × reserve1 = k   (the "k invariant")
 *
 *         Swap math:
 *           • When a user adds `amountIn` of token0, the pool gives back
 *             amountOut of token1 such that the product k stays constant.
 *           • A 0.3% fee is taken from every swap (the fee stays in the pool
 *             and accrues to liquidity providers).
 *
 *         Liquidity Providers (LPs):
 *           • Deposit proportional amounts of both tokens.
 *           • Receive LP tokens representing their share of the pool.
 *           • Burn LP tokens to withdraw their share (principal + fees earned).
 *
 * @dev  Architecture mirrors Uniswap V2 pair contract.
 *       Each pair is deployed by DEXFactory via CREATE2 (deterministic address).
 */
contract DEXPair is ERC20, ReentrancyGuard, IDEXPair {

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Minimum LP tokens permanently locked on first deposit.
     * @dev    Prevents the pool from being drained to zero and protects against
     *         a price-manipulation attack on empty pools.
     *         These 1000 "dead" LP tokens go to address(1) and are never redeemable.
     */
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Address of the DEXFactory that deployed this pair
    address public factory;

    /// @notice The "lower" address token (token addresses are sorted at creation)
    address public token0;

    /// @notice The "higher" address token
    address public token1;

    // Reserves are stored as uint112 to pack efficiently into one 256-bit slot
    uint112 private reserve0;            // Current balance of token0 inside the pool
    uint112 private reserve1;            // Current balance of token1 inside the pool
    uint32  private blockTimestampLast;  // Block timestamp of the last reserve update

    // Swap fee: 0.3%  →  multiply amountIn by 997/1000
    uint256 private constant FEE_NUMERATOR   = 997;
    uint256 private constant FEE_DENOMINATOR = 1000;

    bool private initialized; // Guards against calling initialize() twice

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Minimal constructor.  Real setup happens in initialize() called by factory.
     *      The pair IS itself an ERC-20 (the LP token), so we call ERC20("DEX-LP","DEX-LP").
     */
    constructor() ERC20("DEX-LP", "DEX-LP") {}

    // ─────────────────────────────────────────────────────────────────────────
    // Initialiser
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Set the two token addresses for this pair.  Called once by DEXFactory.
     * @dev    Tokens are always stored in ascending address order (token0 < token1)
     *         so that every piece of code can rely on a consistent ordering.
     *
     * @param _token0  Lower-address token (sorted by the factory)
     * @param _token1  Higher-address token
     */
    function initialize(address _token0, address _token1) external override {
        require(!initialized, "DEXPair: already initialized");
        require(msg.sender == factory || factory == address(0), "DEXPair: FORBIDDEN");
        if (factory == address(0)) factory = msg.sender;
        token0 = _token0;
        token1 = _token1;
        initialized = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View helpers — read the pool state
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Return the current reserves (pool balances) and the last-updated timestamp.
     * @return reserve0            How many token0 are in the pool
     * @return reserve1            How many token1 are in the pool
     * @return blockTimestampLast  When the reserves were last synced (Unix seconds)
     */
    function getReserves()
        public
        view
        override
        returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)
    {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    /**
     * @notice Dynamic LP token name: "DEX-LP-USDC-WBTC"
     * @dev    Reads symbols from the underlying ERC-20 contracts at runtime.
     */
    function name() public view override returns (string memory) {
        return string(abi.encodePacked("DEX-LP-", _symbol(token0), "-", _symbol(token1)));
    }

    /// @notice Dynamic LP token symbol: "LP-USDC-WBTC"
    function symbol() public view override returns (string memory) {
        return string(abi.encodePacked("LP-", _symbol(token0), "-", _symbol(token1)));
    }

    /// @dev Safely fetch a token's symbol string; falls back to "???" if the call fails
    function _symbol(address token) internal view returns (string memory) {
        try IERC20Metadata(token).symbol() returns (string memory s) {
            return s;
        } catch {
            return "???";
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal reserve update
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev  Sync the stored reserves to the actual balances held by this contract.
     *       Must be called after every state-changing operation (mint/burn/swap).
     */
    function _update(uint256 balance0, uint256 balance1) private {
        // Overflow guard: balances must fit in uint112
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "DEXPair: OVERFLOW");
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = uint32(block.timestamp);
        emit Sync(reserve0, reserve1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Liquidity — mint LP tokens
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposit tokens and receive LP tokens in return.
     *
     * @dev    IMPORTANT: The caller must transfer token0 AND token1 to this contract
     *         BEFORE calling mint().  The router does this for you.
     *
     *         LP math (after first deposit):
     *           liquidity = min(
     *             amount0 * totalSupply / reserve0,
     *             amount1 * totalSupply / reserve1
     *           )
     *
     *         First deposit:
     *           liquidity = sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY
     *           (MINIMUM_LIQUIDITY is permanently burned to address(1))
     *
     * @param  to       Address that receives the newly minted LP tokens
     * @return liquidity  Amount of LP tokens minted
     */
    function mint(address to) external override nonReentrant returns (uint256 liquidity) {
        // Read current reserves (before this deposit)
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();

        // Actual balances after the tokens were sent to us
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        // How much was deposited = new balance - old reserve
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        uint256 _totalSupply = totalSupply();

        if (_totalSupply == 0) {
            // ── First deposit ──────────────────────────────────────────────
            // Geometric mean ensures LP tokens are independent of the initial price ratio
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            // Lock the dead shares forever so totalSupply can never be 0 again
            _mint(address(1), MINIMUM_LIQUIDITY);
        } else {
            // ── Subsequent deposits ────────────────────────────────────────
            // Take the minimum to prevent manipulating the ratio to get more LP tokens
            liquidity = Math.min(
                (amount0 * _totalSupply) / _reserve0,
                (amount1 * _totalSupply) / _reserve1
            );
        }

        require(liquidity > 0, "DEXPair: INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);
        _update(balance0, balance1); // Sync reserves to new balances

        emit Mint(msg.sender, amount0, amount1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Liquidity — burn LP tokens
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Burn LP tokens and reclaim the underlying token0 + token1.
     *
     * @dev    The caller must transfer LP tokens to this contract BEFORE calling burn().
     *         The router does this for you.
     *
     *         Withdrawal math:
     *           amount0 = liquidity * balance0 / totalSupply
     *           amount1 = liquidity * balance1 / totalSupply
     *
     *         The withdrawn share includes fees accumulated since deposit.
     *
     * @param  to   Address that receives token0 and token1
     * @return amount0  Amount of token0 returned
     * @return amount1  Amount of token1 returned
     */
    function burn(address to) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        // Actual balances of each token held by this contract
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        // LP tokens that were sent to this address (to burn)
        uint256 liquidity = balanceOf(address(this));
        uint256 _totalSupply = totalSupply();

        // Pro-rata share of each token based on LP tokens burned
        amount0 = (liquidity * balance0) / _totalSupply;
        amount1 = (liquidity * balance1) / _totalSupply;
        require(amount0 > 0 && amount1 > 0, "DEXPair: INSUFFICIENT_LIQUIDITY_BURNED");

        // Burn the LP tokens, then send back the underlying tokens
        _burn(address(this), liquidity);
        IERC20(token0).transfer(to, amount0);
        IERC20(token1).transfer(to, amount1);

        // Sync reserves to the new (lower) balances
        _update(
            IERC20(token0).balanceOf(address(this)),
            IERC20(token1).balanceOf(address(this))
        );

        emit Burn(msg.sender, amount0, amount1, to);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Swap
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Execute a token swap.
     *
     * @dev    IMPORTANT: The caller must transfer the input tokens to this contract
     *         BEFORE calling swap().  The router handles this.
     *
     *         K-invariant check (0.3% fee):
     *           (balance0 * 997 - amount0In * 3) * (balance1 * 997 - amount1In * 3)
     *               ≥ reserve0 * reserve1 * 997^2
     *
     *         This guarantees the product k can only stay the same or increase,
     *         which means LPs only ever earn fees, never lose them via the math.
     *
     * @param  amount0Out  Amount of token0 to send OUT of the pool (0 if swapping to token1)
     * @param  amount1Out  Amount of token1 to send OUT of the pool (0 if swapping to token0)
     * @param  to          Address that receives the output tokens
     */
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external override nonReentrant {
        require(amount0Out > 0 || amount1Out > 0, "DEXPair: INSUFFICIENT_OUTPUT_AMOUNT");

        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        // Cannot take out more than what's in the pool
        require(amount0Out < _reserve0 && amount1Out < _reserve1, "DEXPair: INSUFFICIENT_LIQUIDITY");

        // Send the output tokens to the recipient FIRST (optimistic transfer pattern)
        if (amount0Out > 0) IERC20(token0).transfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).transfer(to, amount1Out);

        // Read balances AFTER sending output (includes the input the caller sent)
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        // Derive how much was sent IN by comparing balances to reserves minus output
        uint256 amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "DEXPair: INSUFFICIENT_INPUT_AMOUNT");

        // ── K-invariant check with fee ─────────────────────────────────────
        // Multiply by FEE_DENOMINATOR before subtracting fee from amountIn.
        // This keeps the math in integer arithmetic without losing precision.
        uint256 balance0Adjusted = balance0 * FEE_DENOMINATOR - amount0In * (FEE_DENOMINATOR - FEE_NUMERATOR);
        uint256 balance1Adjusted = balance1 * FEE_DENOMINATOR - amount1In * (FEE_DENOMINATOR - FEE_NUMERATOR);

        require(
            balance0Adjusted * balance1Adjusted >= uint256(_reserve0) * uint256(_reserve1) * (FEE_DENOMINATOR ** 2),
            "DEXPair: K_INVARIANT"
        );

        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /**
     * @notice Force reserves to match current token balances.
     * @dev    Useful if tokens were sent directly to this contract without using the router.
     *         Anyone can call this to re-sync; it is safe because only the reserves are updated.
     */
    function sync() external override nonReentrant {
        _update(
            IERC20(token0).balanceOf(address(this)),
            IERC20(token1).balanceOf(address(this))
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Price helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Calculate how much output you get for a given input (accounts for 0.3% fee).
     *
     * @dev    Formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
     *         Derived from the constant-product formula with fee applied.
     *
     * @param  amountIn   Input token amount (in the token's smallest unit)
     * @param  tokenIn    Address of the token being sold
     * @return amountOut  Amount of the OTHER token you would receive
     */
    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256 amountOut) {
        require(amountIn > 0, "DEXPair: INSUFFICIENT_INPUT");
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();

        // Determine which side is "in" and which is "out"
        (uint256 reserveIn, uint256 reserveOut) = tokenIn == token0
            ? (uint256(_reserve0), uint256(_reserve1))
            : (uint256(_reserve1), uint256(_reserve0));

        require(reserveIn > 0 && reserveOut > 0, "DEXPair: INSUFFICIENT_LIQUIDITY");

        // Apply 0.3% fee: effectiveAmountIn = amountIn * 997
        uint256 amountInWithFee = amountIn * FEE_NUMERATOR;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
    }
}
