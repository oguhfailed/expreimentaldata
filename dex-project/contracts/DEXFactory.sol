// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./DEXPair.sol";
import "./interfaces/IDEXFactory.sol";

/**
 * @title  DEXFactory
 * @author DEX Project
 *
 * @notice Registry and deployer of DEXPair contracts.
 *
 * @dev    Responsibilities:
 *   1. Create a new DEXPair for any (tokenA, tokenB) combination (once only).
 *   2. Store a mapping so anyone can look up "what's the pair for USDC/WBTC?".
 *   3. Keep an ordered list of ALL pairs ever created.
 *   4. Optionally record a `feeTo` address to collect protocol fees.
 *
 *   Pairs are deployed with CREATE2, giving them deterministic addresses.
 *   The address only depends on (token0, token1), not on deployment order,
 *   so the router and off-chain tools can compute a pair address without an RPC call.
 */
contract DEXFactory is IDEXFactory {

    // ── State ─────────────────────────────────────────────────────────────────

    /// @notice Address that receives protocol fees (if enabled). Zero = disabled.
    address public override feeTo;

    /// @notice Only this address can change `feeTo` or transfer this role.
    address public override feeToSetter;

    /**
     * @notice getPair[tokenA][tokenB] → pair contract address.
     * @dev    Bidirectional: getPair[A][B] always equals getPair[B][A].
     *         Returns address(0) if the pair has not been created yet.
     */
    mapping(address => mapping(address => address)) public override getPair;

    /// @notice Ordered list of every DEXPair ever created (useful for enumeration)
    address[] public override allPairs;

    // ── Constructor ───────────────────────────────────────────────────────────

    /**
     * @param _feeToSetter  Account authorised to configure the protocol fee recipient
     */
    constructor(address _feeToSetter) {
        feeToSetter = _feeToSetter;
    }

    // ── View ──────────────────────────────────────────────────────────────────

    /// @notice Total number of trading pairs that have been deployed
    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    // ── Pair creation ─────────────────────────────────────────────────────────

    /**
     * @notice Deploy a new DEXPair for tokenA / tokenB.
     *         Anyone can call this; pair creation is permissionless.
     *
     * @dev    Steps:
     *           1. Sort token addresses (token0 < token1) — canonical ordering.
     *           2. Validate inputs (non-zero, not identical, not already created).
     *           3. Deploy DEXPair via CREATE2 using salt = keccak256(token0, token1).
     *           4. Call pair.initialize() to set its two token addresses.
     *           5. Register the pair in both mapping directions.
     *           6. Push to allPairs array and emit PairCreated.
     *
     * @param  tokenA  One of the two tokens (order doesn't matter to caller)
     * @param  tokenB  The other token
     * @return pair    Address of the newly created DEXPair
     */
    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        require(tokenA != tokenB, "DEXFactory: IDENTICAL_ADDRESSES");

        // Sort so token0 always has the smaller address value (canonical order).
        // This ensures (USDC, WBTC) and (WBTC, USDC) resolve to the same pair.
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        require(token0 != address(0), "DEXFactory: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "DEXFactory: PAIR_EXISTS");

        // CREATE2 gives a deterministic address: new address depends only on
        // (factory address, bytecode, salt). salt = keccak256(token0, token1).
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        DEXPair newPair = new DEXPair{salt: salt}();

        // Tell the pair which tokens it manages (token0 and token1)
        newPair.initialize(token0, token1);

        pair = address(newPair);

        // Register bidirectionally so both lookup orders return the same pair
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;

        // Keep an ordered list for front-end enumeration
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    // ── Protocol fee configuration ────────────────────────────────────────────

    /**
     * @notice Set the address that collects a share of every swap's fee.
     * @dev    Setting to address(0) disables protocol fee collection.
     *         Only callable by the current feeToSetter.
     */
    function setFeeTo(address _feeTo) external override {
        require(msg.sender == feeToSetter, "DEXFactory: FORBIDDEN");
        feeTo = _feeTo;
    }

    /**
     * @notice Transfer the feeToSetter role to a new address.
     * @dev    Only callable by the current feeToSetter.
     */
    function setFeeToSetter(address _feeToSetter) external override {
        require(msg.sender == feeToSetter, "DEXFactory: FORBIDDEN");
        feeToSetter = _feeToSetter;
    }
}
