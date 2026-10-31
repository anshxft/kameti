// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, StdInvariant} from "forge-std/Test.sol";
import {Kameti} from "../Kameti.sol";
import {MockUSDC3009} from "../test-helpers/MockUSDC3009.sol";

// ─────────────────────────────────────────────────────────────────────────────
// §19  Extended invariant: same conservation law, EIP-3009 action set
//
//  Actions:
//   • pay                     — regular approve-based pay
//   • settle                  — settle the round
//   • warpTime                — advance time
//   • doWithdraw              — withdraw claimable
//   • placeBid                — ascending auction bid
//   • storeAuthForCurrentRound — store EIP-3009 auth for some members
//   • executeAutoPayHandler   — call executeAutoPay (try/catch)
//   • cancelAuthHandler       — cancel a random member's current-round nonce
//   • payWithAuthHandler      — payWithAuthorization for a random member
//
//  Invariant (unchanged):
//   usdc.balanceOf(kameti) == sumDeposits + potAccumulated + sumClaimable
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Handler that drives a 3-member circle with the EIP-3009 action set.
contract KametiHandler2 is StdInvariant, Test {

    // ── EIP-712 type hashes ───────────────────────────────────────────────────
    bytes32 private constant _RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 private constant _CANCEL_TYPEHASH = keccak256(
        "CancelAuthorization(address authorizer,bytes32 nonce)"
    );

    // ── immutables ────────────────────────────────────────────────────────────
    MockUSDC3009 public immutable usdc;
    Kameti        public immutable kameti;

    address public immutable creator_;
    address public immutable alice_;
    address public immutable bob_;

    uint256 internal immutable creatorPk_;
    uint256 internal immutable alicePk_;
    uint256 internal immutable bobPk_;

    uint256 public immutable circleId;

    // ── mutable state ─────────────────────────────────────────────────────────
    bool    public circleCompleted;
    address[] public allAddresses;

    // ── constants ─────────────────────────────────────────────────────────────
    uint256 internal constant CONTRIBUTION_ = 10e6;
    uint256 internal constant ROUND_DUR_    = 1 days;
    uint16  internal constant MAX_DISC_BPS_ = 3000;  // 30%
    uint256 internal constant N             = 3;

    // ─────────────────────────────────────────────────────────────────────────
    constructor(MockUSDC3009 _usdc, Kameti _kameti) {
        usdc   = _usdc;
        kameti = _kameti;

        (creator_, creatorPk_) = makeAddrAndKey("creator2");
        (alice_,   alicePk_)   = makeAddrAndKey("alice2");
        (bob_,     bobPk_)     = makeAddrAndKey("bob2");

        allAddresses.push(creator_);
        allAddresses.push(alice_);
        allAddresses.push(bob_);

        // Fund all three actors generously
        _usdc.mint(creator_, 500_000e6);
        _usdc.mint(alice_,   500_000e6);
        _usdc.mint(bob_,     500_000e6);

        // Grant max allowance to start with (for approve-based pay)
        vm.prank(creator_); _usdc.approve(address(_kameti), type(uint256).max);
        vm.prank(alice_);   _usdc.approve(address(_kameti), type(uint256).max);
        vm.prank(bob_);     _usdc.approve(address(_kameti), type(uint256).max);

        // Create & fill a 3-member circle (depositMul=1, maxDiscountBps=3000)
        vm.prank(creator_);
        circleId = _kameti.createCircle(
            "inv2", CONTRIBUTION_, 3, ROUND_DUR_, 1, MAX_DISC_BPS_, 0, 0, 0
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

    function _pk(uint8 idx) internal view returns (uint256) {
        uint8 i = idx % uint8(N);
        if (i == 0) return creatorPk_;
        if (i == 1) return alicePk_;
        return bobPk_;
    }

    function _signReceive(
        uint256 pk,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(abi.encode(
            _RECEIVE_TYPEHASH,
            from, to, value, validAfter, validBefore, nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function _signCancel(
        uint256 pk,
        address authorizer,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(abi.encode(_CANCEL_TYPEHASH, authorizer, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    // ── action: pay ───────────────────────────────────────────────────────────

    function pay(uint8 who) external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, , uint256 roundEnd, , ,) = kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;
        if (block.timestamp >= roundEnd) return;

        address m = _member(who);
        Kameti.MemberInfo[] memory infos = kameti.getMembers(circleId);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == m && infos[i].paidThisRound) return;
        }

        // Restore allowance if needed
        if (usdc.allowance(m, address(kameti)) < CONTRIBUTION_) {
            vm.prank(m);
            usdc.approve(address(kameti), type(uint256).max);
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

    // ── action: placeBid ─────────────────────────────────────────────────────

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

    // ── action: storeAuthForCurrentRound ─────────────────────────────────────
    /// @dev Randomly stores authorizations for some members (bitmask) for the
    ///      current round.

    function storeAuthForCurrentRound(uint8 memberMask) external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, uint8 currentRound, uint256 roundEnd, , ,) =
            kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;
        if (block.timestamp >= roundEnd) return;

        uint256 validBefore = block.timestamp + 2 days;

        for (uint8 i = 0; i < 3; i++) {
            if (((memberMask >> i) & 1) == 0) continue;
            address m = _member(i);
            uint256 pk = _pk(i);

            // Skip if already paid
            Kameti.MemberInfo[] memory infos = kameti.getMembers(circleId);
            bool alreadyPaid;
            for (uint256 j = 0; j < infos.length; j++) {
                if (infos[j].addr == m && infos[j].paidThisRound) { alreadyPaid = true; break; }
            }
            if (alreadyPaid) continue;

            bytes32 nonce = kameti.roundNonce(circleId, currentRound, m);

            // Skip if nonce already used
            if (usdc.authorizationState(m, nonce)) continue;

            (uint8 v, bytes32 r, bytes32 s) = _signReceive(
                pk, m, address(kameti), CONTRIBUTION_, 0, validBefore, nonce
            );

            uint8[]   memory rounds = new uint8[](1);
            uint256[] memory vbs    = new uint256[](1);
            uint8[]   memory vs     = new uint8[](1);
            bytes32[] memory rs     = new bytes32[](1);
            bytes32[] memory ss     = new bytes32[](1);
            rounds[0] = currentRound;
            vbs[0]    = validBefore;
            vs[0]     = v;
            rs[0]     = r;
            ss[0]     = s;

            vm.prank(m);
            try kameti.storeAuthorizations(circleId, rounds, vbs, vs, rs, ss) {} catch {}
        }
    }

    // ── action: executeAutoPayHandler ────────────────────────────────────────

    function executeAutoPayHandler() external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;
        try kameti.executeAutoPay(circleId) {} catch {}
    }

    // ── action: cancelAuthHandler ─────────────────────────────────────────────

    function cancelAuthHandler(uint8 who) external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, uint8 currentRound, , , ,) = kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;

        address m = _member(who);
        uint256 pk = _pk(who % 3);
        bytes32 nonce = kameti.roundNonce(circleId, currentRound, m);

        if (usdc.authorizationState(m, nonce)) return; // already used/cancelled

        (uint8 v, bytes32 r, bytes32 s) = _signCancel(pk, m, nonce);
        try usdc.cancelAuthorization(m, nonce, v, r, s) {} catch {}
    }

    // ── action: payWithAuthHandler ────────────────────────────────────────────

    function payWithAuthHandler(uint8 who) external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, uint8 currentRound, uint256 roundEnd, , ,) =
            kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;
        if (block.timestamp >= roundEnd) return;

        address m  = _member(who);
        uint256 pk = _pk(who % 3);

        Kameti.MemberInfo[] memory infos = kameti.getMembers(circleId);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == m && infos[i].paidThisRound) return;
        }

        bytes32 nonce = kameti.roundNonce(circleId, currentRound, m);
        if (usdc.authorizationState(m, nonce)) return;

        uint256 validBefore = block.timestamp + 2 days;
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(
            pk, m, address(kameti), CONTRIBUTION_, 0, validBefore, nonce
        );

        try kameti.payWithAuthorization(circleId, m, validBefore, v, r, s) {} catch {}
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

    /// @dev Sum post-win locks for all members of circleId.
    function sumPostWinLocks() external view returns (uint256 total) {
        for (uint256 i = 0; i < allAddresses.length; i++) {
            (, uint256 lockLeft,) = kameti.protectionOf(circleId, allAddresses[i]);
            total += lockLeft;
        }
    }

    // ── action: settleRoundHandler ────────────────────────────────────────────
    function settleRoundHandler() external {
        if (circleCompleted) return;
        (, Kameti.CircleStatus status, , , , ,) = kameti.getCircle(circleId);
        if (status != Kameti.CircleStatus.Active) return;
        try kameti.settleRound(circleId) {
            (, Kameti.CircleStatus s2, , , , ,) = kameti.getCircle(circleId);
            if (s2 == Kameti.CircleStatus.Completed) circleCompleted = true;
        } catch {}
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariant test contract
// ─────────────────────────────────────────────────────────────────────────────
contract KametiInvariantTest2 is Test {
    KametiHandler2 internal handler;
    MockUSDC3009   internal usdc;
    Kameti         internal kameti;

    function setUp() public {
        usdc    = new MockUSDC3009();
        kameti  = new Kameti(address(usdc), address(0));
        handler = new KametiHandler2(usdc, kameti);

        targetContract(address(handler));
    }

    /// @dev Total locks helper.
    function _totalLocks() internal view returns (uint256) {
        return handler.sumPostWinLocks();
    }

    /// @dev Contract USDC balance == locked deposits + post-win locks + pot accumulated + claimable.
    function invariant_ContractBalance_EqDeposits_PlusClaimable() public view {
        uint256 contractBal    = usdc.balanceOf(address(kameti));
        uint256 sumDeposits    = handler.sumDeposits();
        uint256 sumClaimable   = handler.sumClaimable();
        uint256 potAccumulated = handler.potAccumulated();
        uint256 totalLocks     = _totalLocks();
        assertEq(
            contractBal,
            sumDeposits + totalLocks + potAccumulated + sumClaimable,
            "invariant2: balance == deposits + locks + pot + claimable"
        );
    }
}
