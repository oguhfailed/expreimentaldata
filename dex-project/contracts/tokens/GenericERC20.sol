// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// OpenZeppelin's ERC20 gives us a fully standards-compliant token implementation.
// We inherit from it instead of writing transfer/approve logic from scratch.
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Ownable adds an `owner` address that can call `onlyOwner` functions.
// Used here so only the deployer can mint new tokens.
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  GenericERC20
 * @author DEX Project
 *
 * @notice A flexible ERC-20 token used for every token in the DEX.
 *         All 30 tokens are instances of this same contract, each deployed
 *         with a different name, symbol, and decimal count.
 *
 * @dev Key features:
 *   • Custom decimals (some tokens like USDC use 6, BTC uses 8, most use 18)
 *   • Owner can mint additional supply (useful for testing)
 *   • Public faucet so anyone can grab 1,000 tokens for demos/testing
 */
contract GenericERC20 is ERC20, Ownable {

    // Store the decimal count separately because ERC20 parent defaults to 18
    uint8 private _decimals;

    /**
     * @notice Deploy a new ERC-20 token.
     *
     * @param name_          Human-readable name, e.g. "USD Coin"
     * @param symbol_        Ticker symbol, e.g. "USDC"
     * @param decimals_      Token precision (6 for USDC, 8 for WBTC, 18 for most)
     * @param initialSupply  How many whole tokens to mint at deploy time
     * @param initialHolder  Who receives the initial supply (usually the deployer)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply,
        address initialHolder
    )
        ERC20(name_, symbol_)     // Pass name + symbol to the parent ERC20
        Ownable(initialHolder)    // Set initialHolder as the owner
    {
        _decimals = decimals_;

        // Mint the initial supply in the token's smallest unit.
        // Example: initialSupply=1,000,000 with decimals=6 → mints 1_000_000 * 10^6
        _mint(initialHolder, initialSupply * (10 ** decimals_));
    }

    /**
     * @notice Returns how many decimal places this token uses.
     * @dev    Overrides the ERC20 parent which hardcodes 18.
     */
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Mint new tokens to any address.
     * @dev    Restricted to the contract owner.  Useful in testing to top-up balances.
     *
     * @param to     Address that receives the new tokens
     * @param amount Amount in the token's smallest unit (wei-equivalent)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Public faucet — anyone can call this to receive 1,000 tokens.
     * @dev    Intended for testnet / demo use so participants can get tokens
     *         without needing the owner to send them.
     *
     * @param to  Address that receives 1,000 tokens
     */
    function faucet(address to) external {
        // 1000 whole tokens, scaled to the token's decimal precision
        _mint(to, 1000 * (10 ** _decimals));
    }
}
