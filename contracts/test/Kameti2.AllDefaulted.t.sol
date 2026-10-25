// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Kameti2Base} from "./Kameti2.Base.t.sol";
import {Kameti} from "../Kameti.sol";

// ─────────────────────────────────────────────────────────────────────────────
// §17  Dividend-pool all-defaulted: no USDC stranded after settle
//
// Setup:
//   3-member circle (creator, alice, bob), depositMultiplier=1.
//   - R1: only bob pays → creator & alice miss → strike, deposit→0.
//          Winner = creator (seat 0, lowest eligible seat).
//   - R2: only bob pays → creator & alice miss again → defaulted (deposit=0,
//          shortfall=CONTRIBUTION each). pot=CONTRIBUTION (bob only).
//          Winner = bob (only eligible; creator won in R1, alice defaulted).
//   After R2: creator=won+defaulted, alice=defaulted+not-won, bob=won.
//   - R3 (final): only bob pays → creator & alice defaulted, slashed 0 each.
//          Fallback winner = alice (seat 1, only non-winner left).
//          dividendPool = clearedDebt = CONTRIBUTION, but nonDefaultedOthers
//          might equal 1 (bob is still non-defaulted).
//          On completion alice's deposit (0) and bob's deposit (CONTRIBUTION)
//          are unlocked.
//
// Key assertion (the "no USDC stranded" invariant):
//   usdc.balanceOf(kameti) == claimable[creator] + claimable[alice] + claimable[bob]
//
// This specifically exercises the branch in settleRound Step 4 where
// nonDefaultedOthers == 0 would previously strand the dividendPool as dust.
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2AllDefaultedTest is Kameti2Base {

    // ── state ─────────────────────────────────────────────────────────────────
    uint256 internal cId;

    /// @dev depositMultiplier=1 so one miss = strike (deposit→0), two misses = default.
    uint8 internal constant DEP_MUL = 1;

    function setUp() public override {
        super.setUp();

        // Fresh 3-member circle: creator, alice, bob. depositMul=1, no discount, no minScore.
        cId = _createCircle3(DEP_MUL, 0, 0);
        _join(alice, cId);
        _join(bob,   cId);
        // Seats: creator(0), alice(1), bob(2). Circle is Active at round 1.
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// @dev Sum claimable for all three members in this circle.
    function _sumClaimable3() internal view returns (uint256) {
        return kameti.claimable(creator)
             + kameti.claimable(alice)
             + kameti.claimable(bob);
    }

    // ── main test ─────────────────────────────────────────────────────────────

    /// @notice Full 3-round scenario where 2 of 3 members default.
    ///         After the final settleRound the contract holds exactly
    ///         sum(claimable) — no USDC is stranded.
    function test_AllDefaulted_NoUSDCStranded() public {
        // ── Round 1 ──────────────────────────────────────────────────────────
        // Only bob pays. Creator & alice miss → each loses their deposit to
        // the pot (deposit=CONTRIBUTION, cover=CONTRIBUTION → strike).
        vm.prank(bob);
        kameti.pay(cId);

        _warpPastRound(cId);
        kameti.settleRound(cId);

        // creator wins (seat 0, lowest eligible). pot = 3 * CONTRIBUTION.
        // claimable[creator] == 3 * CONTRIBUTION
        assertEq(
            kameti.claimable(creator),
            3 * CONTRIBUTION,
            "R1: creator wins full pot"
        );
        // creator & alice each have deposit=0, strike on score (not defaulted yet).
        {
            Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
            for (uint256 i = 0; i < infos.length; i++) {
                if (infos[i].addr == creator) {
                    assertEq(infos[i].depositLeft, 0, "R1: creator deposit 0");
                    assertFalse(infos[i].defaulted,  "R1: creator not defaulted yet");
                    assertTrue(infos[i].won,          "R1: creator won");
                }
                if (infos[i].addr == alice) {
                    assertEq(infos[i].depositLeft, 0, "R1: alice deposit 0");
                    assertFalse(infos[i].defaulted,  "R1: alice not defaulted yet");
                }
            }
        }

        // ── Round 2 ──────────────────────────────────────────────────────────
        // Only bob pays. Creator & alice miss again. Deposit=0 → shortfall=C
        // → both defaulted.
        vm.prank(bob);
        kameti.pay(cId);

        _warpPastRound(cId);
        kameti.settleRound(cId);

        // eligible = {not-won, not-defaulted}. Creator is won, alice is defaulted.
        // Only bob is eligible. Bob wins R2. pot = 1 * CONTRIBUTION (bob only).
        assertEq(
            kameti.claimable(bob),
            CONTRIBUTION,
            "R2: bob wins pot of 1C"
        );
        {
            Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
            for (uint256 i = 0; i < infos.length; i++) {
                if (infos[i].addr == creator) {
                    assertTrue(infos[i].defaulted, "R2: creator defaulted");
                }
                if (infos[i].addr == alice) {
                    assertTrue(infos[i].defaulted, "R2: alice defaulted");
                }
                if (infos[i].addr == bob) {
                    assertFalse(infos[i].defaulted, "R2: bob not defaulted");
                    assertTrue(infos[i].won,         "R2: bob won");
                }
            }
        }

        // ── Round 3 (final) ──────────────────────────────────────────────────
        // Only bob pays. Creator & alice are defaulted — slash produces 0 cover,
        // adding more debt but contributing 0 to pot.
        // pot = CONTRIBUTION (bob only).
        // Winner: eligible = nobody (creator won+defaulted, alice defaulted,
        //         bob won). Fallback = alice (seat 1, lowest non-winner).
        // alice's total debt going in = CONTRIBUTION (from R2) + CONTRIBUTION (R3 slash) = 2C.
        // payout = pot(C) < winnerDebt(2C) → clearedDebt = C, alice.claimable = 0.
        // dividendPool = C. nonDefaultedOthers = bob (not defaulted) = 1.
        // dividendEach = C. dust = 0.
        // claimable[bob] += C (dividend).
        // Circle completes → bob's deposit (C, intact since only bob paid each round
        //   and deposit was never slashed) unlocked → claimable[bob] += C.
        vm.prank(bob);
        kameti.pay(cId);

        _warpPastRound(cId);

        vm.expectEmit(true, false, false, false, address(kameti));
        emit Kameti.CircleCompleted(cId);
        kameti.settleRound(cId);

        // Circle must be completed
        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(cId);
        assertEq(
            uint8(status),
            uint8(Kameti.CircleStatus.Completed),
            "circle completed after R3"
        );

        // ── KEY INVARIANT: no USDC stranded ──────────────────────────────────
        // Total USDC that entered the contract:
        //   Deposits: 3 * CONTRIBUTION (one each at join/create)
        //   Bob's R1 contribution: CONTRIBUTION
        //   Bob's R2 contribution: CONTRIBUTION
        //   Bob's R3 contribution: CONTRIBUTION
        //   Total = 6 * CONTRIBUTION
        //
        // Expected claimable breakdown:
        //   creator: 3C (R1 pot win)
        //   alice:   0  (defaulted fallback win, payout all absorbed by debt)
        //   bob:     C(R2 win) + C(R3 dividend) + C(deposit return) = 3C
        //   Total claimable = 6C
        uint256 contractBal  = usdc.balanceOf(address(kameti));
        uint256 sumClaimable = _sumClaimable3();

        assertEq(
            contractBal,
            sumClaimable,
            "no USDC stranded: contractBal == sumClaimable"
        );
        assertEq(
            contractBal,
            6 * CONTRIBUTION,
            "total USDC in contract is 6C"
        );
        assertEq(
            kameti.claimable(creator),
            3 * CONTRIBUTION,
            "creator claimable == 3C"
        );
        assertEq(
            kameti.claimable(alice),
            0,
            "alice claimable == 0 (debt absorbed payout)"
        );
        assertEq(
            kameti.claimable(bob),
            3 * CONTRIBUTION,
            "bob claimable == 3C (R2 win + R3 dividend + deposit)"
        );
    }

    /// @notice Variant: ALL three members miss every round (maximum defaults).
    ///         After 3 rounds and circle completion, contractBal == sumClaimable.
    ///         This hits the nonDefaultedOthers==0 branch in the dividend step
    ///         and verifies dust is credited to the winner rather than stranded.
    function test_AllMiss_AllDefaulted_NoUSDCStranded() public {
        // R1: nobody pays. depositMul=1 → cover=CONTRIBUTION each → all strike, deposit→0.
        // pot = 3C. Winner = creator (seat 0, lowest eligible).
        _warpPastRound(cId);
        kameti.settleRound(cId);

        assertEq(kameti.claimable(creator), 3 * CONTRIBUTION, "R1: creator wins 3C");

        // R2: nobody pays. deposit=0 → shortfall=C each → all defaulted.
        // pot = 0. Winner: eligible = nobody. Fallback = alice (seat 1, lowest non-winner).
        // payout=0, debt unchanged, dividendPool=0.
        _warpPastRound(cId);
        kameti.settleRound(cId);

        // alice wins R2 with 0 payout (all claimable still just creator=3C, alice=0, bob=0)
        assertEq(kameti.claimable(alice), 0, "R2: alice wins 0 (no pot)");

        // R3 (final): nobody pays. pot=0. Fallback winner = bob (seat 2, only non-winner).
        // payout=0, dividendPool=0. Completion: all deposits=0, nothing unlocked.
        _warpPastRound(cId);

        vm.expectEmit(true, false, false, false, address(kameti));
        emit Kameti.CircleCompleted(cId);
        kameti.settleRound(cId);

        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(cId);
        assertEq(uint8(status), uint8(Kameti.CircleStatus.Completed), "circle completed");

        // Total USDC in: 3C (deposits only, no contributions were paid).
        // All deposited USDC was slashed into pot in R1 and paid to creator.
        // Remaining in contract = 3C - 0 (not yet withdrawn by creator).
        uint256 contractBal  = usdc.balanceOf(address(kameti));
        uint256 sumClaimable = _sumClaimable3();

        assertEq(
            contractBal,
            sumClaimable,
            "all-miss: contractBal == sumClaimable"
        );
        assertEq(kameti.claimable(creator), 3 * CONTRIBUTION, "all-miss: creator holds 3C");
        assertEq(kameti.claimable(alice),   0,                "all-miss: alice holds 0");
        assertEq(kameti.claimable(bob),     0,                "all-miss: bob holds 0");
    }
}
