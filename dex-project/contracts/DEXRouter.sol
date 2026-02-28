// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IDEXFactory.sol";
import "./interfaces/IDEXPair.sol";

/**
 * @title  DEXRouter
 * @author DEX Project
 *
 * @notice The main user-facing contract for the DEX.
 *         Users call THIS contract to add liquidity, remove liquidity, and swap tokens.
 *         The router handles all the "plumbing" before delegating to the pair.
 *
 * @dev    Key responsibilities:
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  Liquidity                                                      │
 *   │    addLiquidity()    — deposit tokens, receive LP tokens        │
 *   │    removeLiquidity() — burn LP tokens, receive tokens back      │
 *   │                                                                 │
 *   │  Swaps                                                          │
 *   │    swapExactTokensForTokens() — spend exact input, variable out │
 *   │    swapTokensForExactTokens() — variable input, exact output    │
 *   │                                                                 │
 *   │  Quotes (view, no gas)                                          │
 *   │    getAmountsOut() — "if I sell X of token A, how much B?"      │
 *   │    getAmountsIn()  — "to receive Y of token B, how much A?"     │
 *   │    getPrice()      — current spot price of tokenA in tokenB     │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 *   Every state-changing function takes a `deadline` parameter.
 *   If the transaction lands on-chain after the deadline, it reverts.
 *   This protects users from miners/validators holding transactions until
 *   conditions are favorable.
 */
contract DEXRouter {

    /// @notice The factory that created (and tracks) all the pairs
    IDEXFactory public immutable factory;

    // ── Modifier ──────────────────────────────────────────────────────────────

    /**
     * @dev Revert if the transaction arrives after the caller's deadline.
     *      Deadline is expressed as a Unix timestamp (seconds since epoch).
     */
    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "DEXRouter: EXPIRED");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _factory) {
        factory = IDEXFactory(_factory);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /**
     * @dev Look up the pair for two tokens. Reverts if the pair doesn't exist.
     */
    function _getPair(address tokenA, address tokenB) internal view returns (address pair) {
        pair = factory.getPair(tokenA, tokenB);
        require(pair != address(0), "DEXRouter: PAIR_NOT_FOUND");
    }

    /**
     * @dev Return the reserves for tokenA and tokenB in the correct order
     *      regardless of which direction they are stored inside the pair.
     */
    function _getReserves(address tokenA, address tokenB)
        internal
        view
        returns (uint256 reserveA, uint256 reserveB)
    {
        address pair = _getPair(tokenA, tokenB);
        (uint112 reserve0, uint112 reserve1,) = IDEXPair(pair).getReserves();

        // The pair stores tokens in ascending address order (token0 < token1).
        // We re-map reserves so reserveA corresponds to tokenA's side.
        (reserveA, reserveB) = tokenA < tokenB
            ? (uint256(reserve0), uint256(reserve1))
            : (uint256(reserve1), uint256(reserve0));
    }

    /**
     * @dev Given a desired deposit of amountA, compute the proportional amountB
     *      required to preserve the current pool ratio.
     *
     *      amountB = amountA * reserveB / reserveA
     */
    function _quote(uint256 amountA, uint256 reserveA, uint256 reserveB)
        internal
        pure
        returns (uint256 amountB)
    {
        require(amountA > 0, "DEXRouter: INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "DEXRouter: INSUFFICIENT_LIQUIDITY");
        amountB = (amountA * reserveB) / reserveA;
    }

    /**
     * @dev Given amountIn, compute amountOut after the 0.3% swap fee.
     *
     *      Formula:  amountOut = (amountIn * 997 * reserveOut)
     *                           / (reserveIn * 1000 + amountIn * 997)
     *
     *      Derived from x * y = k by solving for amountOut.
     */
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "DEXRouter: INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "DEXRouter: INSUFFICIENT_LIQUIDITY");
        uint256 amountInWithFee = amountIn * 997; // subtract 0.3% fee from input
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    /**
     * @dev Given a desired amountOut, compute the minimum amountIn (with 0.3% fee).
     *
     *      Formula:  amountIn = (reserveIn * amountOut * 1000)
     *                          / ((reserveOut - amountOut) * 997) + 1
     *
     *      The +1 rounds up to ensure we never under-pay (would violate k-invariant).
     */
    function _getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256 amountIn)
    {
        require(amountOut > 0, "DEXRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "DEXRouter: INSUFFICIENT_LIQUIDITY");
        amountIn = (reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997) + 1;
    }

    // ── Public view: price quotes ─────────────────────────────────────────────

    /**
     * @notice Given an exact input amount, calculate how much you get at each hop.
     * @dev    Follows the `path` array: path[0] is input token, path[last] is output.
     *         Each consecutive pair in the path must have a deployed DEXPair.
     *
     * @param  amountIn  Exact amount of path[0] to sell
     * @param  path      Token addresses: [tokenIn, ..., tokenOut]
     * @return amounts   amounts[i] = tokens you hold after hop i
     *                   amounts[0] = amountIn, amounts[last] = what you receive
     */
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        public
        view
        returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "DEXRouter: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        // Walk forward through the path, converting at each hop
        for (uint256 i = 0; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) = _getReserves(path[i], path[i + 1]);
            amounts[i + 1] = _getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    /**
     * @notice Given a desired output amount, calculate how much input is needed at each hop.
     * @dev    Walks the path BACKWARDS from output to input.
     *
     * @param  amountOut  Exact amount of path[last] you want to receive
     * @param  path       Token addresses: [tokenIn, ..., tokenOut]
     * @return amounts    amounts[0] = how much tokenIn you must spend
     */
    function getAmountsIn(uint256 amountOut, address[] calldata path)
        public
        view
        returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "DEXRouter: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;

        // Walk backward through the path
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 reserveIn, uint256 reserveOut) = _getReserves(path[i - 1], path[i]);
            amounts[i - 1] = _getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }

    // ── Liquidity ─────────────────────────────────────────────────────────────

    /**
     * @notice Deposit tokenA + tokenB into a pool and receive LP tokens.
     *         If the pool doesn't exist yet, it is created automatically.
     *
     * @dev    The router figures out the optimal deposit amounts:
     *           - For a new (empty) pool: uses the "Desired" amounts as-is.
     *           - For an existing pool: scales one token down to match the ratio,
     *             staying within the "Min" slippage bounds.
     *
     *         Flow:
     *           1. Create pair if needed (via factory).
     *           2. Compute the optimal (amountA, amountB) that respects current ratio.
     *           3. transferFrom both tokens from msg.sender → pair contract.
     *           4. Call pair.mint(to) which mints LP tokens to `to`.
     *
     * @param  tokenA         First token address
     * @param  tokenB         Second token address
     * @param  amountADesired Max amount of tokenA caller is willing to deposit
     * @param  amountBDesired Max amount of tokenB caller is willing to deposit
     * @param  amountAMin     Min tokenA to deposit (slippage protection — revert if below)
     * @param  amountBMin     Min tokenB to deposit (slippage protection)
     * @param  to             Address that receives the LP tokens
     * @param  deadline       Unix timestamp: revert if mined after this
     * @return amountA        Actual tokenA deposited
     * @return amountB        Actual tokenB deposited
     * @return liquidity      LP tokens minted to `to`
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {

        // Create pair if this is the first time these two tokens are paired
        if (factory.getPair(tokenA, tokenB) == address(0)) {
            factory.createPair(tokenA, tokenB);
        }

        address pair = _getPair(tokenA, tokenB);
        (uint256 reserveA, uint256 reserveB) = _getReserves(tokenA, tokenB);

        if (reserveA == 0 && reserveB == 0) {
            // ── Pool is empty: seed with desired amounts ───────────────────
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            // ── Pool has reserves: calculate optimal deposit to match ratio ─
            uint256 amountBOptimal = _quote(amountADesired, reserveA, reserveB);

            if (amountBOptimal <= amountBDesired) {
                // We can deposit amountADesired tokenA and a proportional (smaller) tokenB
                require(amountBOptimal >= amountBMin, "DEXRouter: INSUFFICIENT_B_AMOUNT");
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                // tokenB is the constraining side; scale tokenA down instead
                uint256 amountAOptimal = _quote(amountBDesired, reserveB, reserveA);
                require(amountAOptimal <= amountADesired && amountAOptimal >= amountAMin, "DEXRouter: INSUFFICIENT_A_AMOUNT");
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }

        // Pull tokens from caller into the pair contract, then mint LP tokens
        IERC20(tokenA).transferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).transferFrom(msg.sender, pair, amountB);
        liquidity = IDEXPair(pair).mint(to);
    }

    /**
     * @notice Burn LP tokens and recover the underlying tokenA + tokenB.
     *
     * @dev    Flow:
     *           1. Transfer LP tokens from caller → pair contract.
     *           2. Call pair.burn(to) which sends back both tokens to `to`.
     *           3. Assert returned amounts are above the caller's minimums.
     *
     * @param  tokenA      First token of the pair
     * @param  tokenB      Second token of the pair
     * @param  liquidity   Amount of LP tokens to burn
     * @param  amountAMin  Min tokenA caller expects back (slippage protection)
     * @param  amountBMin  Min tokenB caller expects back (slippage protection)
     * @param  to          Address that receives tokenA and tokenB
     * @param  deadline    Unix timestamp deadline
     * @return amountA     Amount of tokenA returned
     * @return amountB     Amount of tokenB returned
     */
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pair = _getPair(tokenA, tokenB);

        // Send LP tokens to the pair so it can burn them
        IERC20(pair).transferFrom(msg.sender, pair, liquidity);

        // Pair burns LP and returns token amounts (in token0/token1 order)
        (uint256 amount0, uint256 amount1) = IDEXPair(pair).burn(to);

        // Re-map from token0/token1 order back to tokenA/tokenB order
        (address token0,) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);

        // Slippage guard
        require(amountA >= amountAMin, "DEXRouter: INSUFFICIENT_A_AMOUNT");
        require(amountB >= amountBMin, "DEXRouter: INSUFFICIENT_B_AMOUNT");
    }

    // ── Swaps ─────────────────────────────────────────────────────────────────

    /**
     * @dev Internal swap executor: iterates over the path and calls pair.swap() at each hop.
     *      For multi-hop: the intermediate output goes directly to the NEXT pair contract,
     *      so only one token approval is needed from the user.
     */
    function _swap(uint256[] memory amounts, address[] memory path, address _to) internal {
        for (uint256 i = 0; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            address pair = factory.getPair(input, output);

            // Determine which side is output (token0 or token1)
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input < output
                ? (uint256(0), amountOut)   // outputting token1 (the larger address)
                : (amountOut, uint256(0));  // outputting token0 (the smaller address)

            // For multi-hop: send output directly to the NEXT pair contract
            // For the final hop: send to the user's `_to` address
            address to = i < path.length - 2
                ? factory.getPair(output, path[i + 2])
                : _to;

            IDEXPair(pair).swap(amount0Out, amount1Out, to);
        }
    }

    /**
     * @notice Sell an exact amount of input tokens for as many output tokens as possible.
     *
     * @dev    Example (single-hop):
     *           Sell 100 USDC → get as much WBTC as the pool allows (minus 0.3% fee).
     *
     *         Example (multi-hop):
     *           Sell 100 USDC → WBTC → LINK  (two pool hops, one approval needed)
     *
     * @param  amountIn       Exact amount of path[0] to sell
     * @param  amountOutMin   Minimum amount of path[last] to accept (slippage guard)
     * @param  path           [tokenIn, ...intermediaries..., tokenOut]
     * @param  to             Address that receives the final output tokens
     * @param  deadline       Unix timestamp deadline
     * @return amounts        amounts[i] = tokens at each step of the path
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        // Calculate what we'll get at the end of the path
        amounts = getAmountsOut(amountIn, path);

        // Slippage check: did the pool price move too much since the user sent the tx?
        require(amounts[amounts.length - 1] >= amountOutMin, "DEXRouter: INSUFFICIENT_OUTPUT_AMOUNT");

        // Pull input tokens from user into the first pair
        IERC20(path[0]).transferFrom(msg.sender, factory.getPair(path[0], path[1]), amounts[0]);

        // Execute all hops
        _swap(amounts, path, to);
    }

    /**
     * @notice Buy an exact amount of output tokens, paying as little input as needed.
     *
     * @dev    Example:
     *           Buy exactly 100 LINK, paying at most 200 USDC.
     *           Router figures out the precise USDC amount required (≤200).
     *
     * @param  amountOut     Exact amount of path[last] you want to receive
     * @param  amountInMax   Maximum amount of path[0] you're willing to pay (slippage guard)
     * @param  path          [tokenIn, ...intermediaries..., tokenOut]
     * @param  to            Address that receives the output tokens
     * @param  deadline      Unix timestamp deadline
     * @return amounts       amounts[0] = actual tokenIn spent, amounts[last] = amountOut
     */
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        // Work backwards from desired output to required input
        amounts = getAmountsIn(amountOut, path);

        // Slippage check: did the pool price move too much?
        require(amounts[0] <= amountInMax, "DEXRouter: EXCESSIVE_INPUT_AMOUNT");

        // Pull only the required input amount from user
        IERC20(path[0]).transferFrom(msg.sender, factory.getPair(path[0], path[1]), amounts[0]);

        _swap(amounts, path, to);
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    /**
     * @notice Get the current spot price of tokenA measured in tokenB.
     * @dev    price = reserveB / reserveA * 1e18 (scaled to avoid decimals)
     *         This is the MARGINAL price; large trades will move the price.
     *
     * @param  tokenA  Token to price
     * @param  tokenB  Denomination token
     * @return price   Amount of tokenB per 1 whole tokenA (× 1e18)
     */
    function getPrice(address tokenA, address tokenB) external view returns (uint256 price) {
        (uint256 reserveA, uint256 reserveB) = _getReserves(tokenA, tokenB);
        price = (reserveB * 1e18) / reserveA;
    }
}
