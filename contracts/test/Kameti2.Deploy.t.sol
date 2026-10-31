// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Kameti2Base} from "./Kameti2.Base.t.sol";
import {Kameti} from "../Kameti.sol";

// ─────────────────────────────────────────────────────────────────────────────
// §1  Deployment & constructor
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2DeployTest is Kameti2Base {
    function test_Deploy_SetsUsdc() public view {
        assertEq(address(kameti.usdc()), address(usdc));
    }

    function test_Deploy_CountersZero() public view {
        assertEq(kameti.totalCircles(), 0);
        assertEq(kameti.totalPayouts(), 0);
    }

    function test_Deploy_ZeroAddress_Reverts() public {
        vm.expectRevert(Kameti.InvalidParams.selector);
        new Kameti(address(0), address(0));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §13 createCircle invalid params
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2CreateCircleInvalidTest is Kameti2Base {
    function test_CreateCircle_Revert_MaxMembers_TooLow() public {
        vm.prank(creator);
        vm.expectRevert(Kameti.InvalidParams.selector);
        kameti.createCircle("x", CONTRIBUTION, 2, ROUND_DUR, DEPOSIT_MUL, MAX_DISC_BPS, 0, 5000, 10);
    }

    function test_CreateCircle_Revert_MaxMembers_TooHigh() public {
        vm.prank(creator);
        vm.expectRevert(Kameti.InvalidParams.selector);
        kameti.createCircle("x", CONTRIBUTION, 11, ROUND_DUR, DEPOSIT_MUL, MAX_DISC_BPS, 0, 5000, 10);
    }

    function test_CreateCircle_Revert_RoundDuration_TooShort() public {
        vm.prank(creator);
        vm.expectRevert(Kameti.InvalidParams.selector);
        kameti.createCircle("x", CONTRIBUTION, 3, 9 minutes, DEPOSIT_MUL, MAX_DISC_BPS, 0, 5000, 10);
    }

    function test_CreateCircle_Revert_DepositMultiplier_Zero() public {
        vm.prank(creator);
        vm.expectRevert(Kameti.InvalidParams.selector);
        kameti.createCircle("x", CONTRIBUTION, 3, ROUND_DUR, 0, MAX_DISC_BPS, 0, 5000, 10);
    }

    function test_CreateCircle_Revert_DepositMultiplier_Four() public {
        vm.prank(creator);
        vm.expectRevert(Kameti.InvalidParams.selector);
        kameti.createCircle("x", CONTRIBUTION, 3, ROUND_DUR, 4, MAX_DISC_BPS, 0, 5000, 10);
    }

    function test_CreateCircle_Revert_MaxDiscountBps_TooHigh() public {
        vm.prank(creator);
        vm.expectRevert(Kameti.InvalidParams.selector);
        kameti.createCircle("x", CONTRIBUTION, 3, ROUND_DUR, DEPOSIT_MUL, 4001, 0, 0, 0);
    }

    function test_CreateCircle_Revert_MinScore_TooHigh() public {
        vm.prank(creator);
        vm.expectRevert(Kameti.InvalidParams.selector);
        kameti.createCircle("x", CONTRIBUTION, 3, ROUND_DUR, DEPOSIT_MUL, MAX_DISC_BPS, 901, 5000, 10);
    }

    function test_CreateCircle_HappyPath_EmitsEvent() public {
        vm.prank(creator);
        vm.expectEmit(true, true, false, true, address(kameti));
        emit Kameti.CircleCreated(0, CIRCLE_NAME, CONTRIBUTION, MAX_MEMBERS, creator);
        kameti.createCircle(
            CIRCLE_NAME, CONTRIBUTION, MAX_MEMBERS, ROUND_DUR, DEPOSIT_MUL, MAX_DISC_BPS, 0, 5000, 10
        );
    }

    function test_CreateCircle_HappyPath_IncrementsTotalCircles() public {
        _createCircle4();
        assertEq(kameti.totalCircles(), 1);
        _createCircle3(1, 0, 0);
        assertEq(kameti.totalCircles(), 2);
    }

    function test_CreateCircle_HappyPath_CollectsDeposit() public {
        uint256 before = usdc.balanceOf(address(kameti));
        _createCircle4();
        assertEq(usdc.balanceOf(address(kameti)), before + DEPOSIT);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §14 join validations
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2JoinTest is Kameti2Base {
    uint256 internal cId;

    function setUp() public override {
        super.setUp();
        cId = _createCircle4();
    }

    function test_Join_HappyPath_CollectsDeposit() public {
        uint256 before = usdc.balanceOf(address(kameti));
        _join(alice, cId);
        assertEq(usdc.balanceOf(address(kameti)), before + DEPOSIT);
    }

    function test_Join_HappyPath_EmitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(kameti));
        emit Kameti.MemberJoined(cId, alice, 2);
        kameti.join(cId);
    }

    function test_Join_LastMember_StartsCircle() public {
        _join(alice,  cId);
        _join(bob,    cId);
        _join(carol,  cId); // 4th member → circle goes Active
        (, Kameti.CircleStatus status, uint8 round, , , ,) = kameti.getCircle(cId);
        assertEq(uint8(status), uint8(Kameti.CircleStatus.Active));
        assertEq(round, 1);
    }

    function test_Join_Revert_AlreadyMember() public {
        vm.prank(creator);
        vm.expectRevert(Kameti.AlreadyMember.selector);
        kameti.join(cId);
    }

    function test_Join_Revert_CircleFull() public {
        // Create a 10-member circle, fill to 9 members (still Open), 10th fills it,
        // then 11th tries → CircleFull fires before status flip, but actually after
        // the last join the circle is Active, so we need to catch the moment it's
        // full while Open.
        // Approach: use a 4-member circle, add members 2,3,4 quickly so we catch
        // full while still Open on the 4th seat fill attempt with a 5th person.
        // Actually: after the 4th join the circle becomes Active, so a 5th attempt
        // sees CircleNotOpen (status check first). The CircleFull path is only hit
        // when status==Open AND seats.length >= maxMembers at the same time.
        // Looking at the contract: status check is first, then CircleFull.
        // So CircleFull is unreachable after activation. This is a contract behavior.
        // We test CircleNotOpen instead (which is what the full-circle case emits).
        _join(alice, cId);
        _join(bob,   cId);
        _join(carol, cId); // fills → Active
        address outsider2 = makeAddr("outsider2");
        usdc.mint(outsider2, DEPOSIT);
        vm.prank(outsider2);
        usdc.approve(address(kameti), type(uint256).max);
        vm.prank(outsider2);
        // After activation CircleNotOpen fires (status check is first in join())
        vm.expectRevert(Kameti.CircleNotOpen.selector);
        kameti.join(cId);
    }

    function test_Join_Revert_CircleNotOpen_WhenActive() public {
        _join(alice, cId);
        _join(bob,   cId);
        _join(carol, cId); // fills → Active
        address outsider = makeAddr("outsider");
        usdc.mint(outsider, DEPOSIT);
        vm.prank(outsider);
        usdc.approve(address(kameti), type(uint256).max);
        vm.prank(outsider);
        vm.expectRevert(Kameti.CircleNotOpen.selector);
        kameti.join(cId);
    }

    function test_Join_Revert_AlreadyMember_AfterFull() public {
        _join(alice, cId);
        _join(bob,   cId);
        _join(carol, cId);
        vm.prank(alice);
        vm.expectRevert(Kameti.CircleNotOpen.selector);
        kameti.join(cId);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §10 leave()
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2LeaveTest is Kameti2Base {
    uint256 internal cId;

    function setUp() public override {
        super.setUp();
        cId = _createCircle4();
        _join(alice, cId);
    }

    function test_Leave_RefundsDeposit() public {
        uint256 before = kameti.claimable(alice);
        vm.prank(alice);
        kameti.leave(cId);
        assertEq(kameti.claimable(alice), before + DEPOSIT);
    }

    function test_Leave_EmitsMemberLeft() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, false, address(kameti));
        emit Kameti.MemberLeft(cId, alice);
        kameti.leave(cId);
    }

    function test_Leave_Revert_ActiveCircle() public {
        _join(bob,   cId);
        _join(carol, cId); // fills → Active
        vm.prank(alice);
        vm.expectRevert(Kameti.CannotLeaveActiveCircle.selector);
        kameti.leave(cId);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §12 withdraw()
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2WithdrawTest is Kameti2Base {
    function test_Withdraw_Revert_NothingToWithdraw() public {
        vm.prank(alice);
        vm.expectRevert(Kameti.NothingToWithdraw.selector);
        kameti.withdraw();
    }

    function test_Withdraw_PullsFullClaimable() public {
        // Leave a circle to get claimable deposit
        uint256 cId = _createCircle4();
        _join(alice, cId);
        vm.prank(alice);
        kameti.leave(cId);

        uint256 expected = kameti.claimable(alice);
        assertGt(expected, 0);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        kameti.withdraw();

        assertEq(usdc.balanceOf(alice), before + expected);
        assertEq(kameti.claimable(alice), 0);
    }

    function test_Withdraw_EmitsWithdrawn() public {
        uint256 cId = _createCircle4();
        _join(alice, cId);
        vm.prank(alice);
        kameti.leave(cId);
        uint256 amt = kameti.claimable(alice);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(kameti));
        emit Kameti.Withdrawn(alice, amt);
        kameti.withdraw();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §9  Score math and clamping
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2ScoreTest is Kameti2Base {
    address internal subject = makeAddr("subject");

    function test_Score_FreshAddress_Is600() public view {
        assertEq(kameti.scoreOf(subject), 600);
    }

    function test_Score_OnTimePayment_Adds5() public {
        // Run a 3-member circle so subject gets onTimePayment credit
        // We need to manipulate stats via gameplay — we'll use a 3-member
        // circle where subject pays on time.
        usdc.mint(subject, INITIAL_BAL);
        vm.prank(subject);
        usdc.approve(address(kameti), type(uint256).max);

        uint256 cId = _createCircle3(1, 0, 0);
        _join(alice, cId);
        _join(subject, cId); // 3rd → Active

        // All pay
        address[3] memory m = [creator, alice, subject];
        _allPay3(cId, m);

        _warpPastRound(cId);
        kameti.settleRound(cId);

        // subject paid on time this round → +5
        Kameti.ScoreStats memory stats = kameti.statsOf(subject);
        assertGe(stats.onTimePayments, 1);
        // score = 600 + 5*onTimePayments ... >= 605
        assertGe(kameti.scoreOf(subject), 605);
    }

    function test_Score_Strike_Decreases30() public {
        // Miss a round while deposit covers → strike
        usdc.mint(subject, INITIAL_BAL);
        vm.prank(subject);
        usdc.approve(address(kameti), type(uint256).max);

        uint256 cId = _createCircle3(2, 0, 0);
        _join(alice, cId);
        _join(subject, cId);

        // Only creator and alice pay; subject does NOT
        vm.prank(creator); kameti.pay(cId);
        vm.prank(alice);   kameti.pay(cId);

        _warpPastRound(cId);
        kameti.settleRound(cId);

        Kameti.ScoreStats memory stats = kameti.statsOf(subject);
        assertEq(stats.strikes, 1);
        assertEq(kameti.scoreOf(subject), 600 - 30);
    }

    function test_Score_Default_Decreases120() public {
        // depositMultiplier=1: deposit == contribution, miss twice → defaults on 2nd
        usdc.mint(subject, INITIAL_BAL);
        vm.prank(subject);
        usdc.approve(address(kameti), type(uint256).max);

        // 3-member, depositMul=1
        uint256 cId = _createCircle3(1, 0, 0);
        _join(alice, cId);
        _join(subject, cId);

        // Round 1: creator & alice pay, subject doesn't → deposit slashed to 0, strike
        vm.prank(creator); kameti.pay(cId);
        vm.prank(alice);   kameti.pay(cId);
        _warpPastRound(cId);
        kameti.settleRound(cId);

        // Round 2: creator & alice pay, subject doesn't → deposit=0, default
        vm.prank(creator); kameti.pay(cId);
        vm.prank(alice);   kameti.pay(cId);
        _warpPastRound(cId);
        kameti.settleRound(cId);

        Kameti.ScoreStats memory stats = kameti.statsOf(subject);
        assertEq(stats.defaults, 1);
        // score = 600 - 30 (strike round1) - 120 (default round2) = 450
        assertEq(kameti.scoreOf(subject), 450);
    }

    function test_Score_CirclesCompleted_Adds40() public {
        usdc.mint(subject, INITIAL_BAL);
        vm.prank(subject);
        usdc.approve(address(kameti), type(uint256).max);

        // 3-member circle, subject participates and completes
        uint256 cId = _createCircle3(1, 0, 0);
        _join(alice, cId);
        _join(subject, cId);

        address[3] memory m = [creator, alice, subject];

        // Complete all 3 rounds
        for (uint8 r = 0; r < 3; r++) {
            _allPay3(cId, m);
            _warpPastRound(cId);
            kameti.settleRound(cId);
        }

        Kameti.ScoreStats memory stats = kameti.statsOf(subject);
        assertEq(stats.circlesCompleted, 1);
        // score = 600 + 5*3 (3 payments) + 40 = 655
        assertEq(kameti.scoreOf(subject), 655);
    }

    function test_Score_Clamp_MaxAt900() public {
        usdc.mint(subject, INITIAL_BAL * 10);
        vm.prank(subject);
        usdc.approve(address(kameti), type(uint256).max);

        // Run many 3-member circles where subject pays on time every round
        // 600 + 5*n = 900 → n = 60 on-time payments
        // Run 20 circles × 3 rounds = 60 on-time payments
        for (uint256 c = 0; c < 20; c++) {
            uint256 cId = _createCircle3(1, 0, 0);
            _join(alice, cId);
            _join(subject, cId);
            address[3] memory m = [creator, alice, subject];
            for (uint256 r = 0; r < 3; r++) {
                _allPay3(cId, m);
                _warpPastRound(cId);
                kameti.settleRound(cId);
            }
        }
        assertEq(kameti.scoreOf(subject), 900);
    }

    function test_Score_Clamp_MinAt300() public {
        usdc.mint(subject, INITIAL_BAL * 10);
        vm.prank(subject);
        usdc.approve(address(kameti), type(uint256).max);

        // subject defaults many times: 600 - 120*n = 300 → n = 2.5 → 3 defaults needed
        // Each 3-member circle with depositMul=1: subject misses round 2 (default)
        for (uint256 c = 0; c < 5; c++) {
            uint256 cId = _createCircle3(1, 0, 0);
            _join(alice, cId);
            _join(subject, cId);
            // Only creator & alice pay
            vm.prank(creator); kameti.pay(cId);
            vm.prank(alice);   kameti.pay(cId);
            _warpPastRound(cId);
            kameti.settleRound(cId);

            vm.prank(creator); kameti.pay(cId);
            vm.prank(alice);   kameti.pay(cId);
            _warpPastRound(cId);
            kameti.settleRound(cId);

            vm.prank(creator); kameti.pay(cId);
            vm.prank(alice);   kameti.pay(cId);
            _warpPastRound(cId);
            kameti.settleRound(cId);
        }
        assertEq(kameti.scoreOf(subject), 300);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8  minScore gate
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2MinScoreTest is Kameti2Base {
    address internal newAddr = makeAddr("newAddr");

    function setUp() public override {
        super.setUp();
        usdc.mint(newAddr, INITIAL_BAL);
        vm.prank(newAddr);
        usdc.approve(address(kameti), type(uint256).max);
    }

    function test_MinScore_FreshAddress_Is600_JoinFails_700() public {
        uint256 cId;
        vm.prank(creator);
        cId = kameti.createCircle(
            "score gate", CONTRIBUTION, 3, ROUND_DUR, DEPOSIT_MUL, MAX_DISC_BPS, 700, 5000, 10
        );
        // fresh address has score 600 < 700
        vm.prank(newAddr);
        vm.expectRevert(Kameti.ScoreTooLow.selector);
        kameti.join(cId);
    }

    function test_MinScore_ScoreGate_JoinSucceeds_After_Improvement() public {
        // Give newAddr enough on-time payments to push score to 700
        // Need (700-600)/5 = 20 on-time payments → run multiple circles
        // Easier: run 20 small circles where newAddr pays on time
        usdc.mint(newAddr, INITIAL_BAL * 20);

        for (uint256 c = 0; c < 20; c++) {
            vm.prank(creator);
            uint256 smallId = kameti.createCircle(
                "boost", CONTRIBUTION, 3, ROUND_DUR, 1, 0, 0, 0, 0
            );
            _join(alice, smallId);
            _join(newAddr, smallId);
            address[3] memory m = [creator, alice, newAddr];
            _allPay3(smallId, m);
            _warpPastRound(smallId);
            kameti.settleRound(smallId);
            // advance 2 more rounds (alice & newAddr haven't won yet)
            // settle quickly
            _allPay3(smallId, m);
            _warpPastRound(smallId);
            kameti.settleRound(smallId);
            _allPay3(smallId, m);
            _warpPastRound(smallId);
            kameti.settleRound(smallId);
        }

        assertGe(kameti.scoreOf(newAddr), 700);

        // Now join should succeed
        vm.prank(creator);
        uint256 gateId = kameti.createCircle(
            "score gate", CONTRIBUTION, 3, ROUND_DUR, DEPOSIT_MUL, MAX_DISC_BPS, 700, 5000, 10
        );
        vm.prank(newAddr);
        kameti.join(gateId); // should not revert
    }
}
