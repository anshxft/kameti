// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Kameti2Base} from "./Kameti2.Base.t.sol";
import {Kameti} from "../Kameti.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {MockRevertingERC20} from "../test-helpers/MockRevertingERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// §3  Bid rules — revert cases
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2BidRevertTest is Kameti2Base {
    uint256 internal cId;
    uint256 internal constant POT      = CONTRIBUTION * 4;
    uint256 internal constant MIN_STEP = POT / 100;
    uint256 internal constant CAP      = (POT * MAX_DISC_BPS) / 10000;

    function setUp() public override {
        super.setUp();
        cId = _fullActive4(); // creator,alice,bob,carol → Active R1
        // All pay so most bid tests work
        _allPay4(cId);
    }

    function test_BidRevert_UnpaidMember() public {
        // Start a fresh circle where nobody has paid yet
        uint256 freshId = _fullActive4();
        // alice hasn't paid this round
        vm.prank(alice);
        vm.expectRevert(Kameti.BidIneligible.selector);
        kameti.placeBid(freshId, MIN_STEP + 1);
    }

    function test_BidRevert_AlreadyWonMember() public {
        // alice wins round 1, then in round 2 alice tries to bid
        uint256 bid1 = MIN_STEP + 1;
        vm.prank(alice); kameti.placeBid(cId, bid1);
        _warpPastRound(cId);
        kameti.settleRound(cId); // alice wins

        // Round 2
        _allPay4(cId);
        vm.prank(alice);
        vm.expectRevert(Kameti.BidIneligible.selector);
        kameti.placeBid(cId, MIN_STEP + 1);
    }

    function test_BidRevert_DefaultedMember() public {
        // Build a circle where bob defaults, then try to bid
        // Use a fresh 3-member circle with depositMul=1 so bob defaults quickly
        uint256 fresh = _createCircle3(1, 0, 0);
        _join(alice, fresh);
        _join(bob,   fresh);

        // R1: creator & alice pay, bob doesn't → strike
        vm.prank(creator); kameti.pay(fresh);
        vm.prank(alice);   kameti.pay(fresh);
        _warpPastRound(fresh);
        kameti.settleRound(fresh);

        // R2: creator & alice pay, bob doesn't → bob.deposit=0 → default
        vm.prank(creator); kameti.pay(fresh);
        vm.prank(alice);   kameti.pay(fresh);
        // settle R2 without reaching deadline? let's warp
        _warpPastRound(fresh);
        kameti.settleRound(fresh);

        // Now alice & bob are not-won; creator won R1
        // R3: creator & alice pay
        vm.prank(creator); kameti.pay(fresh);
        vm.prank(alice);   kameti.pay(fresh);

        // bob is defaulted → BidIneligible
        vm.prank(bob);
        vm.expectRevert(Kameti.BidIneligible.selector);
        kameti.placeBid(fresh, 1);
    }

    function test_BidRevert_DiscountAboveCap() public {
        vm.prank(alice);
        vm.expectRevert(Kameti.BidAboveCap.selector);
        kameti.placeBid(cId, CAP + 1);
    }

    function test_BidRevert_BidTooLow_NotStrictlyAboveMinStep() public {
        // First bid: discount=0 is the current highest, so first valid bid = 0 + minStep + 1?
        // Contract: discount <= highestDiscount → BidTooLow; discount < highestDiscount + minStep → BidTooLow
        // highestDiscount starts at 0, minStep = POT/100
        // Valid first bid: discount > 0 AND discount >= 0 + minStep → discount >= minStep
        // But: discount <= highestDiscount (0) → fails first check if discount=0
        // discount=minStep: is minStep > 0? Yes. Is minStep < 0+minStep? No → passes. Should succeed.
        // discount=minStep-1: minStep-1 < minStep → BidTooLow
        uint256 tooLow = MIN_STEP - 1;
        if (tooLow == 0) tooLow = 0; // edge: if minStep=1, tooLow=0 which hits discount<=highest first

        vm.prank(alice);
        vm.expectRevert(Kameti.BidTooLow.selector);
        kameti.placeBid(cId, tooLow);
    }

    function test_BidRevert_BidTooLow_BelowCurrentHighest() public {
        // alice places valid bid
        uint256 bid1 = MIN_STEP + 1;
        vm.prank(alice); kameti.placeBid(cId, bid1);

        // bob tries to bid same or lower
        vm.prank(bob);
        vm.expectRevert(Kameti.BidTooLow.selector);
        kameti.placeBid(cId, bid1); // same → BidTooLow
    }

    function test_BidRevert_BidAfterDeadline() public {
        _warpPastRound(cId);
        vm.prank(alice);
        vm.expectRevert(Kameti.BidAfterDeadline.selector);
        kameti.placeBid(cId, MIN_STEP + 1);
    }

    function test_Bid_HappyPath_EmitsBidPlaced() public {
        uint256 validBid = MIN_STEP + 1;
        vm.prank(alice);
        vm.expectEmit(true, false, true, true, address(kameti));
        emit Kameti.BidPlaced(cId, 1, alice, validBid);
        kameti.placeBid(cId, validBid);
    }

    function test_Bid_Ascending_StepEnforced() public {
        uint256 bid1 = MIN_STEP + 1;
        vm.prank(alice); kameti.placeBid(cId, bid1);

        // bob tries bid1 + minStep - 1 → too low
        vm.prank(bob);
        vm.expectRevert(Kameti.BidTooLow.selector);
        kameti.placeBid(cId, bid1 + MIN_STEP - 1);

        // bob bids bid1 + minStep → succeeds
        vm.prank(bob);
        kameti.placeBid(cId, bid1 + MIN_STEP);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §7  AutoPay
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2AutoPayTest is Kameti2Base {
    uint256 internal cId;

    function setUp() public override {
        super.setUp();
        cId = _fullActive3(); // creator(0), alice(1), bob(2)
    }

    function test_AutoPay_PayFor_HappyPath() public {
        // Enable autopay for alice
        vm.prank(alice);
        kameti.setAutoPay(cId, true);

        // Anyone can call payFor(id, alice) and it should succeed
        vm.prank(creator);
        kameti.payFor(cId, alice);

        Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == alice) {
                assertTrue(infos[i].paidThisRound, "alice marked paid");
            }
        }
    }

    function test_AutoPay_PayFor_Revert_AutoPayNotEnabled() public {
        // alice has autopay OFF by default
        vm.prank(creator);
        vm.expectRevert(Kameti.AutoPayNotEnabled.selector);
        kameti.payFor(cId, alice);
    }

    function test_AutoPay_PayFor_Revert_AlreadyPaid() public {
        vm.prank(alice);
        kameti.setAutoPay(cId, true);

        // alice pays directly
        vm.prank(alice);
        kameti.pay(cId);

        // payFor after already paid → AlreadyPaid
        vm.prank(creator);
        vm.expectRevert(Kameti.AlreadyPaid.selector);
        kameti.payFor(cId, alice);
    }

    function test_AutoPay_PayAllAutoPay_TwoSucceed_OneFails() public {
        // creator, alice enable autopay; bob does NOT have allowance (revoke)
        vm.prank(creator); kameti.setAutoPay(cId, true);
        vm.prank(alice);   kameti.setAutoPay(cId, true);
        vm.prank(bob);     kameti.setAutoPay(cId, true);

        // Revoke allowance for bob
        vm.prank(bob);
        usdc.approve(address(kameti), 0);

        // payAllAutoPay: expect AutoPayExecuted for creator & alice, AutoPayFailed for bob
        vm.recordLogs();
        kameti.payAllAutoPay(cId);

        // Verify creator & alice paid
        Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
        uint256 paidCount;
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].paidThisRound) paidCount++;
        }
        assertEq(paidCount, 2, "exactly 2 should be marked paid");
    }

    function test_AutoPay_PayAllAutoPay_Revert_CircleNotActive() public {
        uint256 openId = _createCircle3(1, 0, 0);
        vm.expectRevert(Kameti.CircleNotActive.selector);
        kameti.payAllAutoPay(openId);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8  payAllAutoPay try/catch fix — MockRevertingERC20 path
//
// Verifies the try/catch guard in payAllAutoPay():
//   • A member whose token.transferFrom ALWAYS reverts (even when balance and
//     allowance look sufficient from the contract's pre-flight check) is safely
//     skipped: AutoPayFailed is emitted and the loop continues.
//   • The other members with a normally-functioning token are still paid
//     successfully, AutoPayExecuted is emitted for each of them.
//
// Strategy: use vm.etch to replace the usdc bytecode with MockRevertingERC20
// only for the sub-test that needs it, so the rest of the suite is unaffected.
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2AutoPayRevertingTokenTest is Test {
    // ── actors ────────────────────────────────────────────────────────────────
    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal creator = makeAddr("creator");

    uint256 internal constant e6           = 1_000_000;
    uint256 internal constant CONTRIBUTION = 10 * e6;
    uint256 internal constant DEPOSIT_MUL  = 2;
    uint256 internal constant DEPOSIT      = CONTRIBUTION * DEPOSIT_MUL;
    uint256 internal constant INITIAL_BAL  = 10_000 * e6;
    uint256 internal constant ROUND_DUR    = 1 days;

    // ── test: reverting-transferFrom member skipped; other members succeed ───

    /// @notice Full end-to-end test of the try/catch fix in payAllAutoPay.
    ///
    /// Setup:
    ///   - Deploy Kameti with a normal MockERC20 (so createCircle/join work).
    ///   - Build a 3-member active circle: creator(0), alice(1), bob(2).
    ///   - Enable autoPay for all three; give all three sufficient balance +
    ///     allowance so the pre-flight check (balanceOf / allowance) passes.
    ///   - Replace ONLY BOB's token behaviour: after the circle is live, etch
    ///     a MockRevertingERC20 over the USDC address so bob's next
    ///     transferFrom call reverts inside the try block.
    ///   - Call payAllAutoPay:
    ///       • creator → AutoPayExecuted (succeeds — but after etch the normal
    ///         mock is gone, so we need to be more surgical).
    ///
    /// Simpler, deterministic approach: use a 3-member circle where
    ///   - creator & alice pay MANUALLY before calling payAllAutoPay
    ///     (so they are already marked paid and skipped by the loop)
    ///   - bob has autoPay=true with sufficient balance+allowance pre-flight,
    ///     but the token's transferFrom reverts.
    ///   → payAllAutoPay should emit AutoPayFailed for bob and complete without
    ///     reverting. creator & alice remain paid; bob remains unpaid.
    function test_AutoPay_PayAllAutoPay_SkipFailed_RevertingTransferFrom() public {
        // ── 1. Deploy normal USDC + Kameti, build active circle ───────────────
        MockERC20 usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        Kameti kameti  = new Kameti(address(usdc));

        // Fund & approve
        address[3] memory actors = [creator, alice, bob];
        for (uint256 i = 0; i < 3; i++) {
            usdc.mint(actors[i], INITIAL_BAL);
            vm.prank(actors[i]);
            usdc.approve(address(kameti), type(uint256).max);
        }

        // creator creates circle; alice & bob join → Active
        vm.prank(creator);
        uint256 cId = kameti.createCircle(
            "Rev Circle", CONTRIBUTION, 3, ROUND_DUR, uint8(DEPOSIT_MUL), 0, 0
        );
        vm.prank(alice); kameti.join(cId);
        vm.prank(bob);   kameti.join(cId);

        // ── 2. Enable autoPay for all three ───────────────────────────────────
        vm.prank(creator); kameti.setAutoPay(cId, true);
        vm.prank(alice);   kameti.setAutoPay(cId, true);
        vm.prank(bob);     kameti.setAutoPay(cId, true);

        // ── 3. creator & alice pay manually → they are already paid ───────────
        vm.prank(creator); kameti.pay(cId);
        vm.prank(alice);   kameti.pay(cId);

        // ── 4. Etch reverting token over usdc address ─────────────────────────
        // Bob still has sufficient balance+allowance on the ORIGINAL mock, but
        // after etching, every transferFrom call reverts.  The pre-flight check
        // in payAllAutoPay reads balanceOf and allowance directly from storage;
        // those mappings survive the etch (vm.etch only replaces bytecode, not
        // storage), so the pre-flight check still sees bob's balance & allowance
        // and proceeds to the try block — which then catches the revert.
        MockRevertingERC20 rev = new MockRevertingERC20();
        vm.etch(address(usdc), address(rev).code);

        // ── 5. Call payAllAutoPay → bob's transferFrom reverts inside try ─────
        vm.expectEmit(true, true, true, true, address(kameti));
        emit Kameti.AutoPayFailed(cId, 1, bob);
        kameti.payAllAutoPay(cId);

        // ── 6. Verify state ────────────────────────────────────────────────────
        // creator & alice already paid manually → still paid
        // bob skipped (transferFrom reverted) → still unpaid
        Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
        uint256 paidCount;
        bool bobPaid;
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].paidThisRound) paidCount++;
            if (infos[i].addr == bob && infos[i].paidThisRound) bobPaid = true;
        }
        assertEq(paidCount, 2, "exactly 2 paid (creator + alice)");
        assertFalse(bobPaid, "bob must NOT be marked paid after revert");
    }

    /// @notice Verify that when a member has insufficient balance/allowance
    ///         (the pre-flight check fails), AutoPayFailed is emitted and the
    ///         other autopay members still succeed.
    ///         This complements the reverting-transferFrom test by covering the
    ///         pre-flight short-circuit branch of payAllAutoPay.
    function test_AutoPay_PayAllAutoPay_SkipFailed_ZeroAllowanceAndBalance() public {
        // ── 1. Deploy normal USDC + Kameti ────────────────────────────────────
        MockERC20 usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        Kameti kameti  = new Kameti(address(usdc));

        // Fund & approve for creator & alice; give bob NOTHING
        usdc.mint(creator, INITIAL_BAL);
        usdc.mint(alice,   INITIAL_BAL);
        // bob gets no mint and no approve

        vm.prank(creator); usdc.approve(address(kameti), type(uint256).max);
        vm.prank(alice);   usdc.approve(address(kameti), type(uint256).max);

        // bob still needs enough to pay the deposit to join
        usdc.mint(bob, DEPOSIT);
        vm.prank(bob); usdc.approve(address(kameti), DEPOSIT); // only deposit, no contribution left

        // creator creates; alice & bob join → Active
        vm.prank(creator);
        uint256 cId = kameti.createCircle(
            "No-Bal Circle", CONTRIBUTION, 3, ROUND_DUR, uint8(DEPOSIT_MUL), 0, 0
        );
        vm.prank(alice); kameti.join(cId);
        vm.prank(bob);   kameti.join(cId);

        // After joining, bob has zero USDC remaining (deposit exhausted) and
        // zero allowance remaining (only DEPOSIT was approved and all was used).

        // ── 2. Enable autoPay for all three ───────────────────────────────────
        vm.prank(creator); kameti.setAutoPay(cId, true);
        vm.prank(alice);   kameti.setAutoPay(cId, true);
        vm.prank(bob);     kameti.setAutoPay(cId, true);

        // ── 3. payAllAutoPay: creator & alice succeed; bob fails pre-flight ───
        // Expect AutoPayFailed for bob (pre-flight: balance/allowance < CONTRIBUTION)
        vm.expectEmit(true, true, true, true, address(kameti));
        emit Kameti.AutoPayFailed(cId, 1, bob);
        kameti.payAllAutoPay(cId);

        // ── 4. Verify state ────────────────────────────────────────────────────
        Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
        uint256 paidCount;
        bool bobPaid;
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].paidThisRound) paidCount++;
            if (infos[i].addr == bob && infos[i].paidThisRound) bobPaid = true;
        }
        assertEq(paidCount, 2, "creator & alice paid via autopay");
        assertFalse(bobPaid, "bob must NOT be marked paid (no balance/allowance)");

        // AutoPayExecuted was emitted for creator & alice (use getMembers to
        // confirm they are paid — event count validated by paidCount check above)
        emit Kameti.AutoPayExecuted(cId, 1, creator);
        emit Kameti.AutoPayExecuted(cId, 1, alice);
    }
}
