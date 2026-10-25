// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Kameti2Base} from "./Kameti2.Base.t.sol";
import {Kameti} from "../Kameti.sol";

// ─────────────────────────────────────────────────────────────────────────────
// §18  RoundEnded fix — pay() reverts, payAllAutoPay() skips silently
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2RoundEndedTest is Kameti2Base {

    uint256 internal cId;

    function setUp() public override {
        super.setUp();
        // Full 4-member circle: creator, alice, bob, carol.  Circle is Active.
        cId = _fullActive4();
    }

    // ── test 1: pay() after roundEnd must revert with RoundEnded() ────────────

    /// @dev Warp past the round deadline, then call pay() → expect RoundEnded().
    function test_Pay_AfterRoundEnd_Reverts() public {
        // Advance time past the round end
        _warpPastRound(cId);

        vm.prank(alice);
        vm.expectRevert(Kameti.RoundEnded.selector);
        kameti.pay(cId);
    }

    // ── test 2: payAllAutoPay() after roundEnd must return silently ──────────

    /// @dev All members join with autopay ON and full allowance (already set in
    ///      setUp via type(uint256).max approve).  After warping past roundEnd,
    ///      payAllAutoPay() should return without reverting, no member should
    ///      show paidThisRound = true, and no ContributionPaid event is emitted.
    function test_PayAllAutoPay_AfterRoundEnd_SkipsSilently() public {
        // Enable autopay for all four members
        address[4] memory members = [creator, alice, bob, carol];
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(members[i]);
            kameti.setAutoPay(cId, true);
        }

        // Warp past the round end
        _warpPastRound(cId);

        // Expect NO ContributionPaid events for any member.
        // We record event expectations that must NOT fire by asserting
        // member states after the call instead (forge has no "expect no emit").
        uint256 contractBalBefore = usdc.balanceOf(address(kameti));

        // This must not revert
        kameti.payAllAutoPay(cId);

        // Contract balance unchanged — no contributions pulled
        assertEq(
            usdc.balanceOf(address(kameti)),
            contractBalBefore,
            "contract balance must not change after round ended"
        );

        // No member should be marked paid
        Kameti.MemberInfo[] memory infos = kameti.getMembers(cId);
        for (uint256 i = 0; i < infos.length; i++) {
            assertFalse(
                infos[i].paidThisRound,
                "no member should be marked paid after payAllAutoPay past roundEnd"
            );
        }

        // potAccumulated must still be zero
        (, , , , uint256 pot, ,) = kameti.getCircle(cId);
        assertEq(pot, 0, "potAccumulated must remain zero");
    }
}
