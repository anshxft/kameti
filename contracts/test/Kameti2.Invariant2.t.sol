// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, StdInvariant} from "forge-std/Test.sol";
import {Kameti} from "../Kameti.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// §19  Extended invariant: same conservation law, richer action set
//
//  Actions added over §15:
//   • placeBid   — random discount in [1, cap]; skips silently on any revert
//   • payAllAutoPay — some members have 0 allowance, some have max allowance
//   • setAutoPay — randomly toggle autopay for a random member
//
//  Invariant (unchanged):
//   usdc.balanceOf(kameti) == sumDeposits + potAccumulated + sumClaimable
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Handler that drives a 3-member circle with the extended action set.
contract KametiHandler2 is StdInvariant, Test {

    // ── immutables ────────────────────────────────────────────────────────────
    MockERC20 public immutable usdc;
    Kameti    public immutable kameti;

    address public immutable creator_;
    address public immutable alice_;
    address public immutable bob_;

    uint256 public immutable circleId;

    // ── mutable state ─────────────────────────────────────────────────────────
    bool    public circleCompleted;
    address[] public allAddresses;

    // Track which members currently have full (max) allowance vs zero.
    // Index 0=creator_, 1=alice_, 2=bob_.
    bool[3] internal _hasAllowance;

    // ── constants ─────────────────────────────────────────────────────────────
    uint256 internal constant CONTRIBUTION_ = 10e6;
    uint256 internal constant ROUND_DUR_    = 1 days;
    uint16  internal constant MAX_DISC_BPS_ = 3000;  // 30 %
    uint256 internal constant N             = 3;

    // ─────────────────────────────────────────────────────────────────────────
    constructor(MockERC20 _usdc, Kameti _kameti) {
        usdc   = _usdc;
        kameti = _kameti;

        creator_ = makeAddr("creator2");
        alice_   = makeAddr("alice2");
        bob_     = makeAddr("bob2");

        allAddresses.push(creator_);
        allAddresses.push(alice_);
        allAddresses.push(bob_);

        // Fund all three actors generously
        _usdc.mint(creator_, 500_000e6);
        _usdc.mint(alice_,   500_000e6);
        _usdc.mint(bob_,     500_000e6);

        // Grant max allowance to start with
        vm.prank(creator_); _usdc.approve(address(_kameti), type(uint256).max);
        vm.prank(alice_);   _usdc.approve(address(_kameti), type(uint256).max);
        vm.prank(bob_);     _usdc.approve(address(_kameti), type(uint256).max);
        _hasAllowance[0] = true;
        _hasAllowance[1] = true;
        _hasAllowance[2] = true;

        // Create & fill a 3-member circle (depositMul=1, maxDiscountBps=3000)
        vm.prank(creator_);
        circleId = _kameti.createCircle(
            "inv2", CONTRIBUTION_, 3, ROUND_DUR_, 1, MAX_DISC_BPS_, 0
        );
        vm.prank(alice_); _kameti.join(circleId);
        vm.prank(bob_);   _kameti.join(circleId);
        // Circle is Active now (3/3 joined)
    }

    // ── internal helpers ──────────────────────────────────────────────────────

    function _member(uint8 idx) internal view returns (address) {
        uint8 i = idx % uint8(N);
        if (i == 0) return creator_;
        if (i == 1) return alice_;
        return bob_;
    }

    function _memberIdx(address m) internal view returns (uint8) {
        if (m == creator_) return 0;
        if (m == alice_)   return 1;
        return 2;
    }

    // ── action: pay ───────────────────────────────────────────────────────────

    function pay(uint8 who) external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, , uint256 roundEnd, , ,) = kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;
        if (block.timestamp >= roundEnd) return;       // round ended, skip

        address m = _member(who);
        Kameti.MemberInfo[] memory infos = kameti.getMembers(circleId);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == m && infos[i].paidThisRound) return;
        }

        // Ensure allowance exists before paying
        uint8 idx = _memberIdx(m);
        if (!_hasAllowance[idx]) {
            vm.prank(m);
            usdc.approve(address(kameti), type(uint256).max);
            _hasAllowance[idx] = true;
        }

        vm.prank(m);
        try kameti.pay(circleId) {} catch {}
    }

    // ── action: settle ────────────────────────────────────────────────────────

    function settle() external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;
        try kameti.settleRound(circleId) {
            (, Kameti.CircleStatus s2, , , , ,) = kameti.getCircle(circleId);
            if (s2 == Kameti.CircleStatus.Completed) circleCompleted = true;
        } catch {}
    }

    // ── action: warpTime ──────────────────────────────────────────────────────

    function warpTime(uint256 secs) external {
        secs = bound(secs, 0, 2 days);
        vm.warp(block.timestamp + secs);
    }

    // ── action: doWithdraw ────────────────────────────────────────────────────

    function doWithdraw(uint8 who) external {
        address m = _member(who);
        if (kameti.claimable(m) == 0) return;
        vm.prank(m);
        try kameti.withdraw() {} catch {}
    }

    // ── action: placeBid — NEW ────────────────────────────────────────────────
    /// @dev Pick a random member and a random discount in [1, cap].
    ///      Skip silently on any revert (e.g. member not paid, deadline passed,
    ///      only one eligible, discount ≤ minStep, etc.).
    function placeBid(uint8 who, uint256 discountSeed) external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, , uint256 roundEnd, , ,) = kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;
        if (block.timestamp >= roundEnd) return;

        uint256 pot = CONTRIBUTION_ * N;
        uint256 cap = (pot * MAX_DISC_BPS_) / 10000;
        if (cap == 0) return;

        uint256 discount = bound(discountSeed, 1, cap);
        address m = _member(who);

        vm.prank(m);
        try kameti.placeBid(circleId, discount) {} catch {}
    }

    // ── action: payAllAutoPay — NEW ───────────────────────────────────────────
    /// @dev Before calling payAllAutoPay, randomly split the three members into
    ///      two groups by toggling allowances based on `allowanceMask`:
    ///        bit 0 → creator_, bit 1 → alice_, bit 2 → bob_.
    ///      Members whose bit is SET get max allowance; others get zero.
    ///      After the call, restore everyone to max allowance so future pay()
    ///      actions still work.
    function payAllAutoPay(uint8 allowanceMask) external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;

        address[3] memory members = [creator_, alice_, bob_];

        // Set mixed allowances
        for (uint8 i = 0; i < 3; i++) {
            bool giveAllowance = ((allowanceMask >> i) & 1) == 1;
            uint256 newAllowance = giveAllowance ? type(uint256).max : 0;
            vm.prank(members[i]);
            usdc.approve(address(kameti), newAllowance);
            _hasAllowance[i] = giveAllowance;
        }

        // Call payAllAutoPay — must not revert (either skips past roundEnd or
        // processes the queue silently failing members with 0 allowance)
        try kameti.payAllAutoPay(circleId) {} catch {}

        // Restore all allowances to max so other actions keep working
        for (uint8 i = 0; i < 3; i++) {
            if (!_hasAllowance[i]) {
                vm.prank(members[i]);
                usdc.approve(address(kameti), type(uint256).max);
                _hasAllowance[i] = true;
            }
        }
    }

    // ── action: setAutoPay — NEW ──────────────────────────────────────────────
    /// @dev Randomly toggle autopay for a random member.
    function setAutoPay(uint8 who, bool enabled) external {
        if (circleCompleted) return;
        address m = _member(who);
        vm.prank(m);
        try kameti.setAutoPay(circleId, enabled) {} catch {}
    }

    // ── accounting helpers ────────────────────────────────────────────────────

    function sumDeposits() external view returns (uint256 total) {
        Kameti.MemberInfo[] memory infos = kameti.getMembers(circleId);
        for (uint256 i = 0; i < infos.length; i++) {
            total += infos[i].depositLeft;
        }
    }

    function sumClaimable() external view returns (uint256 total) {
        for (uint256 i = 0; i < allAddresses.length; i++) {
            total += kameti.claimable(allAddresses[i]);
        }
    }

    function potAccumulated() external view returns (uint256) {
        (, , , , uint256 pot, ,) = kameti.getCircle(circleId);
        return pot;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant test contract
// ─────────────────────────────────────────────────────────────────────────────
contract KametiInvariantTest2 is Test {
    KametiHandler2 internal handler;
    MockERC20      internal usdc;
    Kameti         internal kameti;

    function setUp() public {
        usdc    = new MockERC20("Mock USDC", "mUSDC", 6);
        kameti  = new Kameti(address(usdc));
        handler = new KametiHandler2(usdc, kameti);

        targetContract(address(handler));
    }

    /// @dev Contract USDC balance == locked deposits + pot accumulated + claimable.
    function invariant_ContractBalance_EqDeposits_PlusClaimable() public view {
        uint256 contractBal    = usdc.balanceOf(address(kameti));
        uint256 sumDeposits    = handler.sumDeposits();
        uint256 sumClaimable   = handler.sumClaimable();
        uint256 potAccumulated = handler.potAccumulated();
        assertEq(
            contractBal,
            sumDeposits + potAccumulated + sumClaimable,
            "invariant2: balance == deposits + pot + claimable"
        );
    }
}
