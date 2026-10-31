// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Kameti} from "../Kameti.sol";
import {MockUSDC3009} from "../test-helpers/MockUSDC3009.sol";

/// @dev Shared base for all Kameti v3 tests.
abstract contract Kameti2Base is Test {

    // ── actors (addresses + private keys for EIP-3009 signing) ──────────────────
    uint256 internal alicePk;
    uint256 internal bobPk;
    uint256 internal carolPk;
    uint256 internal creatorPk;
    uint256 internal davePk;

    address internal alice;
    address internal bob;
    address internal carol;
    address internal dave;
    address internal creator;

    // ── token & contract ─────────────────────────────────────────────────────────
    MockUSDC3009 internal usdc;
    Kameti        internal kameti;

    // ── constants ─────────────────────────────────────────────────────────────────
    uint256 internal constant e6           = 1_000_000;
    uint256 internal constant CONTRIBUTION = 10 * e6;   // 10 USDC
    uint8   internal constant MAX_MEMBERS  = 4;
    uint256 internal constant ROUND_DUR    = 1 days;
    uint8   internal constant DEPOSIT_MUL  = 2;
    uint16  internal constant MAX_DISC_BPS = 3000;       // 30%
    uint16  internal constant MIN_SCORE    = 0;
    string  internal constant CIRCLE_NAME  = "Test Circle";
    uint256 internal constant INITIAL_BAL  = 10_000 * e6;

    // deposit = contribution * depositMultiplier
    uint256 internal constant DEPOSIT = CONTRIBUTION * DEPOSIT_MUL;

    // ── setUp ─────────────────────────────────────────────────────────────────────
    function setUp() public virtual {
        // Derive addresses and private keys for EIP-3009 signing
        (alice,   alicePk)   = makeAddrAndKey("alice");
        (bob,     bobPk)     = makeAddrAndKey("bob");
        (carol,   carolPk)   = makeAddrAndKey("carol");
        (dave,    davePk)    = makeAddrAndKey("dave");
        (creator, creatorPk) = makeAddrAndKey("creator");

        usdc   = new MockUSDC3009();
        kameti = new Kameti(address(usdc), address(0));

        address[5] memory actors = [alice, bob, carol, dave, creator];
        for (uint256 i = 0; i < actors.length; i++) {
            usdc.mint(actors[i], INITIAL_BAL);
            // Approve for the approve-based join()/pay() tests
            vm.prank(actors[i]);
            usdc.approve(address(kameti), type(uint256).max);
        }
    }

    // ── helpers ───────────────────────────────────────────────────────────────────

    /// @dev Create a 4-member circle with default params; creator pays deposit.
    function _createCircle4() internal returns (uint256 id) {
        vm.prank(creator);
        id = kameti.createCircle(
            CIRCLE_NAME,
            CONTRIBUTION,
            MAX_MEMBERS,
            ROUND_DUR,
            DEPOSIT_MUL,
            MAX_DISC_BPS,
            MIN_SCORE,
            0,   // postWinLockBps=0 keeps v2-era arithmetic exact
            0    // keeperTipBps=0 keeps v2-era arithmetic exact
        );
    }

    /// @dev Create a 3-member circle with given params.
    function _createCircle3(
        uint8  depositMul,
        uint16 maxDiscBps,
        uint16 minScore
    ) internal returns (uint256 id) {
        vm.prank(creator);
        id = kameti.createCircle(
            CIRCLE_NAME,
            CONTRIBUTION,
            3,
            ROUND_DUR,
            depositMul,
            maxDiscBps,
            minScore,
            0,   // postWinLockBps=0
            0    // keeperTipBps=0
        );
    }

    /// @dev Have `who` join `id` (deposit pre-approved via setUp).
    function _join(address who, uint256 id) internal {
        vm.prank(who);
        kameti.join(id);
    }

    /// @dev All 4 members pay for round; members = [creator, alice, bob, carol].
    function _allPay4(uint256 id) internal {
        address[4] memory m = [creator, alice, bob, carol];
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(m[i]);
            kameti.pay(id);
        }
    }

    /// @dev All 3 members pay for a 3-member circle.
    function _allPay3(uint256 id, address[3] memory members) internal {
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(members[i]);
            kameti.pay(id);
        }
    }

    /// @dev Build a fully-active 4-member circle (creator,alice,bob,carol).
    function _fullActive4() internal returns (uint256 id) {
        id = _createCircle4();
        _join(alice,  id);
        _join(bob,    id);
        _join(carol,  id);
        // Circle is now Active (4/4 joined)
    }

    /// @dev Build a fully-active 3-member circle (creator,alice,bob).
    function _fullActive3() internal returns (uint256 id) {
        id = _createCircle3(DEPOSIT_MUL, MAX_DISC_BPS, MIN_SCORE);
        _join(alice, id);
        _join(bob,   id);
    }

    /// @dev Warp past the current roundEnd for circle `id`.
    function _warpPastRound(uint256 id) internal {
        (, , , uint256 roundEnd, , ,) = kameti.getCircle(id);
        vm.warp(roundEnd + 1);
    }

    /// @dev Members array for 4-member circle.
    function _members4() internal view returns (address[4] memory) {
        return [creator, alice, bob, carol];
    }

    /// @dev Sum claimable for all members of a 4-member circle.
    function _totalClaimable4() internal view returns (uint256 total) {
        address[4] memory m = _members4();
        for (uint256 i = 0; i < 4; i++) {
            total += kameti.claimable(m[i]);
        }
    }

    /// @dev Withdraw for all members and return total withdrawn.
    function _withdrawAll4() internal returns (uint256 total) {
        address[4] memory m = _members4();
        for (uint256 i = 0; i < 4; i++) {
            uint256 c = kameti.claimable(m[i]);
            if (c > 0) {
                uint256 before = usdc.balanceOf(m[i]);
                vm.prank(m[i]);
                kameti.withdraw();
                total += usdc.balanceOf(m[i]) - before;
            }
        }
    }

    // ── EIP-3009 signing helpers ──────────────────────────────────────────────────

    /// @dev Sign a ReceiveWithAuthorization for the round-contribution nonce.
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
            keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
            from, to, value, validAfter, validBefore, nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    /// @dev Sign a CancelAuthorization.
    function _signCancel(
        uint256 pk,
        address authorizer,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(abi.encode(
            keccak256("CancelAuthorization(address authorizer,bytes32 nonce)"),
            authorizer, nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    /// @dev Store authorization for `member` (via `pk`) for `round` in `circleId`.
    function _storeAuth(
        uint256 pk,
        address member,
        uint256 circleId,
        uint8   round,
        uint256 validBefore
    ) internal {
        bytes32 nonce = kameti.roundNonce(circleId, round, member);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(
            pk, member, address(kameti), CONTRIBUTION, 0, validBefore, nonce
        );
        uint8[]   memory rounds = new uint8[](1);
        uint256[] memory vbs    = new uint256[](1);
        uint8[]   memory vs     = new uint8[](1);
        bytes32[] memory rs     = new bytes32[](1);
        bytes32[] memory ss     = new bytes32[](1);
        rounds[0] = round;
        vbs[0]    = validBefore;
        vs[0]     = v;
        rs[0]     = r;
        ss[0]     = s;
        vm.prank(member);
        kameti.storeAuthorizations(circleId, rounds, vbs, vs, rs, ss);
    }
}
