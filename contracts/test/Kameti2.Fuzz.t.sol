// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Kameti2Base} from "./Kameti2.Base.t.sol";
import {Kameti} from "../Kameti.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {Test, StdInvariant} from "forge-std/Test.sol";

// ─────────────────────────────────────────────────────────────────────────────
// §16 Fuzz tests
// ─────────────────────────────────────────────────────────────────────────────
contract Kameti2FuzzTest is Kameti2Base {

    /// @dev createCircle accepts any contribution in [1, 1e12] and maxMembers in [3,10].
    function testFuzz_CreateCircle_ValidParams(
        uint256 contribution,
        uint8   maxMembers,
        uint8   depositMul,
        uint16  maxDiscBps
    ) public {
        contribution = bound(contribution, 1, 1e12);
        maxMembers   = uint8(bound(uint256(maxMembers), 3, 10));
        depositMul   = uint8(bound(uint256(depositMul), 1, 3));
        maxDiscBps   = uint16(bound(uint256(maxDiscBps), 0, 4000));

        uint256 depositNeeded = contribution * depositMul;
        usdc.mint(creator, depositNeeded);

        vm.prank(creator);
        uint256 id = kameti.createCircle(
            "fuzz", contribution, maxMembers, ROUND_DUR, depositMul, maxDiscBps, 0, 0, 0
        );

        (Kameti.CircleParams memory p, Kameti.CircleStatus st, , , , ,) = kameti.getCircle(id);
        assertEq(p.contribution,      contribution);
        assertEq(p.maxMembers,        maxMembers);
        assertEq(uint8(st),           uint8(Kameti.CircleStatus.Open));
        assertEq(p.depositMultiplier, depositMul);
        assertEq(p.maxDiscountBps,    maxDiscBps);
    }

    /// @dev Fuzz bid amounts: any discount in [minStep, cap] from first bidder should be accepted.
    function testFuzz_PlaceBid_ValidDiscount(uint256 discount) public {
        uint256 cId = _fullActive4();
        _allPay4(cId);

        uint256 pot      = CONTRIBUTION * 4;
        uint256 minStep  = pot / 100;
        uint256 cap      = (pot * MAX_DISC_BPS) / 10000;

        if (minStep == 0) minStep = 1;
        discount = bound(discount, minStep, cap);

        vm.prank(alice);
        kameti.placeBid(cId, discount); // should not revert

        (, , , , , , uint256 highestDiscount) = kameti.getCircle(cId);
        assertEq(highestDiscount, discount);
    }

    /// @dev createCircle rejects maxMembers outside [3,10].
    function testFuzz_CreateCircle_Revert_InvalidMaxMembers(uint8 badMembers) public {
        vm.assume(badMembers < 3 || badMembers > 10);
        vm.prank(creator);
        vm.expectRevert(Kameti.InvalidParams.selector);
        kameti.createCircle("fuzz-bad", CONTRIBUTION, badMembers, ROUND_DUR, 1, 0, 0, 0, 0);
    }

    /// @dev createCircle rejects depositMultiplier outside [1,3].
    function testFuzz_CreateCircle_Revert_InvalidDepositMul(uint8 badMul) public {
        vm.assume(badMul == 0 || badMul > 3);
        vm.prank(creator);
        vm.expectRevert(Kameti.InvalidParams.selector);
        kameti.createCircle("fuzz-bad", CONTRIBUTION, 3, ROUND_DUR, badMul, 0, 0, 0, 0);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// §15 Invariant: contract USDC balance == sum(deposits) + sum(claimable)
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Plain (non-Test) handler that drives operations on one 3-member circle.
///      All cheatcodes are called via the Vm interface stored at the forge address.
contract KametiHandler is StdInvariant, Test {
    MockERC20 public immutable usdc;
    Kameti    public immutable kameti;

    address public immutable creator_;
    address public immutable alice_;
    address public immutable bob_;

    uint256 public immutable circleId;
    bool    public circleCompleted;

    address[] public allAddresses;

    uint256 internal constant CONTRIBUTION_ = 10e6;
    uint256 internal constant ROUND_DUR_    = 1 days;

    constructor(MockERC20 _usdc, Kameti _kameti) {
        usdc   = _usdc;
        kameti = _kameti;

        creator_ = makeAddr("creator");
        alice_   = makeAddr("alice");
        bob_     = makeAddr("bob");

        allAddresses.push(creator_);
        allAddresses.push(alice_);
        allAddresses.push(bob_);

        // Fund & approve
        _usdc.mint(creator_, 100_000e6);
        _usdc.mint(alice_,   100_000e6);
        _usdc.mint(bob_,     100_000e6);

        vm.prank(creator_);
        _usdc.approve(address(_kameti), type(uint256).max);
        vm.prank(alice_);
        _usdc.approve(address(_kameti), type(uint256).max);
        vm.prank(bob_);
        _usdc.approve(address(_kameti), type(uint256).max);

        // Create & fill 3-member circle with depositMul=1
        vm.prank(creator_);
        circleId = _kameti.createCircle("inv", CONTRIBUTION_, 3, ROUND_DUR_, 1, 0, 0, 0, 0);

        vm.prank(alice_);
        _kameti.join(circleId);
        vm.prank(bob_);
        _kameti.join(circleId);
        // Circle is Active now
    }

    function _member(uint8 idx) internal view returns (address) {
        if (idx % 3 == 0) return creator_;
        if (idx % 3 == 1) return alice_;
        return bob_;
    }

    function pay(uint8 who) external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;
        address m = _member(who);
        Kameti.MemberInfo[] memory infos = kameti.getMembers(circleId);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == m && infos[i].paidThisRound) return;
        }
        vm.prank(m);
        try kameti.pay(circleId) {} catch {}
    }

    function settle() external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;
        try kameti.settleRound(circleId) {
            (, Kameti.CircleStatus s2, , , , ,) = kameti.getCircle(circleId);
            if (s2 == Kameti.CircleStatus.Completed) circleCompleted = true;
        } catch {}
    }

    function warpTime(uint256 secs) external {
        secs = bound(secs, 0, 2 days);
        vm.warp(block.timestamp + secs);
    }

    function doWithdraw(uint8 who) external {
        address m = _member(who);
        if (kameti.claimable(m) == 0) return;
        vm.prank(m);
        try kameti.withdraw() {} catch {}
    }

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

    /// @dev Accumulated pot for the current round (paid contributions not yet settled).
    function potAccumulated() external view returns (uint256) {
        (, , , , uint256 pot, ,) = kameti.getCircle(circleId);
        return pot;
    }
}

contract KametiInvariantTest is Test {
    KametiHandler internal handler;
    MockERC20     internal usdc;
    Kameti        internal kameti;

    function setUp() public {
        usdc   = new MockERC20("Mock USDC", "mUSDC", 6);
        kameti = new Kameti(address(usdc), address(0));
        handler = new KametiHandler(usdc, kameti);

        targetContract(address(handler));
    }

    /// @dev USDC balance of contract == locked deposits + current pot + claimable.
    function invariant_ContractBalance_EqDeposits_PlusClaimable() public view {
        uint256 contractBal     = usdc.balanceOf(address(kameti));
        uint256 sumDeposits     = handler.sumDeposits();
        uint256 sumClaimable    = handler.sumClaimable();
        uint256 potAccumulated  = handler.potAccumulated();
        assertEq(contractBal, sumDeposits + potAccumulated + sumClaimable,
            "invariant: balance == deposits + pot + claimable");
    }
}
