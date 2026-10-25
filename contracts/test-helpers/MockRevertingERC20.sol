// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev An ERC-20 mock whose transferFrom always reverts.
/// Used to exercise the try/catch path in Kameti.payAllAutoPay():
/// even when usdc.balanceOf and allowance look sufficient (bypassed
/// via vm.etch + manual storage writes), the transferFrom call itself
/// reverts, so the contract must catch the error and emit AutoPayFailed.
contract MockRevertingERC20 {
    string public name     = "Reverting USDC";
    string public symbol   = "rUSDC";
    uint8  public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ── Mint helpers ────────────────────────────────────────────────────────
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setAllowance(address owner, address spender, uint256 amount) external {
        allowance[owner][spender] = amount;
    }

    // ── ERC-20 surface ──────────────────────────────────────────────────────
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    /// @dev Always reverts — the point of this mock.
    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert("MockRevertingERC20: transferFrom always reverts");
    }
}
