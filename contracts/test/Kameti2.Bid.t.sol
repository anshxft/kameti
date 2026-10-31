// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Kameti2Base} from "./Kameti2.Base.t.sol";
import {Kameti} from "../Kameti.sol";
import {MockUSDC3009} from "../test-helpers/MockUSDC3009.sol";

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
        _warpPastRound(fresh);
        kameti.settleRound(fresh);

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
        uint256 tooLow = MIN_STEP - 1;
        if (tooLow == 0) tooLow = 0;

        vm.prank(alice);
        vm.expectRevert(Kameti.BidTooLow.selector);
        kameti.placeBid(cId, tooLow);
    }

    function test_BidRevert_BidTooLow_BelowCurrentHighest() public {
        uint256 bid1 = MIN_STEP + 1;
        vm.prank(alice); kameti.placeBid(cId, bid1);

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
