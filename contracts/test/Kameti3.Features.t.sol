// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Kameti} from "../Kameti.sol";
import {IKametiScore} from "../IKametiScore.sol";
import {MockUSDC3009} from "../test-helpers/MockUSDC3009.sol";
import {MockPQPrecompile} from "../test-helpers/MockPQPrecompile.sol";
import {MockPQAlwaysFalse} from "../test-helpers/MockPQAlwaysFalse.sol";
import {MockPQRevert} from "../test-helpers/MockPQRevert.sol";
import {MockPQEmptyReturn} from "../test-helpers/MockPQEmptyReturn.sol";
import {MockPQShortReturn} from "../test-helpers/MockPQShortReturn.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Shared base for all Feature tests
// ─────────────────────────────────────────────────────────────────────────────
abstract contract FeatBase is Test {
    uint256 internal alicePk;
    uint256 internal bobPk;
    uint256 internal carolPk;
    uint256 internal davePk;
    uint256 internal creatorPk;

    address internal alice;
    address internal bob;
    address internal carol;
    address internal dave;
    address internal creator;

    MockUSDC3009 internal usdc;
    Kameti        internal kameti;

    uint256 internal constant e6           = 1_000_000;
    uint256 internal constant CONTRIBUTION = 10 * e6;
    uint256 internal constant INITIAL_BAL  = 1_000_000 * e6;
    uint256 internal constant ROUND_DUR    = 1 days;

    address internal constant PQ_PRECOMPILE = 0x1800000000000000000000000000000000000004;
    uint256 internal constant PQ_SIG_LEN    = 7856;

    function setUp() public virtual {
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
            vm.prank(actors[i]);
            usdc.approve(address(kameti), type(uint256).max);
        }
    }

    // ── circle helpers ─────────────────────────────────────────────────────────

    /// @dev 3-member circle: creator(seat1), alice(seat2), bob(seat3)
    function _active3(
        uint16 postWinLockBps,
        uint8  keeperTipBps,
        uint256 contribution,
        uint8   depositMul
    ) internal returns (uint256 id) {
        vm.prank(creator);
        id = kameti.createCircle(
            "test", contribution, 3, ROUND_DUR, depositMul, 0, 0, postWinLockBps, keeperTipBps
        );
        vm.prank(alice); kameti.join(id);
        vm.prank(bob);   kameti.join(id);
    }

    /// @dev 5-member circle: creator(1), alice(2), bob(3), carol(4), dave(5)
    function _active5(
        uint16 postWinLockBps,
        uint8  keeperTipBps,
        uint256 contribution,
        uint8   depositMul
    ) internal returns (uint256 id) {
        vm.prank(creator);
        id = kameti.createCircle(
            "test5", contribution, 5, ROUND_DUR, depositMul, 0, 0, postWinLockBps, keeperTipBps
        );
        vm.prank(alice); kameti.join(id);
        vm.prank(bob);   kameti.join(id);
        vm.prank(carol); kameti.join(id);
        vm.prank(dave);  kameti.join(id);
    }

    function _warpPast(uint256 id) internal {
        (, , , uint256 roundEnd, , ,) = kameti.getCircle(id);
        vm.warp(roundEnd + 1);
    }

    function _allPay3(uint256 id) internal {
        vm.prank(creator); kameti.pay(id);
        vm.prank(alice);   kameti.pay(id);
        vm.prank(bob);     kameti.pay(id);
    }

    function _allPay5(uint256 id) internal {
        vm.prank(creator); kameti.pay(id);
        vm.prank(alice);   kameti.pay(id);
        vm.prank(bob);     kameti.pay(id);
        vm.prank(carol);   kameti.pay(id);
        vm.prank(dave);    kameti.pay(id);
    }

    // ── EIP-3009 helpers ───────────────────────────────────────────────────────

    function _signReceive(
        uint256 pk,
        address from,
        uint256 value,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(abi.encode(
            keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
            from, address(kameti), value, uint256(0), validBefore, nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function _storeAuth(uint256 pk, address member, uint256 id, uint8 round, uint256 validBefore) internal {
        bytes32 nonce = kameti.roundNonce(id, round, member);
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(pk, member, CONTRIBUTION, validBefore, nonce);
        uint8[]   memory rounds = new uint8[](1);
        uint256[] memory vbs    = new uint256[](1);
        uint8[]   memory vs     = new uint8[](1);
        bytes32[] memory rs     = new bytes32[](1);
        bytes32[] memory ss     = new bytes32[](1);
        rounds[0] = round; vbs[0] = validBefore; vs[0] = v; rs[0] = r; ss[0] = s;
        vm.prank(member);
        kameti.storeAuthorizations(id, rounds, vbs, vs, rs, ss);
    }

    function _storeAuthAmount(
        uint256 pk, address member, uint256 id, uint8 round,
        uint256 validBefore, uint256 amount
    ) internal {
        bytes32 nonce = kameti.roundNonce(id, round, member);
        bytes32 structHash = keccak256(abi.encode(
            keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
            member, address(kameti), amount, uint256(0), validBefore, nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        uint8[]   memory rounds = new uint8[](1);
        uint256[] memory vbs    = new uint256[](1);
        uint8[]   memory vs     = new uint8[](1);
        bytes32[] memory rs     = new bytes32[](1);
        bytes32[] memory ss     = new bytes32[](1);
        rounds[0] = round; vbs[0] = validBefore; vs[0] = v; rs[0] = r; ss[0] = s;
        vm.prank(member);
        kameti.storeAuthorizations(id, rounds, vbs, vs, rs, ss);
    }

    // ── PQ helpers ─────────────────────────────────────────────────────────────

    function _pqSig() internal pure returns (bytes memory sig) {
        sig = new bytes(PQ_SIG_LEN);
    }

    function _pqWithdrawMsg(
        address member, address to, uint256 amount, uint256 nonce
    ) internal view returns (bytes memory) {
        return abi.encodePacked(
            keccak256(abi.encode(
                "KAMETI_PQ_WITHDRAW",
                block.chainid, address(kameti), member, to, amount, nonce
            ))
        );
    }

    function _pqChangeMsg(
        address member, bytes32 newVk, uint256 newLimit, uint256 nonce
    ) internal view returns (bytes memory) {
        return abi.encodePacked(
            keccak256(abi.encode(
                "KAMETI_PQ_CHANGE",
                block.chainid, address(kameti), member, newVk, newLimit, nonce
            ))
        );
    }

    function _pqDisableMsg(address member, uint256 nonce) internal view returns (bytes memory) {
        return abi.encodePacked(
            keccak256(abi.encode(
                "KAMETI_PQ_DISABLE",
                block.chainid, address(kameti), member, nonce
            ))
        );
    }

    function _pqCancelDisableMsg(address member, uint256 nonce) internal view returns (bytes memory) {
        return abi.encodePacked(
            keccak256(abi.encode(
                "KAMETI_PQ_CANCEL_DISABLE",
                block.chainid, address(kameti), member, nonce
            ))
        );
    }

    function _etchAndRegister(
        MockPQPrecompile mock,
        bytes32 vk,
        bytes memory message,
        bytes memory sig
    ) internal {
        vm.etch(PQ_PRECOMPILE, address(mock).code);
        MockPQPrecompile(PQ_PRECOMPILE).register(abi.encodePacked(vk), message, sig);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION A — Gas-griefing protection
// ═════════════════════════════════════════════════════════════════════════════
contract KametiGasGriefTest is FeatBase {

    uint256 id;

    function setUp() public override {
        super.setUp();
        // 3-member, keeperTipBps=0, postWinLockBps=0, depositMul=1
        id = _active3(0, 0, CONTRIBUTION, 1);
        // alice stores auth for round 1
        uint256 validBefore = block.timestamp + 2 days;
        _storeAuth(alicePk, alice, id, 1, validBefore);
        // warp past round end
        _warpPast(id);
    }

    function test_GasGrief_Revert_WithTightGas() public {
        // 100_000 gas is below AUTOPAY_MIN_GAS=120_000 → revert
        vm.expectRevert(Kameti.InsufficientGasForAutoPay.selector);
        kameti.settleRound{gas: 100_000}(id);

        // alice's paid flag and deposit must be unchanged
        Kameti.MemberInfo[] memory infos = kameti.getMembers(id);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == alice) {
                assertFalse(infos[i].paidThisRound, "alice must NOT be paid");
                assertEq(infos[i].depositLeft, CONTRIBUTION, "alice deposit must be intact");
            }
        }
    }

    function test_GasGrief_PassWithEnoughGas() public {
        // 2_000_000 gas is well above AUTOPAY_MIN_GAS → no revert
        kameti.settleRound{gas: 2_000_000}(id);

        // After settle, paidThisRound is reset. Alice was paid via autopay if:
        //   - she was NOT slashed (depositLeft unchanged = CONTRIBUTION)
        //   - she was NOT defaulted
        Kameti.MemberInfo[] memory infos = kameti.getMembers(id);
        for (uint256 i = 0; i < infos.length; i++) {
            if (infos[i].addr == alice) {
                assertFalse(infos[i].defaulted, "alice must NOT be defaulted (autopay succeeded)");
                assertEq(infos[i].depositLeft, CONTRIBUTION, "alice deposit intact (not slashed)");
            }
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION B — Post-win lock
// ═════════════════════════════════════════════════════════════════════════════
contract KametiPostWinLockTest is FeatBase {

    uint256 constant CONTR5   = 10 * 1e6; // 10 USDC
    uint16  constant PWL_BPS  = 5000;      // 50%
    uint8   constant DEP_MUL  = 1;

    // 5-member circle with postWinLockBps=5000, keeperTipBps=0
    uint256 id5;

    function setUp() public override {
        super.setUp();
        id5 = _active5(PWL_BPS, 0, CONTR5, DEP_MUL);
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    /// Settle round 1 of id5 with all 5 paying (creator wins - lowest seat)
    function _settle5R1() internal {
        _allPay5(id5);
        _warpPast(id5);
        kameti.settleRound(id5);
    }

    function test_PostWinLock_WinnerPayoutSplit() public {
        _settle5R1();
        // pot = 5×10 = 50 USDC
        // winnerDebt=0 → payout before lock = 50
        // remainingRounds = 5-1=4, maxLockBase=4×10=40
        // lockAmount = 40×5000/10000 = 20 (min(50,20)=20)
        // claimable[creator] = 50-20 = 30
        assertEq(kameti.claimable(creator), 30 * e6, "creator claimable should be 30");

        (uint256 depositLeft, uint256 lockLeft, uint256 futureObligation) =
            kameti.protectionOf(id5, creator);
        assertEq(depositLeft, CONTR5, "depositLeft should be 10");
        assertEq(lockLeft, 20 * e6, "lockLeft should be 20");
        assertEq(futureObligation, 40 * e6, "futureObligation should be 40");
    }

    function test_PostWinLock_ReleaseOnPay() public {
        _settle5R1();
        uint256 claimBefore = kameti.claimable(creator); // 30e6
        // creator pays round 2 via pay()
        vm.prank(creator);
        kameti.pay(id5);
        // release = 10×5000/10000 = 5e6. lockLeft 20→15, claimable 30→35
        assertEq(kameti.claimable(creator), claimBefore + 5 * e6, "claimable should be 35");
        (, uint256 lockLeft,) = kameti.protectionOf(id5, creator);
        assertEq(lockLeft, 15 * e6, "lockLeft should be 15");
    }

    function test_PostWinLock_ReleaseViaPayWithAuth() public {
        _settle5R1();
        // round 2 auth signed by creator
        (, , uint8 curRound, , , ,) = kameti.getCircle(id5);
        bytes32 nonce = kameti.roundNonce(id5, curRound, creator);
        uint256 validBefore = block.timestamp + 2 days;
        bytes32 structHash = keccak256(abi.encode(
            keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
            creator, address(kameti), CONTR5, uint256(0), validBefore, nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(creatorPk, digest);
        // bob relays
        vm.prank(bob);
        kameti.payWithAuthorization(id5, creator, validBefore, v, r, s);
        // 5e6 released
        assertEq(kameti.claimable(creator), 35 * e6, "claimable should be 35 after payWithAuth");
        (, uint256 lockLeft,) = kameti.protectionOf(id5, creator);
        assertEq(lockLeft, 15 * e6, "lockLeft should be 15 after payWithAuth");
    }

    function test_PostWinLock_ReleaseViaAutoPay() public {
        _settle5R1();
        (, , uint8 curRound, , , ,) = kameti.getCircle(id5);
        uint256 validBefore = block.timestamp + 2 days;
        _storeAuth(creatorPk, creator, id5, curRound, validBefore);
        vm.prank(bob);
        kameti.executeAutoPay(id5);
        // 5e6 released
        assertEq(kameti.claimable(creator), 35 * e6, "claimable should be 35 after autopay");
        (, uint256 lockLeft,) = kameti.protectionOf(id5, creator);
        assertEq(lockLeft, 15 * e6, "lockLeft should be 15 after autopay");
    }

    function test_PostWinLock_LockFirstThenDeposit() public {
        _settle5R1();
        // creator does NOT pay round 2; settleRound slashes
        _warpPast(id5);
        kameti.settleRound(id5);
        // lock covers 10 first: lock 20→10, deposit untouched
        (uint256 depositLeft, uint256 lockLeft,) = kameti.protectionOf(id5, creator);
        assertEq(lockLeft, 10 * e6, "lockLeft should be 10 after lock-slash");
        assertEq(depositLeft, CONTR5, "depositLeft should still be 10");
        // strike (shortfall=0 after lock covers it)
        IKametiScore.ScoreStats memory stats = kameti.statsOf(creator);
        assertGt(stats.strikes, 0, "creator should have a strike");
    }

    function test_PostWinLock_LockExhaustedThenDeposit() public {
        _settle5R1();
        // lock=20, deposit=10
        // Round 2: creator misses, lock covers 10, lock→10. Others pay before deadline.
        vm.prank(alice); kameti.pay(id5);
        vm.prank(bob);   kameti.pay(id5);
        vm.prank(carol); kameti.pay(id5);
        vm.prank(dave);  kameti.pay(id5);
        _warpPast(id5);
        kameti.settleRound(id5);
        (, uint256 lock2,) = kameti.protectionOf(id5, creator);
        assertEq(lock2, 10 * e6, "lock after r2 miss = 10");

        // Round 3: creator misses, lock covers 10, lock→0
        vm.prank(alice); kameti.pay(id5);
        vm.prank(bob);   kameti.pay(id5);
        vm.prank(carol); kameti.pay(id5);
        vm.prank(dave);  kameti.pay(id5);
        _warpPast(id5);
        kameti.settleRound(id5);
        (uint256 dep3, uint256 lock3,) = kameti.protectionOf(id5, creator);
        assertEq(lock3, 0, "lock after r3 miss = 0");
        assertEq(dep3, CONTR5, "deposit still 10 after lock exhausted");

        // Round 4: creator misses, deposit covers 10, deposit→0
        vm.prank(alice); kameti.pay(id5);
        vm.prank(bob);   kameti.pay(id5);
        vm.prank(carol); kameti.pay(id5);
        vm.prank(dave);  kameti.pay(id5);
        _warpPast(id5);
        kameti.settleRound(id5);
        (uint256 dep4, uint256 lock4,) = kameti.protectionOf(id5, creator);
        assertEq(lock4, 0, "lock after r4 miss = 0");
        assertEq(dep4, 0, "deposit = 0 after r4 miss");
        // 3 missed rounds: all covered by lock/deposit → 3 strikes, 0 defaults
        IKametiScore.ScoreStats memory stats4 = kameti.statsOf(creator);
        assertEq(stats4.defaults, 0, "no defaults yet after 3 missed rounds");

        // Round 5: misses, deposit=0, lock=0, shortfall=10 → defaulted
        vm.prank(alice); kameti.pay(id5);
        vm.prank(bob);   kameti.pay(id5);
        vm.prank(carol); kameti.pay(id5);
        vm.prank(dave);  kameti.pay(id5);
        _warpPast(id5);
        kameti.settleRound(id5);
        IKametiScore.ScoreStats memory stats5 = kameti.statsOf(creator);
        assertGt(stats5.defaults, 0, "creator must be defaulted after r5 miss with no funds");
    }

    function test_PostWinLock_CompletionRelease() public {
        // run all 5 rounds: all pay; each round's winner gets lock
        for (uint8 r = 1; r <= 5; r++) {
            _allPay5(id5);
            _warpPast(id5);
            kameti.settleRound(id5);
        }
        // circle completed: all remaining locks released
        (,uint256 lockC,) = kameti.protectionOf(id5, creator);
        (,uint256 lockA,) = kameti.protectionOf(id5, alice);
        (,uint256 lockB,) = kameti.protectionOf(id5, bob);
        (,uint256 lockCr,) = kameti.protectionOf(id5, carol);
        (,uint256 lockD,) = kameti.protectionOf(id5, dave);
        assertEq(lockC + lockA + lockB + lockCr + lockD, 0, "all locks released on completion");
    }

    function test_PostWinLock_ZeroBps() public {
        uint256 idZ = _active5(0, 0, CONTR5, 1);
        vm.prank(creator); kameti.pay(idZ);
        vm.prank(alice);   kameti.pay(idZ);
        vm.prank(bob);     kameti.pay(idZ);
        vm.prank(carol);   kameti.pay(idZ);
        vm.prank(dave);    kameti.pay(idZ);
        _warpPast(idZ);
        kameti.settleRound(idZ);
        // pot = 50, lockBps=0 → lock=0, payout=50
        (,uint256 lockLeft,) = kameti.protectionOf(idZ, creator);
        assertEq(lockLeft, 0, "zero bps: no lock");
        assertEq(kameti.claimable(creator), 50 * e6, "zero bps: full payout");
    }

    function test_PostWinLock_ProtectionOf() public {
        _settle5R1();
        (uint256 depositLeft, uint256 lockLeft, uint256 futureObligation) =
            kameti.protectionOf(id5, creator);
        assertEq(depositLeft, 10 * e6, "depositLeft=10");
        assertEq(lockLeft, 20 * e6, "lockLeft=20");
        assertEq(futureObligation, 40 * e6, "futureObligation=40");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION C — Keeper tip
// ═════════════════════════════════════════════════════════════════════════════
contract KametiKeeperTipTest is FeatBase {

    function test_KeeperTip_Amount() public {
        // 3-member, contribution=100 USDC, keeperTipBps=10 (0.1%), postWinLockBps=0
        uint256 id = _active3(0, 10, 100 * e6, 1);
        _allPay3(id);
        _warpPast(id);
        // alice is the keeper (calls settleRound)
        uint256 aliceClaimBefore = kameti.claimable(alice);
        vm.expectEmit(true, true, true, true, address(kameti));
        emit Kameti.KeeperTipped(id, 1, alice, 50_000);
        vm.prank(alice);
        kameti.settleRound(id);
        // tip = min(300e6*10/10000, 50_000) = min(300_000, 50_000) = 50_000
        uint256 aliceClaimAfter = kameti.claimable(alice);
        assertGe(aliceClaimAfter, aliceClaimBefore + 50_000, "alice claimable should include tip");
        assertEq(kameti.totalKeeperTips(), 50_000, "totalKeeperTips should be 50_000");
    }

    function test_KeeperTip_BelowCap() public {
        // 3-member, contribution=1 USDC, keeperTipBps=10
        uint256 id = _active3(0, 10, 1 * e6, 1);
        _allPay3(id);
        _warpPast(id);
        // tip = min(3e6*10/10000, 50_000) = min(3_000, 50_000) = 3_000
        vm.expectEmit(true, true, true, true, address(kameti));
        emit Kameti.KeeperTipped(id, 1, alice, 3_000);
        vm.prank(alice);
        kameti.settleRound(id);
        assertEq(kameti.totalKeeperTips(), 3_000, "totalKeeperTips should be 3_000");
    }

    function test_KeeperTip_ZeroBps() public {
        uint256 id = _active3(0, 0, CONTRIBUTION, 1);
        _allPay3(id);
        _warpPast(id);
        // No KeeperTipped event. totalKeeperTips stays 0.
        // With keeperTipBps=0 no KeeperTipped event; totalKeeperTips stays 0.
        kameti.settleRound(id);
        assertEq(kameti.totalKeeperTips(), 0, "no tips");
    }

    function test_KeeperTip_MemberAsKeeper() public {
        uint256 id = _active3(0, 10, 100 * e6, 1);
        _allPay3(id);
        _warpPast(id);
        uint256 bobBefore = kameti.claimable(bob);
        vm.prank(bob);
        kameti.settleRound(id);
        assertGe(kameti.claimable(bob), bobBefore + 50_000, "bob (member keeper) gets tip");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION D — PQ withdrawal guard
// ═════════════════════════════════════════════════════════════════════════════
contract KametiPqGuardTest is FeatBase {

    MockPQPrecompile internal pqMock;
    bytes32 internal constant VK = bytes32(uint256(42));

    function setUp() public override {
        super.setUp();
        pqMock = new MockPQPrecompile();
        // Give alice some claimable by going through a quick circle
        uint256 id = _active3(0, 0, CONTRIBUTION, 1);
        _allPay3(id);
        _warpPast(id);
        kameti.settleRound(id);
        // alice has claimable (dividend or payout). Ensure she has enough.
        // Also mint direct claimable by having her win a circle.
        // Give alice 1000e6 claimable via a circle she wins
        // (easier: give everyone claimable by running a circle where alice wins)
        // We'll just add more circles if needed; for the tests requiring 100e6 we need more.
        // Create a 3-member circle where alice wins (she's seat 2, so we need creator to be defaulted)
        // Simplest: have alice complete a series of circles to accumulate.
        // For PQ tests, give alice claimable directly via a 3-member circle she wins.
        // Use a fresh circle where alice is forced to win by elimination.
        uint256 id2 = _active3(0, 0, 100 * e6, 1);
        // all pay, warp, creator wins round 1 (seat 1 = creator)
        // Make alice win: skip creator & bob, alice only payer (but creator is lowest seat so wins by default)
        // Just run all 3 rounds so alice eventually wins.
        // R1: creator wins (seat1)
        vm.prank(creator); kameti.pay(id2);
        vm.prank(alice);   kameti.pay(id2);
        vm.prank(bob);     kameti.pay(id2);
        _warpPast(id2);
        kameti.settleRound(id2);
        // R2: alice wins (seat2, lowest non-won)
        vm.prank(creator); kameti.pay(id2);
        vm.prank(alice);   kameti.pay(id2);
        vm.prank(bob);     kameti.pay(id2);
        _warpPast(id2);
        kameti.settleRound(id2);
        // R3: bob wins
        vm.prank(creator); kameti.pay(id2);
        vm.prank(alice);   kameti.pay(id2);
        vm.prank(bob);     kameti.pay(id2);
        _warpPast(id2);
        kameti.settleRound(id2);
        // Now alice has 300e6 payout from round 2 (minus anything she spent)
        // She should have >= 100e6 claimable
    }

    // ── Enable ─────────────────────────────────────────────────────────────────

    function test_PqGuard_Enable() public {
        vm.expectEmit(true, false, false, true, address(kameti));
        emit Kameti.PqGuardEnabled(alice, VK);
        vm.prank(alice);
        kameti.enablePqGuard(VK, 50 * e6);
    }

    function test_PqGuard_EnableTwice() public {
        vm.prank(alice); kameti.enablePqGuard(VK, 50 * e6);
        vm.prank(alice);
        vm.expectRevert(Kameti.PqGuardAlreadyEnabled.selector);
        kameti.enablePqGuard(VK, 50 * e6);
    }

    // ── Daily limit ────────────────────────────────────────────────────────────

    /// @dev Give alice claimable by running a 3-member circle through 2 rounds.
    ///      R1: all pay → creator wins (seat 1). R2: all pay → alice wins (seat 2, lowest un-won).
    function _giveAliceClaimable(uint256 contribution) internal returns (uint256 payout) {
        uint256 id = _active3(0, 0, contribution, 1);
        // Round 1: all pay, creator wins (lowest seat)
        vm.prank(creator); kameti.pay(id);
        vm.prank(alice);   kameti.pay(id);
        vm.prank(bob);     kameti.pay(id);
        _warpPast(id);
        kameti.settleRound(id);
        // Round 2: all pay, alice wins (creator already won, alice is seat 2 = lowest eligible)
        vm.prank(creator); kameti.pay(id);
        vm.prank(alice);   kameti.pay(id);
        vm.prank(bob);     kameti.pay(id);
        _warpPast(id);
        uint256 before = kameti.claimable(alice);
        kameti.settleRound(id);
        payout = kameti.claimable(alice) - before;
        // Round 3: bob wins (skip, we have alice's claimable)
    }

    function test_PqGuard_DailyLimit() public {
        // alice currently has some claimable from setUp circles
        uint256 aliceClaim = kameti.claimable(alice);
        require(aliceClaim > 0, "alice must have claimable from setUp");

        // Pre-seed MORE claimable BEFORE enabling (warping happens here, that's ok)
        _giveAliceClaimable(1 * e6); // gives alice +3e6
        uint256 totalClaim = kameti.claimable(alice); // aliceClaim + 3e6
        require(totalClaim > 0, "need claimable");

        // Enable with dailyFreeLimit = aliceClaim (less than totalClaim)
        // So: first withdraw of totalClaim > dailyFreeLimit → should revert
        vm.prank(alice);
        kameti.enablePqGuard(VK, aliceClaim); // limit = original amount, total > limit

        // Withdraw attempts totalClaim > dailyFreeLimit → PqDailyLimitExceeded
        vm.prank(alice);
        vm.expectRevert(Kameti.PqDailyLimitExceeded.selector);
        kameti.withdraw();
    }

    function test_PqGuard_DailyWindowResets() public {
        uint256 aliceClaim = kameti.claimable(alice);
        require(aliceClaim > 0, "alice must have claimable from setUp");

        // Enable with dailyFreeLimit = aliceClaim
        vm.prank(alice);
        kameti.enablePqGuard(VK, aliceClaim);

        // Consume daily budget
        vm.prank(alice);
        kameti.withdraw();

        // advance 24h+1s — window resets
        vm.warp(block.timestamp + 24 hours + 1);

        // Re-seed alice: give her claimable that fits within the same limit
        _giveAliceClaimable(1 * e6);
        uint256 newClaim = kameti.claimable(alice);
        require(newClaim > 0, "need claimable after re-seed");
        require(newClaim <= aliceClaim, "new claim must fit in limit");

        // Window reset: withdraw should succeed (dailyUsed reset to 0)
        vm.prank(alice);
        kameti.withdraw(); // must not revert
    }

    // ── withdrawPq ─────────────────────────────────────────────────────────────

    function test_PqGuard_WithdrawPq_HappyPath() public {
        vm.etch(PQ_PRECOMPILE, address(pqMock).code);

        vm.prank(alice); kameti.enablePqGuard(VK, 10 * e6);
        uint256 aliceClaim = kameti.claimable(alice);
        require(aliceClaim >= 100 * e6, "alice needs >= 100e6");
        uint256 amount = 100 * e6;

        bytes memory sig = _pqSig();
        bytes memory message = _pqWithdrawMsg(alice, bob, amount, 0);
        MockPQPrecompile(PQ_PRECOMPILE).register(abi.encodePacked(VK), message, sig);

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.expectEmit(true, false, false, true, address(kameti));
        emit Kameti.Withdrawn(alice, amount);
        vm.prank(alice);
        kameti.withdrawPq(bob, amount, sig);

        assertEq(usdc.balanceOf(bob), bobBefore + amount, "bob received USDC");
        assertEq(kameti.claimable(alice), aliceClaim - amount, "alice claimable reduced");
    }

    function test_PqGuard_WithdrawPq_WrongSig() public {
        MockPQAlwaysFalse falsy = new MockPQAlwaysFalse();
        vm.etch(PQ_PRECOMPILE, address(falsy).code);
        vm.prank(alice); kameti.enablePqGuard(VK, 10 * e6);
        bytes memory sig = _pqSig();
        vm.prank(alice);
        vm.expectRevert(Kameti.PqInvalidSignature.selector);
        kameti.withdrawPq(bob, 1 * e6, sig);
    }

    function test_PqGuard_WithdrawPq_WrongLength() public {
        vm.prank(alice); kameti.enablePqGuard(VK, 10 * e6);
        bytes memory sig = new bytes(100); // wrong length
        vm.prank(alice);
        vm.expectRevert(Kameti.PqInvalidSignature.selector);
        kameti.withdrawPq(bob, 1 * e6, sig);
    }

    function test_PqGuard_WithdrawPq_PrecompileReverts() public {
        MockPQRevert rev = new MockPQRevert();
        vm.etch(PQ_PRECOMPILE, address(rev).code);
        vm.prank(alice); kameti.enablePqGuard(VK, 10 * e6);
        bytes memory sig = _pqSig();
        vm.prank(alice);
        vm.expectRevert(Kameti.PqInvalidSignature.selector);
        kameti.withdrawPq(bob, 1 * e6, sig);
    }

    function test_PqGuard_WithdrawPq_EmptyReturn() public {
        MockPQEmptyReturn emp = new MockPQEmptyReturn();
        vm.etch(PQ_PRECOMPILE, address(emp).code);
        vm.prank(alice); kameti.enablePqGuard(VK, 10 * e6);
        bytes memory sig = _pqSig();
        vm.prank(alice);
        vm.expectRevert(Kameti.PqInvalidSignature.selector);
        kameti.withdrawPq(bob, 1 * e6, sig);
    }

    function test_PqGuard_WithdrawPq_ShortReturn() public {
        MockPQShortReturn srt = new MockPQShortReturn();
        vm.etch(PQ_PRECOMPILE, address(srt).code);
        vm.prank(alice); kameti.enablePqGuard(VK, 10 * e6);
        bytes memory sig = _pqSig();
        vm.prank(alice);
        vm.expectRevert(Kameti.PqInvalidSignature.selector);
        kameti.withdrawPq(bob, 1 * e6, sig);
    }

    function test_PqGuard_WithdrawPq_NonceReplay() public {
        vm.etch(PQ_PRECOMPILE, address(pqMock).code);
        vm.prank(alice); kameti.enablePqGuard(VK, 10 * e6);
        uint256 aliceClaim = kameti.claimable(alice);
        uint256 amount = 1 * e6;
        require(aliceClaim >= 2 * amount, "need 2e6");

        bytes memory sig = _pqSig();
        bytes memory message0 = _pqWithdrawMsg(alice, bob, amount, 0);
        MockPQPrecompile(PQ_PRECOMPILE).register(abi.encodePacked(VK), message0, sig);

        // first call: nonce=0, succeeds → nonce becomes 1
        vm.prank(alice); kameti.withdrawPq(bob, amount, sig);

        // replay: nonce is now 1, message0 won't match → returns false → PqInvalidSignature
        vm.prank(alice);
        vm.expectRevert(Kameti.PqInvalidSignature.selector);
        kameti.withdrawPq(bob, amount, sig);
    }

    // ── changePqGuard ──────────────────────────────────────────────────────────

    function test_PqGuard_ChangePqGuard() public {
        vm.etch(PQ_PRECOMPILE, address(pqMock).code);
        vm.prank(alice); kameti.enablePqGuard(VK, 50 * e6);

        bytes32 newVk  = bytes32(uint256(2));
        uint256 newLim = 20 * e6;
        bytes memory sig = _pqSig();
        bytes memory message = _pqChangeMsg(alice, newVk, newLim, 0);
        MockPQPrecompile(PQ_PRECOMPILE).register(abi.encodePacked(VK), message, sig);

        vm.expectEmit(true, false, false, true, address(kameti));
        emit Kameti.PqGuardChanged(alice, newVk);
        vm.prank(alice);
        kameti.changePqGuard(newVk, newLim, sig);
    }

    function test_PqGuard_ChangePqGuard_WrongSig() public {
        MockPQAlwaysFalse falsy = new MockPQAlwaysFalse();
        vm.etch(PQ_PRECOMPILE, address(falsy).code);
        vm.prank(alice); kameti.enablePqGuard(VK, 50 * e6);
        bytes memory sig = _pqSig();
        vm.prank(alice);
        vm.expectRevert(Kameti.PqInvalidSignature.selector);
        kameti.changePqGuard(bytes32(uint256(2)), 20 * e6, sig);
    }

    // ── disablePqGuard ─────────────────────────────────────────────────────────

    function test_PqGuard_Disable() public {
        vm.etch(PQ_PRECOMPILE, address(pqMock).code);
        vm.prank(alice); kameti.enablePqGuard(VK, 50 * e6);

        bytes memory sig = _pqSig();
        bytes memory message = _pqDisableMsg(alice, 0);
        MockPQPrecompile(PQ_PRECOMPILE).register(abi.encodePacked(VK), message, sig);

        vm.expectEmit(true, false, false, false, address(kameti));
        emit Kameti.PqGuardDisabled(alice);
        vm.prank(alice);
        kameti.disablePqGuard(sig);

        // After disable: withdraw() works without PQ
        uint256 aliceClaim = kameti.claimable(alice);
        if (aliceClaim > 0) {
            vm.prank(alice);
            kameti.withdraw(); // should not revert
        }
    }

    // ── Not enabled ────────────────────────────────────────────────────────────

    function test_PqGuard_NotEnabled_WithdrawPq_Reverts() public {
        bytes memory sig = _pqSig();
        vm.prank(alice);
        vm.expectRevert(Kameti.PqGuardNotEnabled.selector);
        kameti.withdrawPq(bob, 1 * e6, sig);
    }

    function test_PqGuard_NotEnabled_Change_Reverts() public {
        bytes memory sig = _pqSig();
        vm.prank(alice);
        vm.expectRevert(Kameti.PqGuardNotEnabled.selector);
        kameti.changePqGuard(VK, 50 * e6, sig);
    }

    function test_PqGuard_NotEnabled_Disable_Reverts() public {
        bytes memory sig = _pqSig();
        vm.prank(alice);
        vm.expectRevert(Kameti.PqGuardNotEnabled.selector);
        kameti.disablePqGuard(sig);
    }

    // ── Timelock ───────────────────────────────────────────────────────────────

    function test_PqGuard_Timelock_Request() public {
        vm.prank(alice); kameti.enablePqGuard(VK, 50 * e6);
        vm.expectEmit(true, false, false, true, address(kameti));
        emit Kameti.PqDisableRequested(alice, block.timestamp + 7 days);
        vm.prank(alice);
        kameti.requestPqDisable();
    }

    function test_PqGuard_Timelock_RequestTwice() public {
        vm.prank(alice); kameti.enablePqGuard(VK, 50 * e6);
        vm.prank(alice); kameti.requestPqDisable();
        vm.prank(alice);
        vm.expectRevert(Kameti.PqTimelockAlreadyStarted.selector);
        kameti.requestPqDisable();
    }

    function test_PqGuard_Timelock_FinalizeEarly() public {
        vm.prank(alice); kameti.enablePqGuard(VK, 50 * e6);
        vm.prank(alice); kameti.requestPqDisable();
        vm.prank(alice);
        vm.expectRevert(Kameti.PqTimelockNotExpired.selector);
        kameti.finalizePqDisable();
    }

    function test_PqGuard_Timelock_Finalize() public {
        vm.prank(alice); kameti.enablePqGuard(VK, 50 * e6);
        vm.prank(alice); kameti.requestPqDisable();
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(alice);
        kameti.finalizePqDisable(); // should not revert
    }

    function test_PqGuard_Timelock_Cancel() public {
        vm.etch(PQ_PRECOMPILE, address(pqMock).code);
        vm.prank(alice); kameti.enablePqGuard(VK, 50 * e6);
        vm.prank(alice); kameti.requestPqDisable();

        bytes memory sig = _pqSig();
        bytes memory message = _pqCancelDisableMsg(alice, 0);
        MockPQPrecompile(PQ_PRECOMPILE).register(abi.encodePacked(VK), message, sig);

        vm.expectEmit(true, false, false, false, address(kameti));
        emit Kameti.PqDisableCancelled(alice);
        vm.prank(alice);
        kameti.cancelPqDisable(sig);
    }

    // ── To-bound-in-sig ────────────────────────────────────────────────────────

    function test_PqGuard_WithdrawPq_ToBoundInSig() public {
        vm.etch(PQ_PRECOMPILE, address(pqMock).code);
        vm.prank(alice); kameti.enablePqGuard(VK, 10 * e6);
        uint256 aliceClaim = kameti.claimable(alice);
        require(aliceClaim >= 50 * e6, "alice needs 50e6");

        bytes memory sig = _pqSig();
        bytes memory message = _pqWithdrawMsg(alice, carol, 50 * e6, 0);
        MockPQPrecompile(PQ_PRECOMPILE).register(abi.encodePacked(VK), message, sig);

        uint256 carolBefore = usdc.balanceOf(carol);
        vm.prank(alice);
        kameti.withdrawPq(carol, 50 * e6, sig);
        assertEq(usdc.balanceOf(carol), carolBefore + 50 * e6, "USDC goes to carol not alice");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION E — IKametiScore interface
// ═════════════════════════════════════════════════════════════════════════════
contract KametiScoreTest is FeatBase {

    function test_IsReliable_Default() public {
        address fresh = makeAddr("fresh");
        assertEq(kameti.scoreOf(fresh), 600, "default score=600");
        assertTrue(kameti.isReliable(fresh, 600), "isReliable(600)=true");
        assertFalse(kameti.isReliable(fresh, 601), "isReliable(601)=false");
    }

    function test_StatsOf_Default() public {
        address fresh = makeAddr("fresh2");
        IKametiScore.ScoreStats memory s = kameti.statsOf(fresh);
        assertEq(s.onTimePayments, 0, "onTimePayments=0");
        assertEq(s.strikes, 0, "strikes=0");
        assertEq(s.defaults, 0, "defaults=0");
        assertEq(s.circlesCompleted, 0, "circlesCompleted=0");
        assertEq(s.totalContributed, 0, "totalContributed=0");
    }

    function test_IsReliable_AfterImprovement() public {
        // Run alice through a circle where she makes 20 on-time payments.
        // Use 20 3-member circles where alice pays each round.
        // Each settle gives alice 1 onTimePayment when she is NOT the winner.
        // 20 circles × 1 round each → 20 on-time payments, score = 600+20×5=700
        for (uint8 c = 0; c < 20; c++) {
            uint256 id = _active3(0, 0, CONTRIBUTION, 1);
            vm.prank(creator); kameti.pay(id);
            vm.prank(alice);   kameti.pay(id);
            vm.prank(bob);     kameti.pay(id);
            _warpPast(id);
            kameti.settleRound(id);
            // Only round 1: creator wins (seat 1), but alice paid so she gets +1 onTimePayment
            // after 3 rounds in a 3-member circle, alice can also win.
            // To avoid alice winning (which resets the score calc), we want her to just pay.
            // creator wins in round 1 (lowest seat), alice gets onTimePayment credit.
        }
        uint16 score = kameti.scoreOf(alice);
        // alice got 20 onTimePayments (one per circle round as non-winner payer)
        assertGe(score, 700, "score >= 700 after 20 on-time payments");
        assertTrue(kameti.isReliable(alice, 700), "isReliable(700) after improvement");
    }
}
