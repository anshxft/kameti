// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Kameti2Base} from "./Kameti2.Base.t.sol";
import {Kameti} from "../Kameti.sol";
import {MockUSDC3009} from "../test-helpers/MockUSDC3009.sol";
import {IUSDC3009} from "../Kameti.sol";

// ─────────────────────────────────────────────────────────────────────────────
// §A  Happy path AutoPay tests
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti3AutoPayHappyTest is Kameti2Base {

    // ── test A1: full 4-member circle using ONLY executeAutoPay ──────────────

    function test_StoreAndExecuteAutoPay_FullCircle() public {
        uint256 id = _fullActive4(); // seats: creator(0), alice(1), bob(2), carol(3)

        uint256 validBefore = block.timestamp + 10 days;

        // Each member stores auths for rounds 1..4 at join time
        address[4] memory members   = [creator, alice, bob, carol];
        uint256[4] memory pks       = [creatorPk, alicePk, bobPk, carolPk];

        for (uint256 m = 0; m < 4; m++) {
            uint8[]   memory rounds = new uint8[](4);
            uint256[] memory vbs    = new uint256[](4);
            uint8[]   memory vs     = new uint8[](4);
            bytes32[] memory rs     = new bytes32[](4);
            bytes32[] memory ss     = new bytes32[](4);
            for (uint8 rnd = 1; rnd <= 4; rnd++) {
                bytes32 nonce = kameti.roundNonce(id, rnd, members[m]);
                (uint8 v, bytes32 r, bytes32 s) = _signReceive(
                    pks[m], members[m], address(kameti), CONTRIBUTION, 0, validBefore, nonce
                );
                rounds[rnd-1] = rnd;
                vbs[rnd-1]    = validBefore;
                vs[rnd-1]     = v;
                rs[rnd-1]     = r;
                ss[rnd-1]     = s;
            }
            vm.prank(members[m]);
            kameti.storeAuthorizations(id, rounds, vbs, vs, rs, ss);
        }

        // Run all 4 rounds using only executeAutoPay + settleRound
        for (uint8 rnd = 1; rnd <= 4; rnd++) {
            kameti.executeAutoPay(id);
            _warpPastRound(id);
            kameti.settleRound(id);
        }

        // After completion: every member should have onTimePayments == 4
        // (winner gets credit via settleRound; non-winner payers also credited)
        // At least all 4 rounds ran.  Check circle completed.
        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(id);
        assertEq(uint8(status), uint8(Kameti.CircleStatus.Completed), "circle must be completed");
    }

    // ── test A2: executeAutoPay partial success ───────────────────────────────

    function test_ExecuteAutoPay_PartialSuccess() public {
        // 3-member circle: creator(0), alice(1), bob(2)
        uint256 id = _fullActive3();

        uint256 validBefore = block.timestamp + 2 days;

        // creator & alice store auth, bob does NOT
        _storeAuth(creatorPk, creator, id, 1, validBefore);
        _storeAuth(alicePk,   alice,   id, 1, validBefore);

        // executeAutoPay should pay creator & alice, skip bob
        kameti.executeAutoPay(id);

        Kameti.MemberInfo[] memory infos = kameti.getMembers(id);
        bool creatorPaid; bool alicePaid; bool bobPaid;
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == creator) creatorPaid = infos[i].paidThisRound;
            if (infos[i].addr == alice)   alicePaid   = infos[i].paidThisRound;
            if (infos[i].addr == bob)     bobPaid     = infos[i].paidThisRound;
        }
        assertTrue(creatorPaid, "creator should be paid via autopay");
        assertTrue(alicePaid,   "alice should be paid via autopay");
        assertFalse(bobPaid,    "bob had no stored auth, should be unpaid");

        // settle: bob should be slashed
        _warpPastRound(id);
        vm.expectEmit(true, true, true, false, address(kameti));
        emit Kameti.DepositSlashed(id, 1, bob, 0, 0);
        kameti.settleRound(id);
    }

    // ── test A3: settleRound executes stored auth before slashing ─────────────

    function test_SettleRound_ExecutesAuthBeforeSlashing() public {
        uint256 id = _fullActive3(); // creator, alice, bob

        uint256 validBefore = block.timestamp + 2 days;

        // Store auth for all 3 for round 1, but DON'T call executeAutoPay
        _storeAuth(creatorPk, creator, id, 1, validBefore);
        _storeAuth(alicePk,   alice,   id, 1, validBefore);
        _storeAuth(bobPk,     bob,     id, 1, validBefore);

        // Warp past round end and settle — settleRound should internally call
        // _executeAutoPay(settlePath=true) before slashing
        _warpPastRound(id);
        kameti.settleRound(id);

        // All 3 should be marked paid (autopay ran), no DepositSlashed emitted
        // We check by looking at the settled circle state: no deposits were reduced
        Kameti.MemberInfo[] memory infos = kameti.getMembers(id);
        for (uint256 i = 0; i < infos.length; i++) {
            // After settle, paid[] is reset to false — but deposit should be intact
            assertEq(infos[i].depositLeft, DEPOSIT, "deposit must not be slashed");
        }
    }

    // ── test A4: revokeAutoPay then member is slashed ─────────────────────────

    function test_RevokeAutoPay_ThenSlashed() public {
        uint256 id = _fullActive3(); // creator, alice, bob

        uint256 validBefore = block.timestamp + 2 days;

        // Alice stores auths for rounds 1..3
        for (uint8 rnd = 1; rnd <= 3; rnd++) {
            _storeAuth(alicePk, alice, id, rnd, validBefore);
        }

        // Alice revokes from round 1 onward
        vm.prank(alice);
        kameti.revokeAutoPay(id, 1);

        // Confirm no auth stored for round 1
        uint8[] memory autoPayRounds = kameti.getMemberAutoPay(id, alice);
        assertEq(autoPayRounds.length, 0, "alice should have no stored auths after revoke");

        // Settle round 1 without executing autopay: alice should be slashed
        _warpPastRound(id);
        vm.expectEmit(true, true, true, false, address(kameti));
        emit Kameti.DepositSlashed(id, 1, alice, 0, 0);
        kameti.settleRound(id);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §B  Rejection tests
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti3AutoPayRejectTest is Kameti2Base {

    // ── test B5: auth for wrong round → AutoPayFailed ─────────────────────────

    function test_AuthWrongRound() public {
        uint256 id = _fullActive3();
        uint256 validBefore = block.timestamp + 2 days;

        // Store auth for round 3 (not the current round 1)
        _storeAuth(alicePk, alice, id, 3, validBefore);

        // executeAutoPay in round 1: alice has no auth for round 1, just skipped
        kameti.executeAutoPay(id);

        Kameti.MemberInfo[] memory infos = kameti.getMembers(id);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == alice) {
                assertFalse(infos[i].paidThisRound, "alice should not be paid (wrong round auth)");
            }
        }
    }

    // ── test B6: auth signed for wrong circle → AutoPayFailed(0) ─────────────

    function test_AuthWrongCircle() public {
        uint256 id0 = _fullActive3(); // circle 0: creator, alice, bob
        // Create another 3-member circle (circle 1)
        vm.prank(creator);
        uint256 id1 = kameti.createCircle(CIRCLE_NAME, CONTRIBUTION, 3, ROUND_DUR, DEPOSIT_MUL, MAX_DISC_BPS, 0, 5000, 10);
        _join(alice, id1);
        _join(bob,   id1);

        uint256 validBefore = block.timestamp + 2 days;

        // Sign a nonce for circle id0, round 1 but try to use it in circle id1
        bytes32 wrongNonce = kameti.roundNonce(id0, 1, alice);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(
            alicePk, alice, address(kameti), CONTRIBUTION, 0, validBefore, wrongNonce
        );

        // Manually store using the wrong-circle nonce into circle id1
        // (storeAuthorizations accepts any bytes32, so we directly craft the call)
        uint8[]   memory rounds = new uint8[](1);
        uint256[] memory vbs    = new uint256[](1);
        uint8[]   memory vs     = new uint8[](1);
        bytes32[] memory rs     = new bytes32[](1);
        bytes32[] memory ss     = new bytes32[](1);
        rounds[0] = 1; vbs[0] = validBefore; vs[0] = v; rs[0] = r; ss[0] = s;
        vm.prank(alice);
        kameti.storeAuthorizations(id1, rounds, vbs, vs, rs, ss);

        // executeAutoPay on circle id1: alice's stored sig was for id0, so
        // receiveWithAuthorization will fail (nonce mismatch) → AutoPayFailed(0)
        vm.expectEmit(true, true, true, true, address(kameti));
        emit Kameti.AutoPayFailed(id1, 1, alice, 0);
        kameti.executeAutoPay(id1);
    }

    // ── test B7: auth signed for wrong value → AutoPayFailed ─────────────────

    function test_AuthWrongValue() public {
        uint256 id = _fullActive3();
        uint256 validBefore = block.timestamp + 2 days;

        // Sign for CONTRIBUTION * 2, but contract expects exactly CONTRIBUTION
        bytes32 nonce = kameti.roundNonce(id, 1, alice);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(
            alicePk, alice, address(kameti), CONTRIBUTION * 2, 0, validBefore, nonce
        );

        uint8[]   memory rounds = new uint8[](1);
        uint256[] memory vbs    = new uint256[](1);
        uint8[]   memory vs     = new uint8[](1);
        bytes32[] memory rs     = new bytes32[](1);
        bytes32[] memory ss     = new bytes32[](1);
        rounds[0] = 1; vbs[0] = validBefore; vs[0] = v; rs[0] = r; ss[0] = s;
        vm.prank(alice);
        kameti.storeAuthorizations(id, rounds, vbs, vs, rs, ss);

        // executeAutoPay: receiveWithAuthorization will be called with CONTRIBUTION
        // but the sig covers CONTRIBUTION*2 → ecrecover mismatch → catch → AutoPayFailed(0)
        vm.expectEmit(true, true, true, true, address(kameti));
        emit Kameti.AutoPayFailed(id, 1, alice, 0);
        kameti.executeAutoPay(id);
    }

    // ── test B8: replay after use → skipped (already paid) ───────────────────

    function test_AuthReplayAfterUse() public {
        uint256 id = _fullActive3();
        uint256 validBefore = block.timestamp + 2 days;

        _storeAuth(alicePk, alice, id, 1, validBefore);

        // First execute: should succeed
        kameti.executeAutoPay(id);

        Kameti.MemberInfo[] memory infos = kameti.getMembers(id);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == alice) {
                assertTrue(infos[i].paidThisRound, "alice should be paid after first execute");
            }
        }

        // Second execute: alice.paid[si]=true, so the loop continues (skipped)
        // No revert, no additional events
        uint256 balBefore = usdc.balanceOf(address(kameti));
        kameti.executeAutoPay(id);
        assertEq(usdc.balanceOf(address(kameti)), balBefore, "balance must not change on replay");
    }

    // ── test B9: cancelled auth → AutoPayFailed(0) ────────────────────────────

    function test_CancelledAuth_SetsAutoPayFailed() public {
        uint256 id = _fullActive3();
        uint256 validBefore = block.timestamp + 2 days;

        // Store a valid auth for alice round 1
        _storeAuth(alicePk, alice, id, 1, validBefore);

        // Alice cancels that nonce directly on the USDC token
        bytes32 nonce = kameti.roundNonce(id, 1, alice);
        (uint8 cv, bytes32 cr, bytes32 cs) = _signCancel(alicePk, alice, nonce);
        usdc.cancelAuthorization(alice, nonce, cv, cr, cs);

        // executeAutoPay: receiveWithAuthorization will revert (nonce already used)
        // → caught → AutoPayFailed(0)
        vm.expectEmit(true, true, true, true, address(kameti));
        emit Kameti.AutoPayFailed(id, 1, alice, 0);
        kameti.executeAutoPay(id);
    }

    // ── test B10: no balance → AutoPayFailed(0) and slashed at settle ─────────

    function test_NoBalance_SkippedWithAutoPayFailed() public {
        uint256 id = _fullActive3();
        uint256 validBefore = block.timestamp + 2 days;

        // Store valid auth for alice
        _storeAuth(alicePk, alice, id, 1, validBefore);

        // Drain alice's balance (transfer to address(1))
        uint256 aliceBal = usdc.balanceOf(alice);
        vm.prank(alice);
        usdc.transfer(address(1), aliceBal);

        // executeAutoPay: receiveWithAuthorization will revert (insufficient)
        // → caught → AutoPayFailed(0)
        vm.expectEmit(true, true, true, true, address(kameti));
        emit Kameti.AutoPayFailed(id, 1, alice, 0);
        kameti.executeAutoPay(id);

        // Alice is slashed at settle
        _warpPastRound(id);
        vm.expectEmit(true, true, true, false, address(kameti));
        emit Kameti.DepositSlashed(id, 1, alice, 0, 0);
        kameti.settleRound(id);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §C  joinWithAuthorization tests
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti3JoinWithAuthTest is Kameti2Base {

    // helper: create an open circle (creator joined, 3 more slots)
    function _openCircle4() internal returns (uint256 id) {
        vm.prank(creator);
        id = kameti.createCircle(CIRCLE_NAME, CONTRIBUTION, MAX_MEMBERS, ROUND_DUR, DEPOSIT_MUL, MAX_DISC_BPS, 0, 5000, 10);
    }

    function _signDeposit(
        uint256 pk, address who, uint256 id_, uint256 validBefore_
    ) internal view returns (uint8 v, bytes32 r, bytes32 s, bytes32 nonce) {
        nonce = kameti.depositNonce(id_, who);
        (v, r, s) = _signReceive(pk, who, address(kameti), DEPOSIT, 0, validBefore_, nonce);
    }

    // ── C11: happy path ──────────────────────────────────────────────────────

    function test_JoinWithAuthorization_HappyPath() public {
        uint256 id = _openCircle4();
        uint256 validBefore = block.timestamp + 2 days;

        (uint8 v, bytes32 r, bytes32 s, bytes32 nonce) = _signDeposit(alicePk, alice, id, validBefore);

        uint256 balBefore = usdc.balanceOf(address(kameti));

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(kameti));
        emit Kameti.MemberJoined(id, alice, 2);
        kameti.joinWithAuthorization(id, validBefore, nonce, v, r, s);

        assertEq(usdc.balanceOf(address(kameti)), balBefore + DEPOSIT, "deposit must be pulled");

        Kameti.MemberInfo[] memory infos = kameti.getMembers(id);
        bool aliceFound;
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == alice) { aliceFound = true; break; }
        }
        assertTrue(aliceFound, "alice should be in circle after joinWithAuthorization");
    }

    // ── C12: bad nonce → InvalidParams ──────────────────────────────────────

    function test_JoinWithAuthorization_BadNonce() public {
        uint256 id = _openCircle4();
        uint256 validBefore = block.timestamp + 2 days;

        bytes32 badNonce = keccak256("wrong");
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(
            alicePk, alice, address(kameti), DEPOSIT, 0, validBefore, badNonce
        );

        vm.prank(alice);
        vm.expectRevert(Kameti.InvalidParams.selector);
        kameti.joinWithAuthorization(id, validBefore, badNonce, v, r, s);
    }

    // ── C13: already member → AlreadyMember ─────────────────────────────────

    function test_JoinWithAuthorization_NonMember() public {
        uint256 id = _openCircle4();
        uint256 validBefore = block.timestamp + 2 days;

        // creator is already in the circle
        bytes32 nonce = kameti.depositNonce(id, creator);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(
            creatorPk, creator, address(kameti), DEPOSIT, 0, validBefore, nonce
        );

        vm.prank(creator);
        vm.expectRevert(Kameti.AlreadyMember.selector);
        kameti.joinWithAuthorization(id, validBefore, nonce, v, r, s);
    }

    // ── C14: circle full → CircleFull ────────────────────────────────────────

    function test_JoinWithAuthorization_CircleFull() public {
        // Fill a 4-member circle using regular join
        uint256 id = _fullActive4();

        uint256 validBefore = block.timestamp + 2 days;
        bytes32 nonce = kameti.depositNonce(id, dave);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(
            davePk, dave, address(kameti), DEPOSIT, 0, validBefore, nonce
        );

        vm.prank(dave);
        vm.expectRevert(Kameti.CircleNotOpen.selector);
        kameti.joinWithAuthorization(id, validBefore, nonce, v, r, s);
    }

    // ── C15: score gate ──────────────────────────────────────────────────────

    function test_JoinWithAuthorization_ScoreGate() public {
        // Create circle with minScore=700 (alice has default 600)
        vm.prank(creator);
        uint256 id = kameti.createCircle(CIRCLE_NAME, CONTRIBUTION, MAX_MEMBERS, ROUND_DUR, DEPOSIT_MUL, MAX_DISC_BPS, 700, 5000, 10);

        uint256 validBefore = block.timestamp + 2 days;
        bytes32 nonce = kameti.depositNonce(id, alice);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(
            alicePk, alice, address(kameti), DEPOSIT, 0, validBefore, nonce
        );

        vm.prank(alice);
        vm.expectRevert(Kameti.ScoreTooLow.selector);
        kameti.joinWithAuthorization(id, validBefore, nonce, v, r, s);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §D  payWithAuthorization tests
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti3PayWithAuthTest is Kameti2Base {

    uint256 internal cId;

    function setUp() public override {
        super.setUp();
        cId = _fullActive3(); // creator(0), alice(1), bob(2)
    }

    function _signRoundPay(
        uint256 pk, address who, uint256 id_, uint8 rnd, uint256 validBefore_
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 nonce = kameti.roundNonce(id_, rnd, who);
        (v, r, s) = _signReceive(pk, who, address(kameti), CONTRIBUTION, 0, validBefore_, nonce);
    }

    // ── D16: happy path — relayer calls on behalf of alice ───────────────────

    function test_PayWithAuthorization_HappyPath() public {
        uint256 validBefore = block.timestamp + 2 days;
        (uint8 v, bytes32 r, bytes32 s) = _signRoundPay(alicePk, alice, cId, 1, validBefore);

        // A relayer (bob) calls payWithAuthorization for alice
        vm.prank(bob);
        vm.expectEmit(true, true, true, true, address(kameti));
        emit Kameti.ContributionPaid(cId, 1, alice, CONTRIBUTION, false);
        kameti.payWithAuthorization(cId, alice, validBefore, v, r, s);

        Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == alice) {
                assertTrue(infos[i].paidThisRound, "alice must be marked paid");
            }
        }
    }

    // ── D17: after deadline → RoundEnded ─────────────────────────────────────

    function test_PayWithAuthorization_AfterDeadline() public {
        uint256 validBefore = block.timestamp + 2 days;
        (uint8 v, bytes32 r, bytes32 s) = _signRoundPay(alicePk, alice, cId, 1, validBefore);

        _warpPastRound(cId);

        vm.expectRevert(Kameti.RoundEnded.selector);
        kameti.payWithAuthorization(cId, alice, validBefore, v, r, s);
    }

    // ── D18: already paid → AlreadyPaid ─────────────────────────────────────

    function test_PayWithAuthorization_AlreadyPaid() public {
        uint256 validBefore = block.timestamp + 2 days;
        (uint8 v, bytes32 r, bytes32 s) = _signRoundPay(alicePk, alice, cId, 1, validBefore);

        kameti.payWithAuthorization(cId, alice, validBefore, v, r, s);

        // Second call: nonce already used → receiveWithAuthorization will revert
        // but the contract checks AlreadyPaid first
        vm.expectRevert(Kameti.AlreadyPaid.selector);
        kameti.payWithAuthorization(cId, alice, validBefore, v, r, s);
    }

    // ── D19: non-member → NotMember ──────────────────────────────────────────

    function test_PayWithAuthorization_NonMember() public {
        uint256 validBefore = block.timestamp + 2 days;
        (uint8 v, bytes32 r, bytes32 s) = _signRoundPay(davePk, dave, cId, 1, validBefore);

        vm.expectRevert(Kameti.NotMember.selector);
        kameti.payWithAuthorization(cId, dave, validBefore, v, r, s);
    }

    // ── D20: bad signature → receiveWithAuthorization reverts → propagates ───

    function test_PayWithAuthorization_BadSig() public {
        uint256 validBefore = block.timestamp + 2 days;
        // sign with BOB's key but claim it's for ALICE
        (uint8 v, bytes32 r, bytes32 s) = _signRoundPay(bobPk, alice, cId, 1, validBefore);

        // The USDC mock will revert InvalidSignature, which propagates up
        vm.expectRevert();
        kameti.payWithAuthorization(cId, alice, validBefore, v, r, s);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §E  Soft-close (anti-snipe) tests
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti3SoftCloseTest is Kameti2Base {

    uint256 internal cId;
    uint256 internal snipeWindow;
    uint256 internal constant POT      = CONTRIBUTION * 4;
    uint256 internal constant MIN_STEP = POT / 100;
    uint256 internal constant CAP      = (POT * MAX_DISC_BPS) / 10000;

    function setUp() public override {
        super.setUp();
        cId = _fullActive4();
        _allPay4(cId);

        // snipeWindow = min(roundDuration/5, 2 minutes)
        uint256 sw = ROUND_DUR / 5;
        if (sw > 2 minutes) sw = 2 minutes;
        snipeWindow = sw;
    }

    // ── E21: bid within snipe window → roundEnd extended ─────────────────────

    function test_SoftClose_BidExtendsRoundEnd() public {
        (, , , uint256 roundEnd, , ,) = kameti.getCircle(cId);

        // Warp to within snipe window
        vm.warp(roundEnd - snipeWindow / 2);

        uint256 bidDiscount = MIN_STEP + 1;
        vm.prank(alice);
        vm.expectEmit(true, false, false, false, address(kameti));
        emit Kameti.RoundExtended(cId, 1, 0); // value check skipped
        kameti.placeBid(cId, bidDiscount);

        (, , , uint256 newRoundEnd, , ,) = kameti.getCircle(cId);
        assertGt(newRoundEnd, roundEnd, "roundEnd must be extended after snipe bid");
    }

    // ── E22: cap respected after 3 bids within window ────────────────────────

    function test_SoftClose_CapRespected() public {
        (, , , uint256 roundEnd0, , ,) = kameti.getCircle(cId);
        uint256 maxExt = snipeWindow * 3; // MAX_SNIPE_EXTENSIONS = 3

        // 4 bids near the deadline; each extends by snipeWindow
        uint256 bid = MIN_STEP + 1;
        address[4] memory members = [alice, bob, carol, creator];

        for (uint256 i = 0; i < 4; i++) {
            (, , , uint256 roundEnd, , ,) = kameti.getCircle(cId);
            vm.warp(roundEnd - snipeWindow / 2);

            vm.prank(members[i]);
            try kameti.placeBid(cId, bid + i * MIN_STEP) {} catch {}
        }

        (, , , uint256 finalRoundEnd, , ,) = kameti.getCircle(cId);
        assertLe(finalRoundEnd - roundEnd0, maxExt, "extension must not exceed 3*snipeWindow");
    }

    // ── E23: bid outside window → no extension ───────────────────────────────

    function test_SoftClose_BidOutsideWindow_NoExtension() public {
        (, , , uint256 roundEnd, , ,) = kameti.getCircle(cId);

        // Bid with more than snipeWindow remaining
        vm.warp(roundEnd - snipeWindow - 10);

        uint256 bidDiscount = MIN_STEP + 1;
        vm.prank(alice);
        kameti.placeBid(cId, bidDiscount);

        (, , , uint256 newRoundEnd, , ,) = kameti.getCircle(cId);
        assertEq(newRoundEnd, roundEnd, "roundEnd must NOT change for bid outside snipe window");
    }

    // ── E24: extension resets between rounds ─────────────────────────────────

    function test_SoftClose_ResetBetweenRounds() public {
        (, , , uint256 r1End, , ,) = kameti.getCircle(cId);

        // Place a bid within the snipe window in round 1
        vm.warp(r1End - snipeWindow / 2);
        vm.prank(alice);
        kameti.placeBid(cId, MIN_STEP + 1);

        (, , , uint256 extendedR1End, , ,) = kameti.getCircle(cId);
        assertGt(extendedR1End, r1End, "round 1 must be extended");

        // Settle round 1
        vm.warp(extendedR1End + 1);
        kameti.settleRound(cId);

        // Round 2: snipeExtensions should be reset to 0
        // Place bid near deadline: should be able to extend again
        (, , , uint256 r2End, , ,) = kameti.getCircle(cId);
        _allPay4(cId);
        vm.warp(r2End - snipeWindow / 2);
        vm.prank(bob);
        vm.expectEmit(true, false, false, false, address(kameti));
        emit Kameti.RoundExtended(cId, 2, 0);
        kameti.placeBid(cId, MIN_STEP + 1);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §G  Fix-verification tests (Kameti v3 patch)
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Fix 1: discount clamped to realized pot in settleRound.
///      Fix 2: payWithAuthorization deletes _auth[circleId][currentRound][from].
contract Kameti3FixVerificationTest is Kameti2Base {

    // ── G25: discount clamp prevents underflow when members default ───────────
    //
    // Setup: 3-member circle with depositMultiplier=1 (deposit == contribution).
    //   Round 1: nobody pays → all 3 are *struck* (deposit covers contribution,
    //            no shortfall).  After settle: creator wins (seat 0, lowest
    //            eligible).  creator.deposit=0, alice.deposit=0, bob.deposit=0.
    //
    //   Round 2: alice (not yet a winner) pays 10 USDC and places a bid of
    //            11 USDC — below the 40 % cap (12 USDC) but larger than the
    //            realized pot that results when creator & bob default.
    //            creator and bob have deposit=0 → cover=0, shortfall=10 → both
    //            DEFAULT during settleRound, so realized pot = 10 USDC.
    //            Without the clamp:  payout = 10 − 11  →  arithmetic underflow.
    //            With the clamp:     discount = min(11, 10) = 10, payout = 0 ✓
    //
    // MAX_DISC_BPS is 4000 (40 %) so the cap on a 3-member × 10 USDC pot =
    // 12 USDC, which is deliberately above the realized pot of 10 USDC.
    // Alice can bid 11 USDC (< 12 USDC cap) and it still exceeds the realized
    // pot → the clamp is exercised.

    function test_DiscountClamp_DefaultedMember() public {
        // ── 1. Create a 3-member circle with depositMul=1, maxDiscBps=4000 ──
        vm.prank(creator);
        uint256 id = kameti.createCircle(
            "Clamp Test",
            CONTRIBUTION,   // 10 USDC
            3,
            ROUND_DUR,
            1,              // depositMultiplier = 1  →  deposit = contribution
            4000,           // 40 % cap  →  cap = 3 × 10 × 0.40 = 12 USDC
            0,
            0,              // postWinLockBps = 0
            0               // keeperTipBps = 0
        );
        _join(alice, id);
        _join(bob,   id);
        // Circle is now Active (3/3).

        // ── 2. Round 1: nobody pays → all 3 struck, deposits exhausted to 0 ─
        //      Winner = creator (seat 0, lowest eligible seat, no bid placed).
        _warpPastRound(id);
        kameti.settleRound(id);

        // Sanity: all deposits = 0; creator has won round 1.
        {
            Kameti.MemberInfo[] memory m = kameti.getMembers(id);
            for (uint256 i = 0; i < m.length; i++) {
                assertEq(m[i].depositLeft, 0, "deposit must be 0 after round-1 strike");
            }
        }

        // ── 3. Round 2: alice pays and bids 11 USDC; creator & bob do NOT pay ─
        //      creator.deposit=0 and bob.deposit=0 → both DEFAULT in settleRound.
        //      alice has not yet won, so her bid is eligible.
        //
        //      Eligible before settle: alice (not won, not defaulted yet),
        //                              bob   (same),
        //                             *creator is WON — not eligible*
        //      → eligible = alice + bob = 2 ≥ 2, so the OnlyOneMemberEligible
        //        guard does NOT fire.  alice can place a bid.

        vm.prank(alice);
        kameti.pay(id);

        // Bid: 11 USDC > highestDiscount(0) + minStep(3*10*1%=0.3 USDC) ✓
        //      and < cap (12 USDC) ✓
        uint256 bidDiscount = 11 * e6; // 11 USDC
        vm.prank(alice);
        kameti.placeBid(id, bidDiscount);

        // ── 4. Settle round 2 — must NOT revert with arithmetic underflow ─────
        _warpPastRound(id);
        // Just check RoundSettled fires (exact arg values verified via history)
        vm.expectEmit(true, false, false, false, address(kameti));
        emit Kameti.RoundSettled(id, 2, address(0), 0, 0, 0);
        kameti.settleRound(id); // <-- would panic without the clamp fix

        // ── 5. Verify the clamped discount from round history ─────────────────
        Kameti.RoundRecord[] memory hist = kameti.getRoundHistory(id);
        assertEq(hist.length, 2, "should have 2 settled rounds");

        // Realized pot = only alice's 10 USDC (creator & bob contributed 0)
        uint256 realizedPot = CONTRIBUTION; // 10 USDC
        assertEq(hist[1].pot, realizedPot, "round-2 pot must equal realized contributions");

        // Discount must be clamped to realizedPot (not the original 11 USDC bid)
        assertLe(hist[1].discount, realizedPot, "discount must not exceed realized pot");
        assertEq(hist[1].discount, realizedPot, "discount clamped exactly to pot (10 USDC)");
    }

    // ── G26: payWithAuthorization clears stored auth for that round ────────────
    //
    // Store an authorization for alice in round 1 via storeAuthorizations.
    // Then pay that round via payWithAuthorization (relayer path).
    // The fix ensures _auth[circleId][currentRound][alice] is deleted after pay.
    // getMemberAutoPay must return an empty array — the auth is gone.

    function test_PayWithAuth_ClearsStoredAuth() public {
        uint256 id = _fullActive3(); // creator(0), alice(1), bob(2)  — round 1 active

        uint256 validBefore = block.timestamp + 2 days;

        // ── 1. Store auth for alice round 1 ──────────────────────────────────
        _storeAuth(alicePk, alice, id, 1, validBefore);

        // Confirm it is there
        uint8[] memory before = kameti.getMemberAutoPay(id, alice);
        assertEq(before.length, 1, "alice should have 1 stored auth before pay");
        assertEq(before[0], 1,    "stored auth must be for round 1");

        // ── 2. Pay via payWithAuthorization (relayer = bob) ───────────────────
        bytes32 nonce = kameti.roundNonce(id, 1, alice);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(
            alicePk, alice, address(kameti), CONTRIBUTION, 0, validBefore, nonce
        );
        vm.prank(bob);
        kameti.payWithAuthorization(id, alice, validBefore, v, r, s);

        // Confirm alice is marked paid
        Kameti.MemberInfo[] memory infos = kameti.getMembers(id);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == alice) {
                assertTrue(infos[i].paidThisRound, "alice must be marked paid");
            }
        }

        // ── 3. getMemberAutoPay must return empty — auth deleted by the fix ───
        uint8[] memory afterPay = kameti.getMemberAutoPay(id, alice);
        assertEq(afterPay.length, 0,
            "stored auth for round 1 must be cleared after payWithAuthorization");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §F  getMemberAutoPay view
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti3GetMemberAutoPayTest is Kameti2Base {

    function test_GetMemberAutoPay() public {
        uint256 id = _fullActive4(); // 4-member circle (rounds 1..4)

        uint256 validBefore = block.timestamp + 10 days;

        // Store auths for alice for rounds 2, 3, 4 (not round 1)
        for (uint8 rnd = 2; rnd <= 4; rnd++) {
            _storeAuth(alicePk, alice, id, rnd, validBefore);
        }

        // Should return [2, 3, 4]
        uint8[] memory rounds = kameti.getMemberAutoPay(id, alice);
        assertEq(rounds.length, 3, "should have 3 stored auths");
        assertEq(rounds[0], 2);
        assertEq(rounds[1], 3);
        assertEq(rounds[2], 4);

        // Now run round 1 (all pay manually), settle
        _allPay4(id);
        _warpPastRound(id);
        kameti.settleRound(id);

        // Round 2: store auth for alice round 2 already done; execute it
        _storeAuth(creatorPk, creator, id, 2, validBefore);
        _storeAuth(bobPk,     bob,     id, 2, validBefore);
        _storeAuth(carolPk,   carol,   id, 2, validBefore);
        kameti.executeAutoPay(id);
        _warpPastRound(id);
        kameti.settleRound(id);

        // After round 2 settled, alice's auth for round 2 was consumed
        // getMemberAutoPay from current round (3) should return [3, 4]
        uint8[] memory afterRound2 = kameti.getMemberAutoPay(id, alice);
        assertEq(afterRound2.length, 2, "should have 2 stored auths after round 2");
        assertEq(afterRound2[0], 3);
        assertEq(afterRound2[1], 4);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §H  New security-fix tests (added after four security fixes)
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti3SecurityFixTest is Kameti2Base {

    // ── H27: storeAuthorizations after roundEnd reverts with RoundEnded() ─────
    //
    // Advance time past the current roundEnd, then attempt to store an
    // authorization for the *current* round — the contract must revert with
    // RoundEnded() to prevent members from sneaking in an auth post-deadline
    // and avoiding slashing.

    function test_StoreAuth_AfterDeadline_Reverts() public {
        uint256 id = _fullActive3(); // creator(0), alice(1), bob(2) — round 1 active

        // Warp past the round-1 deadline
        _warpPastRound(id);

        // Fetch the current round number (should still be 1; round has not been settled yet)
        (, , uint8 currentRound, , , ,) = kameti.getCircle(id);
        assertEq(currentRound, 1, "precondition: still round 1");

        // Build a valid-looking auth for alice, round 1
        uint256 validBefore = block.timestamp + 2 days;
        bytes32 nonce = kameti.roundNonce(id, 1, alice);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(
            alicePk, alice, address(kameti), CONTRIBUTION, 0, validBefore, nonce
        );

        uint8[]   memory rounds = new uint8[](1);
        uint256[] memory vbs    = new uint256[](1);
        uint8[]   memory vs     = new uint8[](1);
        bytes32[] memory rs     = new bytes32[](1);
        bytes32[] memory ss     = new bytes32[](1);
        rounds[0] = 1; vbs[0] = validBefore; vs[0] = v; rs[0] = r; ss[0] = s;

        // Attempt to store — must revert with RoundEnded()
        vm.prank(alice);
        vm.expectRevert(Kameti.RoundEnded.selector);
        kameti.storeAuthorizations(id, rounds, vbs, vs, rs, ss);
    }

    // ── H28: createCircleWithAuthorization — per-user nonce check ─────────────
    //
    // 1. Read the current createNonce for creator via createDepositNonce().
    // 2. Sign a ReceiveWithAuthorization using that nonce.
    // 3. Call createCircleWithAuthorization — circle must be created.
    // 4. Verify createNonce[creator] incremented (i.e. the old nonce was consumed).

    function test_CreateCircleWithAuth_PerUserNonce() public {
        uint256 validBefore = block.timestamp + 7 days;
        uint256 deposit = CONTRIBUTION * DEPOSIT_MUL;

        // Step 1: fetch the nonce the contract expects
        bytes32 nonce = kameti.createDepositNonce(creator);

        // Step 2: sign ReceiveWithAuthorization for the deposit amount using that nonce
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(
            creatorPk,
            creator,
            address(kameti),
            deposit,
            0,
            validBefore,
            nonce
        );

        // Step 3: call createCircleWithAuthorization
        vm.prank(creator);
        vm.expectEmit(true, false, false, true, address(kameti));
        emit Kameti.CircleCreated(0 /* id predicted */, CIRCLE_NAME, CONTRIBUTION, 3, creator);
        uint256 id = kameti.createCircleWithAuthorization(
            CIRCLE_NAME,
            CONTRIBUTION,
            3,              // maxMembers (minimum valid)
            ROUND_DUR,
            DEPOSIT_MUL,
            MAX_DISC_BPS,
            MIN_SCORE,
            5000,           // postWinLockBps
            10,             // keeperTipBps
            validBefore,
            nonce,
            v,
            r,
            s
        );

        // Circle must exist (status Open) and creator is member
        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(id);
        assertEq(uint8(status), uint8(Kameti.CircleStatus.Open), "circle must be Open");

        Kameti.MemberInfo[] memory infos = kameti.getMembers(id);
        assertEq(infos.length, 1, "circle must have exactly 1 member (creator)");
        assertEq(infos[0].addr, creator, "seat-1 must be creator");

        // Step 4: createNonce[creator] must have incremented — old nonce consumed
        bytes32 newNonce = kameti.createDepositNonce(creator);
        assertTrue(newNonce != nonce, "createNonce must increment after successful creation");
    }
}
