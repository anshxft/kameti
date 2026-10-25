// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Kameti} from "../Kameti.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Shared base for all Kameti v2 tests.
abstract contract Kameti2Base is Test {
    // ── actors ────────────────────────────────────────────────────────────────
    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal carol   = makeAddr("carol");
    address internal dave    = makeAddr("dave");
    address internal creator = makeAddr("creator");

    // ── token & contract ─────────────────────────────────────────────────────
    MockERC20 internal usdc;
    Kameti    internal kameti;

    // ── constants ─────────────────────────────────────────────────────────────
    uint256 internal constant e6           = 1_000_000;
    uint256 internal constant CONTRIBUTION = 10 * e6;   // 10 USDC
    uint8   internal constant MAX_MEMBERS  = 4;
    uint256 internal constant ROUND_DUR    = 1 days;
    uint8   internal constant DEPOSIT_MUL  = 2;
    uint16  internal constant MAX_DISC_BPS = 3000;       // 30%
    uint16  internal constant MIN_SCORE    = 0;
    string  internal constant CIRCLE_NAME  = "Test Circle";
    uint256 internal constant INITIAL_BAL  = 10_000 * e6;

    // deposit = contribution * depositMultiplier
    uint256 internal constant DEPOSIT = CONTRIBUTION * DEPOSIT_MUL;

    // ── setUp ─────────────────────────────────────────────────────────────────
    function setUp() public virtual {
        usdc   = new MockERC20("Mock USDC", "mUSDC", 6);
        kameti = new Kameti(address(usdc));

        address[5] memory actors = [alice, bob, carol, dave, creator];
        for (uint256 i = 0; i < actors.length; i++) {
            usdc.mint(actors[i], INITIAL_BAL);
            vm.prank(actors[i]);
            usdc.approve(address(kameti), type(uint256).max);
        }
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// @dev Create a 4-member circle with default params; creator pays deposit.
    function _createCircle4() internal returns (uint256 id) {
        vm.prank(creator);
        id = kameti.createCircle(
            CIRCLE_NAME,
            CONTRIBUTION,
            MAX_MEMBERS,
            ROUND_DUR,
            DEPOSIT_MUL,
            MAX_DISC_BPS,
            MIN_SCORE
        );
    }

    /// @dev Create a 3-member circle with given params.
    function _createCircle3(
        uint8  depositMul,
        uint16 maxDiscBps,
        uint16 minScore
    ) internal returns (uint256 id) {
        vm.prank(creator);
        id = kameti.createCircle(
            CIRCLE_NAME,
            CONTRIBUTION,
            3,
            ROUND_DUR,
            depositMul,
            maxDiscBps,
            minScore
        );
    }

    /// @dev Have `who` join `id` (deposit pre-approved via setUp).
    function _join(address who, uint256 id) internal {
        vm.prank(who);
        kameti.join(id);
    }

    /// @dev All 4 members pay for round; members = [creator, alice, bob, carol].
    function _allPay4(uint256 id) internal {
        address[4] memory m = [creator, alice, bob, carol];
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(m[i]);
            kameti.pay(id);
        }
    }

    /// @dev All 3 members pay for a 3-member circle.
    function _allPay3(uint256 id, address[3] memory members) internal {
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(members[i]);
            kameti.pay(id);
        }
    }

    /// @dev Build a fully-active 4-member circle (creator,alice,bob,carol).
    function _fullActive4() internal returns (uint256 id) {
        id = _createCircle4();
        _join(alice,  id);
        _join(bob,    id);
        _join(carol,  id);
        // Circle is now Active (4/4 joined)
    }

    /// @dev Build a fully-active 3-member circle (creator,alice,bob).
    function _fullActive3() internal returns (uint256 id) {
        id = _createCircle3(DEPOSIT_MUL, MAX_DISC_BPS, MIN_SCORE);
        _join(alice, id);
        _join(bob,   id);
    }

    /// @dev Warp past the current roundEnd for circle `id`.
    function _warpPastRound(uint256 id) internal {
        (, , , uint256 roundEnd, , ,) = kameti.getCircle(id);
        vm.warp(roundEnd + 1);
    }

    /// @dev Members array for 4-member circle.
    function _members4() internal view returns (address[4] memory) {
        return [creator, alice, bob, carol];
    }

    /// @dev Sum claimable for all members of a 4-member circle.
    function _totalClaimable4() internal view returns (uint256 total) {
        address[4] memory m = _members4();
        for (uint256 i = 0; i < 4; i++) {
            total += kameti.claimable(m[i]);
        }
    }

    /// @dev Withdraw for all members and return total withdrawn.
    function _withdrawAll4() internal returns (uint256 total) {
        address[4] memory m = _members4();
        for (uint256 i = 0; i < 4; i++) {
            uint256 c = kameti.claimable(m[i]);
            if (c > 0) {
                uint256 before = usdc.balanceOf(m[i]);
                vm.prank(m[i]);
                kameti.withdraw();
                total += usdc.balanceOf(m[i]) - before;
            }
        }
    }
}
