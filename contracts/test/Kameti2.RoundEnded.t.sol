// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Kameti2Base} from "./Kameti2.Base.t.sol";
import {Kameti} from "../Kameti.sol";

// ─────────────────────────────────────────────────────────────────────────────
// §18  RoundEnded fix — pay() reverts after deadline,
//      executeAutoPay() skips members whose deadline has passed (settlePath=false)
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
        _warpPastRound(cId);

        vm.prank(alice);
        vm.expectRevert(Kameti.RoundEnded.selector);
        kameti.pay(cId);
    }

    // ── test 2: executeAutoPay() after roundEnd skips silently ───────────────

    /// @dev Store authorizations for all members, then warp past roundEnd.
    ///      executeAutoPay (non-settle path) should silently skip because
    ///      block.timestamp >= roundEnd.  No ContributionPaid event, no state change.
    function test_ExecuteAutoPay_AfterRoundEnd_SkipsSilently() public {
        uint256 validBefore = block.timestamp + 2 days;

        // Store auths for all 4 members for round 1
        _storeAuth(creatorPk, creator, cId, 1, validBefore);
        _storeAuth(alicePk,   alice,   cId, 1, validBefore);
        _storeAuth(bobPk,     bob,     cId, 1, validBefore);
        _storeAuth(carolPk,   carol,   cId, 1, validBefore);

        // Warp past round end
        _warpPastRound(cId);

        uint256 contractBalBefore = usdc.balanceOf(address(kameti));

        // executeAutoPay: settlePath=false, so it skips members past deadline
        kameti.executeAutoPay(cId);

        // Contract balance unchanged
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
                "no member should be marked paid after executeAutoPay past roundEnd"
            );
        }

        (, , , , uint256 pot, ,) = kameti.getCircle(cId);
        assertEq(pot, 0, "potAccumulated must remain zero");
    }
}
