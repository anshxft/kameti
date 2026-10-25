// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Kameti2Base} from "./Kameti2.Base.t.sol";
import {Kameti} from "../Kameti.sol";

// ─────────────────────────────────────────────────────────────────────────────
// §1  Full 4-member circle with bids every round
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2FullCycleTest is Kameti2Base {
    uint256 internal cId;
    // pot per round = contribution * 4
    uint256 internal constant POT = CONTRIBUTION * 4;
    // minStep = pot / 100
    uint256 internal constant MIN_STEP = POT / 100;
    // cap = pot * maxDiscountBps / 10000
    uint256 internal constant CAP = (POT * MAX_DISC_BPS) / 10000;

    function setUp() public override {
        super.setUp();
        cId = _fullActive4(); // creator,alice,bob,carol → Active round 1
    }

    // ── Round 1: alice & bob bid, alice wins ──────────────────────────────────
    function test_FullCycle_Round1_BidderWins_CorrectPayout() public {
        _allPay4(cId);

        // alice bids first valid: discount = minStep (must be > 0 + minStep)
        uint256 aliceBid = MIN_STEP + 1;
        vm.prank(alice);
        kameti.placeBid(cId, aliceBid);

        // bob bids higher
        uint256 bobBid = aliceBid + MIN_STEP;
        vm.prank(bob);
        kameti.placeBid(cId, bobBid);

        // alice outbids bob
        uint256 aliceBid2 = bobBid + MIN_STEP;
        vm.prank(alice);
        kameti.placeBid(cId, aliceBid2);

        _warpPastRound(cId);

        // Expect RoundSettled
        vm.expectEmit(true, false, true, false, address(kameti));
        emit Kameti.RoundSettled(cId, 1, alice, POT, aliceBid2, 0);
        kameti.settleRound(cId);

        // Winner payout = pot - discount - debt(0)
        uint256 expectedPayout = POT - aliceBid2;
        // dividend = discount / (n-1 non-defaulted-others) = aliceBid2 / 3
        uint256 dividendEach   = aliceBid2 / 3;
        uint256 dust           = aliceBid2 - dividendEach * 3;

        assertEq(kameti.claimable(alice),  expectedPayout + dust, "alice claimable");
        assertEq(kameti.claimable(bob),    dividendEach, "bob dividend");
        assertEq(kameti.claimable(carol),  dividendEach, "carol dividend");
        assertEq(kameti.claimable(creator), dividendEach, "creator dividend");
    }

    // ── Round 2: carol bids, wins ──────────────────────────────────────────────
    function test_FullCycle_Round2_Carol_Wins() public {
        // Complete round 1: alice wins via bid
        _allPay4(cId);
        uint256 bid1 = MIN_STEP + 1;
        vm.prank(alice); kameti.placeBid(cId, bid1);
        _warpPastRound(cId);
        kameti.settleRound(cId);

        // Round 2
        _allPay4(cId);
        uint256 bid2 = MIN_STEP + 1;
        vm.prank(carol); kameti.placeBid(cId, bid2);
        _warpPastRound(cId);
        kameti.settleRound(cId);

        // carol won round 2
        Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
        bool carolWon;
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == carol && infos[i].won && infos[i].wonRound == 2) {
                carolWon = true;
            }
        }
        assertTrue(carolWon, "carol should have won round 2");
    }

    // ── Round 3: bob bids ─────────────────────────────────────────────────────
    function test_FullCycle_Round3_Bob_Wins() public {
        // R1: alice wins
        _allPay4(cId);
        vm.prank(alice); kameti.placeBid(cId, MIN_STEP + 1);
        _warpPastRound(cId); kameti.settleRound(cId);

        // R2: carol wins (only carol & bob & creator eligible; carol bids)
        _allPay4(cId);
        vm.prank(carol); kameti.placeBid(cId, MIN_STEP + 1);
        _warpPastRound(cId); kameti.settleRound(cId);

        // R3: bob bids; eligible: creator & bob
        _allPay4(cId);
        vm.prank(bob); kameti.placeBid(cId, MIN_STEP + 1);
        _warpPastRound(cId); kameti.settleRound(cId);

        Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
        bool bobWon;
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == bob && infos[i].won && infos[i].wonRound == 3) bobWon = true;
        }
        assertTrue(bobWon);
    }

    // ── Round 4 (last): no auction, 1 eligible left → CircleCompleted ─────────
    function test_FullCycle_Round4_NoAuction_CircleCompleted() public {
        // R1-R3: alice, carol, bob win via bids
        _allPay4(cId);
        vm.prank(alice); kameti.placeBid(cId, MIN_STEP + 1);
        _warpPastRound(cId); kameti.settleRound(cId);

        _allPay4(cId);
        vm.prank(carol); kameti.placeBid(cId, MIN_STEP + 1);
        _warpPastRound(cId); kameti.settleRound(cId);

        _allPay4(cId);
        vm.prank(bob); kameti.placeBid(cId, MIN_STEP + 1);
        _warpPastRound(cId); kameti.settleRound(cId);

        // R4: only creator left → no auction allowed, settleRound early
        _allPay4(cId);

        // earlySettle: allPaid && eligibleCount<=1
        vm.expectEmit(true, false, false, false, address(kameti));
        emit Kameti.CircleCompleted(cId);
        kameti.settleRound(cId); // should succeed (early settle)

        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(cId);
        assertEq(uint8(status), uint8(Kameti.CircleStatus.Completed));
    }

    // ── After all rounds: total USDC out == total USDC in ─────────────────────
    function test_FullCycle_ConservationOfFunds() public {
        // Track how much each actor spent (deposit + contributions)
        address[4] memory m = _members4();
        uint256[4] memory balBefore;
        for (uint256 i = 0; i < 4; i++) balBefore[i] = usdc.balanceOf(m[i]);

        // R1: alice wins
        _allPay4(cId);
        vm.prank(alice); kameti.placeBid(cId, MIN_STEP + 1);
        _warpPastRound(cId); kameti.settleRound(cId);

        // R2: carol wins
        _allPay4(cId);
        vm.prank(carol); kameti.placeBid(cId, MIN_STEP + 1);
        _warpPastRound(cId); kameti.settleRound(cId);

        // R3: bob wins
        _allPay4(cId);
        vm.prank(bob); kameti.placeBid(cId, MIN_STEP + 1);
        _warpPastRound(cId); kameti.settleRound(cId);

        // R4: creator wins
        _allPay4(cId);
        _warpPastRound(cId); kameti.settleRound(cId);

        // All deposits unlocked by now; withdraw
        uint256 withdrawn = _withdrawAll4();

        uint256 totalIn;
        uint256[4] memory balAfter;
        for (uint256 i = 0; i < 4; i++) {
            balAfter[i] = usdc.balanceOf(m[i]);
        }

        // Net for each actor = balAfter - balBefore + withdrawn (already added to balAfter)
        // Total spent = sum(balBefore - balAfter) must equal totalContributed tracked by contract
        // Simpler: contract balance should be 0 after all withdrawals
        assertEq(usdc.balanceOf(address(kameti)), 0, "contract should hold no funds");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §2  No bids → lowest seat wins at discount 0
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2NoBidsTest is Kameti2Base {
    function test_NoBids_LowestSeatWins_Discount0() public {
        uint256 cId = _fullActive3(); // creator(seat0), alice(seat1), bob(seat2)
        address[3] memory m = [creator, alice, bob];
        _allPay3(cId, m);
        _warpPastRound(cId);

        uint256 pot = CONTRIBUTION * 3;

        vm.expectEmit(true, false, true, true, address(kameti));
        emit Kameti.RoundSettled(cId, 1, creator, pot, 0, 0);
        kameti.settleRound(cId);

        // creator wins full pot
        assertEq(kameti.claimable(creator), pot);
        // others get 0 dividend
        assertEq(kameti.claimable(alice), 0);
        assertEq(kameti.claimable(bob),   0);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §4  Missed payment: deposit slashed, strike, pot full
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2MissedPaymentTest is Kameti2Base {
    function test_MissedPayment_DepositSlashed_StrikeAdded() public {
        // 3-member, depositMul=2: deposit=2*contribution so deposit covers miss
        uint256 cId = _fullActive3(); // creator,alice,bob
        // creator & alice pay; bob doesn't
        vm.prank(creator); kameti.pay(cId);
        vm.prank(alice);   kameti.pay(cId);

        _warpPastRound(cId);

        uint256 bobDepBefore = DEPOSIT; // 2 * CONTRIBUTION

        vm.expectEmit(true, false, true, false, address(kameti));
        emit Kameti.DepositSlashed(cId, 1, bob, CONTRIBUTION, 0);
        kameti.settleRound(cId);

        Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
        uint256 bobDep;
        Kameti.ScoreStats memory bobStats = kameti.statsOf(bob);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == bob) { bobDep = infos[i].depositLeft; }
        }
        assertEq(bobDep, bobDepBefore - CONTRIBUTION, "bob deposit reduced");
        assertEq(bobStats.strikes, 1, "strike added");

        // Pot == 3 * contribution (bob's deposit covers his share)
        Kameti.RoundRecord[] memory hist = kameti.getRoundHistory(cId);
        assertEq(hist[0].pot, CONTRIBUTION * 3, "pot full");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5  Deposit exhausted → debt + defaulted
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2DepositExhaustedTest is Kameti2Base {
    uint256 internal cId;

    function setUp() public override {
        super.setUp();
        // depositMultiplier=1 → deposit == contribution
        cId = _createCircle3(1, 0, 0);
        _join(alice, cId);
        _join(bob,   cId);
    }

    function test_Deposit_Exhausted_DefaultedAndDebt() public {
        // Round 1: creator & alice pay; bob doesn't
        // deposit=contribution → cover=contribution, shortfall=0 → strike (not defaulted)
        vm.prank(creator); kameti.pay(cId);
        vm.prank(alice);   kameti.pay(cId);
        _warpPastRound(cId);
        kameti.settleRound(cId);

        // After R1: bob deposit = 0, stats.strikes = 1
        {
            Kameti.MemberInfo[] memory infosR1 = kameti.getMembers(cId);
            for (uint256 i = 0; i < infosR1.length; i++) {
                if (infosR1[i].addr == bob) {
                    assertEq(infosR1[i].depositLeft, 0, "bob deposit 0 after R1");
                    assertFalse(infosR1[i].defaulted, "bob not defaulted yet");
                }
            }
        }

        // Round 2: creator & alice pay; bob doesn't
        // deposit=0 → cover=0, shortfall=contribution → defaulted, debt+=contribution
        vm.prank(creator); kameti.pay(cId);
        vm.prank(alice);   kameti.pay(cId);
        _warpPastRound(cId);
        kameti.settleRound(cId);

        Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == bob) {
                assertEq(infos[i].debt,   CONTRIBUTION, "bob debt == contribution");
                assertTrue(infos[i].defaulted, "bob defaulted");
            }
        }

        Kameti.ScoreStats memory stats = kameti.statsOf(bob);
        assertEq(stats.defaults, 1, "bob defaults == 1");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §6  Debt deducted from winner payout and shared as dividend
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2DebtWinnerTest is Kameti2Base {
    uint256 internal cId;

    function setUp() public override {
        super.setUp();
        // depositMultiplier=1 so bob defaults after 2 misses
        cId = _createCircle3(1, 0, 0);
        _join(alice, cId);
        _join(bob,   cId); // seats: creator(0), alice(1), bob(2)

        // Round 1: creator & alice pay; bob doesn't → strike (deposit covered)
        vm.prank(creator); kameti.pay(cId);
        vm.prank(alice);   kameti.pay(cId);
        _warpPastRound(cId);
        kameti.settleRound(cId);
        // creator wins round 1 (lowest eligible seat)

        // Round 2: creator & alice pay; bob doesn't → default, debt=contribution
        vm.prank(creator); kameti.pay(cId);
        vm.prank(alice);   kameti.pay(cId);
        _warpPastRound(cId);
        kameti.settleRound(cId);
        // alice wins round 2 (creator already won; bob defaulted)
    }

    function test_Debt_DeductedFromWinnerPayout() public {
        // Round 3: only bob left to win (defaulted fallback), debt=contribution
        vm.prank(creator); kameti.pay(cId);
        vm.prank(alice);   kameti.pay(cId);
        // bob is defaulted — he cannot pay meaningfully, but the round progresses
        // (he also won't pay, further adding shortfall, but deposit is already 0)
        _warpPastRound(cId);

        uint256 pot = CONTRIBUTION * 3; // all 3 pay or slash
        // In R3: creator & alice paid, bob didn't. deposit[bob]=0, shortfall=contribution
        // So pot from payers: 2*contribution + 0 (bob) = 2*contribution? No wait:
        // slash: cover = min(deposit,contribution) = min(0, contribution) = 0
        // pot += 0 from bob, shortfall = contribution → debt += contribution again
        // pot = creator + alice = 2*contribution
        // But let's just verify invariant: winner's claimable = pot_actual - debt_cleared

        uint256 aliceClaimableBefore = kameti.claimable(alice);
        uint256 creatorClaimableBefore = kameti.claimable(creator);

        kameti.settleRound(cId);

        // bob wins (fallback, only non-winner left even if defaulted)
        Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
        uint256 bobDebtAfter;
        bool bobWon;
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == bob) {
                bobDebtAfter = infos[i].debt;
                bobWon = infos[i].won;
            }
        }
        assertTrue(bobWon, "bob wins round 3 as fallback");

        // pot = 2 contributions (creator + alice paid)
        // bob debt going in = CONTRIBUTION (from R2); in R3 bob misses again: +CONTRIBUTION more
        // total bob debt = 2*CONTRIBUTION before payout
        // payout = pot - 0 (no bid)
        // if pot(2*CONTRIBUTION) >= totalDebt(2*CONTRIBUTION) → clearedDebt=2*CONTRIBUTION, payout=0
        // dividendPool = 0(discount) + 2*CONTRIBUTION(clearedDebt)
        // nonDefaultedOthers: creator=won+nonDefaulted counts? creator won in R1 but not defaulted
        // dividend split among non-winner, non-defaulted others
        // Let's check bob's claimable == 0 (payout = pot - debt = 0)
        // bob's deposit is already 0 (exhausted), so no deposit return either
        assertEq(kameti.claimable(bob), 0, "bob gets 0 (all to debt, no deposit)");

        // alice & creator each get dividendEach = clearedDebt / 2
        // clearedDebt = pot = 2*CONTRIBUTION (pot covers full debt)
        // On completion (R3 is last), deposits are also unlocked:
        //   creator.deposit = CONTRIBUTION (depositMul=1, never slashed)
        //   alice.deposit   = CONTRIBUTION (depositMul=1, never slashed)
        uint256 clearedDebt  = 2 * CONTRIBUTION; // pot (2*CONTRIBUTION) covers bob's full debt
        uint256 dividendEach = clearedDebt / 2;  // split between creator & alice
        uint256 depositReturn = CONTRIBUTION;     // depositMul=1, paid all rounds
        assertEq(kameti.claimable(alice),
            aliceClaimableBefore + dividendEach + depositReturn,
            "alice: dividend + deposit return");
        assertEq(kameti.claimable(creator),
            creatorClaimableBefore + dividendEach + depositReturn,
            "creator: dividend + deposit return");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §11 settleRound timing guards
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2SettleTimingTest is Kameti2Base {
    uint256 internal cId;

    function setUp() public override {
        super.setUp();
        cId = _fullActive3();
    }

    function test_Settle_Revert_BeforeDeadline_NotAllPaid() public {
        // no one paid, deadline not passed
        vm.expectRevert(Kameti.RoundNotSettleable.selector);
        kameti.settleRound(cId);
    }

    function test_Settle_Early_AllPaid_OneEligible() public {
        // 3-member circle, settle 2 rounds first to leave 1 eligible
        address[3] memory m = [creator, alice, bob];

        // R1: all pay, settle
        _allPay3(cId, m);
        _warpPastRound(cId);
        kameti.settleRound(cId); // creator wins

        // R2: all pay, settle
        _allPay3(cId, m);
        _warpPastRound(cId);
        kameti.settleRound(cId); // alice wins

        // R3: all pay → only bob eligible (1 eligible) → earlySettle
        _allPay3(cId, m);
        // don't warp — early settle since allPaid && eligible==1
        kameti.settleRound(cId); // should succeed
        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(cId);
        assertEq(uint8(status), uint8(Kameti.CircleStatus.Completed));
    }

    function test_Settle_Revert_DoubleSettle() public {
        address[3] memory m = [creator, alice, bob];
        _allPay3(cId, m);
        _warpPastRound(cId);
        kameti.settleRound(cId);

        // After last round of a 3-member circle, circle is still Active on R2.
        // Second settle: no one paid → RoundNotSettleable or deadline not passed
        vm.expectRevert(Kameti.RoundNotSettleable.selector);
        kameti.settleRound(cId);
    }

    function test_Settle_Revert_CircleNotActive() public {
        // Completed circle
        address[3] memory m = [creator, alice, bob];
        for (uint8 r = 0; r < 3; r++) {
            _allPay3(cId, m);
            _warpPastRound(cId);
            kameti.settleRound(cId);
        }
        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(cId);
        assertEq(uint8(status), uint8(Kameti.CircleStatus.Completed));

        vm.expectRevert(Kameti.CircleNotActive.selector);
        kameti.settleRound(cId);
    }
}
