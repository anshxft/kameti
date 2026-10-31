// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IKametiScore} from "./IKametiScore.sol";

interface IUSDC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function cancelAuthorization(
        address authorizer,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}

/// @notice Arc's post-quantum SLH-DSA-SHA2-128s precompile.
interface IPQVerify {
    /// @notice Verify an SLH-DSA-SHA2-128s signature.
    /// @param vk 32-byte verifying key.
    /// @param message Message bytes.
    /// @param sig 7856-byte signature.
    /// @return isValid True if signature is valid.
    function verifySlhDsaSha2128s(
        bytes calldata vk,
        bytes calldata message,
        bytes calldata sig
    ) external view returns (bool isValid);
}

/// @title Kameti v3.1 — Post-win lock, keeper tip, PQ withdrawal guard, EIP-3009 AutoPay
/// @notice Members join a circle, pay contributions each round, bid for the pot,
///         and the winner (highest bidder, or lowest seat by default) receives the pot
///         minus their bid discount. Dividends from discounts are split among other members.
contract Kameti is ReentrancyGuard, IKametiScore {
    using SafeERC20 for IERC20;

    // ─── Errors ──────────────────────────────────────────────────────────────
    error InvalidParams();
    error CircleNotOpen();
    error CircleNotActive();
    error CircleCompleted_();
    error AlreadyMember();
    error NotMember();
    error ScoreTooLow();
    error CircleFull();
    error AlreadyPaid();
    error BidTooLow();
    error BidAboveCap();
    error BidAfterDeadline();
    error BidIneligible();
    error OnlyOneMemberEligible();
    error RoundNotSettleable();
    error AlreadySettled();
    error NothingToWithdraw();
    error CircleAlreadyStarted();
    error CannotLeaveActiveCircle();
    error RoundEnded();
    error InsufficientGasForAutoPay();
    error PqGuardNotEnabled();
    error PqGuardAlreadyEnabled();
    error PqInvalidSignature();
    error PqInvalidKeyLength();
    error PqDailyLimitExceeded();
    error PqTimelockNotStarted();
    error PqTimelockNotExpired();
    error PqTimelockAlreadyStarted();

    // ─── Enums & structs ─────────────────────────────────────────────────────
    enum CircleStatus {
        Open,
        Active,
        Completed
    }

    struct CircleParams {
        string name;
        uint256 contribution; // USDC per round (6 dec)
        uint8 maxMembers; // 3..10
        uint256 roundDuration; // seconds, >= 10 min
        uint8 depositMultiplier; // 1..3
        uint16 maxDiscountBps; // <= 4000 (40 %)
        uint16 minScore; // 0..900
        uint16 postWinLockBps; // 0..10000: fraction of payout locked post-win
        uint8 keeperTipBps; // 0..20 (max 0.2%)
    }

    struct MemberInfo {
        address addr;
        uint8 seat; // 1-based join order
        uint256 depositLeft; // current locked deposit
        uint256 lockLeft; // post-win lock amount still held
        bool paidThisRound;
        bool won;
        uint8 wonRound;
        bool defaulted;
        uint256 debt; // unpaid contribution shortfall
        bool hasStoredAuth;
    }

    struct Circle {
        CircleParams params;
        CircleStatus status;
        uint8 currentRound; // 1-based; 0 = not started
        uint256 roundEnd; // timestamp
        uint256 potAccumulated; // USDC paid into pot this round
        uint256 snipeExtensions; // total seconds added by anti-snipe this round
        address highestBidder;
        uint256 highestDiscount; // USDC the bidder gives up
        // parallel arrays — index = seat-1
        address[] seats; // stable seat order (set on start)
        uint256[] deposits;
        bool[] paid;
        bool[] won_;
        uint8[] wonRound_;
        bool[] defaulted_;
        uint256[] debt_;
    }

    struct RoundRecord {
        address winner;
        uint256 pot;
        uint256 discount;
        uint256 dividendPerMember;
    }

    // ScoreStats is defined in IKametiScore and inherited by this contract.

    // circleId => round => member => StoredAuth
    struct StoredAuth {
        uint256 validBefore;
        uint8 v;
        bytes32 r;
        bytes32 s;
        bool exists;
    }

    struct PqGuard {
        bytes32 vk; // 32-byte SLH-DSA verifying key
        uint256 dailyFreeLimit; // USDC per rolling 24h without PQ sig
        uint256 dailyUsed; // USDC withdrawn in current 24h window
        uint256 windowStart; // timestamp when current window started
        uint256 nonce; // replay protection for PQ-signed ops
        bool enabled;
        uint256 timelockStart; // 0 = no timelock in progress
    }

    // ─── State ───────────────────────────────────────────────────────────────
    IERC20 public immutable usdc;

    uint256 internal constant MAX_SNIPE_EXTENSIONS = 3; // multiplier for SNIPE_WINDOW cap
    /// @dev Minimum gas required before making each receiveWithAuthorization call in _executeAutoPay.
    uint256 internal constant AUTOPAY_MIN_GAS = 120_000;
    /// @dev Maximum USDC keeper tip per round (0.05 USDC = 50_000 units at 6 decimals).
    uint256 internal constant MAX_KEEPER_TIP = 50_000;
    /// @dev Arc post-quantum SLH-DSA-SHA2-128s verify precompile address.
    ///      Default: 0x1800000000000000000000000000000000000004 (Arc mainnet and testnet).
    ///      Source: https://docs.arc.io/developers/precompiles/pq-sig-verify
    ///      Overrideable at deploy time for other EVM environments.
    address internal immutable PQ_PRECOMPILE;
    uint256 internal constant PQ_TIMELOCK = 7 days;
    uint256 internal constant PQ_VK_LEN = 32;
    uint256 internal constant PQ_SIG_LEN = 7856;

    uint256 public totalCircles;
    uint256 public totalContributed; // all-time USDC contributed
    uint256 public totalPayouts; // count of pot claims
    uint256 public totalDividendsPaid; // all-time dividend USDC
    uint256 public totalKeeperTips; // all-time keeper tips paid

    uint256 private _nextId;

    mapping(uint256 => Circle) internal _c;
    mapping(uint256 => RoundRecord[]) internal _history; // 0-based index = round-1
    mapping(address => uint256[]) internal _memberOf;
    mapping(address => uint256) public claimable;
    mapping(address => IKametiScore.ScoreStats) internal _stats;
    mapping(uint256 => mapping(uint8 => mapping(address => StoredAuth))) internal _auth;
    /// @dev postWinLock[circleId][member] = USDC locked from winner's payout until future payments.
    mapping(uint256 => mapping(address => uint256)) internal _postWinLock;
    mapping(address => PqGuard) internal _pqGuard;
    // Per-user creation nonce for createCircleWithAuthorization (avoids global _nextId race)
    mapping(address => uint256) public createNonce;

    // ─── Events ──────────────────────────────────────────────────────────────
    event CircleCreated(uint256 indexed id, string name, uint256 contribution, uint8 maxMembers, address indexed creator);
    event MemberJoined(uint256 indexed id, address indexed member, uint8 seat);
    event MemberLeft(uint256 indexed id, address indexed member);
    event ContributionPaid(uint256 indexed id, uint8 round, address indexed member, uint256 amount, bool autoPay);
    event BidPlaced(uint256 indexed id, uint8 round, address indexed bidder, uint256 discount);
    event DepositSlashed(uint256 indexed id, uint8 round, address indexed member, uint256 slashed, uint256 shortfall);
    event RoundSettled(
        uint256 indexed id,
        uint8 round,
        address indexed winner,
        uint256 pot,
        uint256 discount,
        uint256 dividendPerMember
    );
    event AutoPayExecuted(uint256 indexed id, uint8 round, address indexed member);
    event AutoPayFailed(uint256 indexed id, uint8 round, address indexed member, uint8 reasonCode);
    event RoundExtended(uint256 indexed id, uint8 round, uint256 newRoundEnd);
    event KeeperTipped(uint256 indexed id, uint8 round, address indexed keeper, uint256 amount);
    event Withdrawn(address indexed member, uint256 amount);
    event CircleCompleted(uint256 indexed id);
    event PqGuardEnabled(address indexed member, bytes32 vk);
    event PqGuardChanged(address indexed member, bytes32 newVk);
    event PqGuardDisabled(address indexed member);
    event PqDisableRequested(address indexed member, uint256 unlockAt);
    event PqDisableCancelled(address indexed member);

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(address usdcAddress, address pqPrecompile) {
        if (usdcAddress == address(0)) revert InvalidParams();
        // Note: Arc USDC (0x3600…) is a precompile whose extcodesize may be 0
        // even though it is callable, so we omit a code-length check here.
        usdc = IERC20(usdcAddress);
        // Passing address(0) selects the canonical Arc precompile address.
        // To deploy on a non-Arc EVM without any PQ support, pass a no-op address.
        PQ_PRECOMPILE = pqPrecompile == address(0)
            ? 0x1800000000000000000000000000000000000004
            : pqPrecompile;
    }

    // ─── Circle creation ─────────────────────────────────────────────────────

    /// @notice Create a new circle. Creator auto-joins as seat 1 and pays the deposit.
    /// @param name Circle display name.
    /// @param contribution Contribution amount per round in USDC units.
    /// @param maxMembers Maximum members allowed (3..10).
    /// @param roundDuration Round duration in seconds.
    /// @param depositMultiplier Deposit multiplier (1..3).
    /// @param maxDiscountBps Maximum discount in basis points (<= 4000).
    /// @param minScore Minimum Kameti score required to join.
    /// @param postWinLockBps Fraction of payout locked post-win (0..10000 bps).
    /// @param keeperTipBps Keeper tip in basis points paid from pot each settle (0..20).
    /// @return id The newly created circle id.
    function createCircle(
        string calldata name,
        uint256 contribution,
        uint8 maxMembers,
        uint256 roundDuration,
        uint8 depositMultiplier,
        uint16 maxDiscountBps,
        uint16 minScore,
        uint16 postWinLockBps,
        uint8 keeperTipBps
    ) external nonReentrant returns (uint256 id) {
        if (contribution == 0) revert InvalidParams();
        if (maxMembers < 3 || maxMembers > 10) revert InvalidParams();
        if (roundDuration < 10 minutes) revert InvalidParams();
        if (depositMultiplier < 1 || depositMultiplier > 3) revert InvalidParams();
        if (maxDiscountBps > 4000) revert InvalidParams();
        if (minScore > 900) revert InvalidParams();
        if (postWinLockBps > 10000) revert InvalidParams();
        if (keeperTipBps > 20) revert InvalidParams();

        id = _nextId++;

        Circle storage c = _c[id];
        c.params = CircleParams(
            name,
            contribution,
            maxMembers,
            roundDuration,
            depositMultiplier,
            maxDiscountBps,
            minScore,
            postWinLockBps,
            keeperTipBps
        );
        c.status = CircleStatus.Open;
        c.currentRound = 0;

        uint256 deposit = contribution * depositMultiplier;

        // Creator joins as seat 1
        c.seats.push(msg.sender);
        c.deposits.push(deposit);
        c.paid.push(false);
        c.won_.push(false);
        c.wonRound_.push(0);
        c.defaulted_.push(false);
        c.debt_.push(0);

        _memberOf[msg.sender].push(id);
        totalCircles += 1;

        // Collect deposit from creator
        _receiveExact(msg.sender, deposit);

        emit CircleCreated(id, name, contribution, maxMembers, msg.sender);
        emit MemberJoined(id, msg.sender, 1);
    }

    /// @notice Create a circle using EIP-3009 authorization for the deposit.
    /// @param name Circle display name.
    /// @param contribution Contribution amount per round in USDC units.
    /// @param maxMembers Maximum members allowed (3..10).
    /// @param roundDuration Round duration in seconds.
    /// @param depositMultiplier Deposit multiplier (1..3).
    /// @param maxDiscountBps Maximum discount in basis points (<= 4000).
    /// @param minScore Minimum Kameti score required to join.
    /// @param postWinLockBps Fraction of payout locked post-win (0..10000 bps).
    /// @param keeperTipBps Keeper tip in basis points paid from pot each settle (0..20).
    /// @param validBefore Authorization expiry timestamp.
    /// @param nonce EIP-3009 nonce, bound to this contract, chain, and next circle id.
    /// @param v Signature v component.
    /// @param r Signature r component.
    /// @param s Signature s component.
    /// @return id The newly created circle id.
    function createCircleWithAuthorization(
        string calldata name,
        uint256 contribution,
        uint8 maxMembers,
        uint256 roundDuration,
        uint8 depositMultiplier,
        uint16 maxDiscountBps,
        uint16 minScore,
        uint16 postWinLockBps,
        uint8 keeperTipBps,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 id) {
        if (contribution == 0) revert InvalidParams();
        if (maxMembers < 3 || maxMembers > 10) revert InvalidParams();
        if (roundDuration < 10 minutes) revert InvalidParams();
        if (depositMultiplier < 1 || depositMultiplier > 3) revert InvalidParams();
        if (maxDiscountBps > 4000) revert InvalidParams();
        if (minScore > 900) revert InvalidParams();
        if (postWinLockBps > 10000) revert InvalidParams();
        if (keeperTipBps > 20) revert InvalidParams();

        uint256 deposit = contribution * depositMultiplier;
        // Use per-user createNonce so concurrent circle creations by others
        // cannot shift the expected nonce and grief pre-signed authorizations.
        bytes32 expectedNonce = createDepositNonce(msg.sender);
        if (nonce != expectedNonce) revert InvalidParams();
        createNonce[msg.sender]++;   // consume the nonce before the external call (CEI)

        uint256 before = usdc.balanceOf(address(this));
        IUSDC3009(address(usdc)).receiveWithAuthorization(
            msg.sender,
            address(this),
            deposit,
            0,
            validBefore,
            nonce,
            v,
            r,
            s
        );
        if (usdc.balanceOf(address(this)) - before != deposit) revert InvalidParams();

        id = _nextId++;
        Circle storage c = _c[id];
        c.params = CircleParams(
            name,
            contribution,
            maxMembers,
            roundDuration,
            depositMultiplier,
            maxDiscountBps,
            minScore,
            postWinLockBps,
            keeperTipBps
        );
        c.status = CircleStatus.Open;
        c.currentRound = 0;

        c.seats.push(msg.sender);
        c.deposits.push(deposit);
        c.paid.push(false);
        c.won_.push(false);
        c.wonRound_.push(0);
        c.defaulted_.push(false);
        c.debt_.push(0);

        _memberOf[msg.sender].push(id);
        totalCircles += 1;

        emit CircleCreated(id, name, contribution, maxMembers, msg.sender);
        emit MemberJoined(id, msg.sender, 1);
    }

    /// @notice Join an open circle (score gate, deposit required).
    /// @param id Circle id.

    function join(uint256 id) external nonReentrant {
        Circle storage c = _c[id];
        if (c.status != CircleStatus.Open) revert CircleNotOpen();
        if (c.seats.length >= c.params.maxMembers) revert CircleFull();
        if (_seatOf(c, msg.sender) != type(uint8).max) revert AlreadyMember();

        uint16 required = c.params.minScore;
        if (required > 0 && scoreOf(msg.sender) < required) revert ScoreTooLow();

        uint256 deposit = c.params.contribution * c.params.depositMultiplier;

        uint8 seat = uint8(c.seats.length + 1);
        c.seats.push(msg.sender);
        c.deposits.push(deposit);
        c.paid.push(false);
        c.won_.push(false);
        c.wonRound_.push(0);
        c.defaulted_.push(false);
        c.debt_.push(0);

        _memberOf[msg.sender].push(id);
        _receiveExact(msg.sender, deposit);

        emit MemberJoined(id, msg.sender, seat);

        // Start when full
        if (c.seats.length == c.params.maxMembers) {
            c.status = CircleStatus.Active;
            c.currentRound = 1;
            c.roundEnd = block.timestamp + c.params.roundDuration;
        }
    }

    /// @notice Join a circle using EIP-3009 authorization (no separate approve tx needed).
    /// @param circleId Circle id.
    /// @param validBefore Authorization expiry timestamp.
    /// @param nonce EIP-3009 nonce that must equal depositNonce(circleId, msg.sender).
    /// @param v Signature v component.
    /// @param r Signature r component.
    /// @param s Signature s component.

    function joinWithAuthorization(
        uint256 circleId,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        Circle storage c = _c[circleId];
        if (c.status != CircleStatus.Open) revert CircleNotOpen();
        if (c.seats.length >= c.params.maxMembers) revert CircleFull();
        if (_seatOf(c, msg.sender) != type(uint8).max) revert AlreadyMember();

        uint16 required = c.params.minScore;
        if (required > 0 && scoreOf(msg.sender) < required) revert ScoreTooLow();

        if (nonce != depositNonce(circleId, msg.sender)) revert InvalidParams();

        uint256 deposit = c.params.contribution * c.params.depositMultiplier;

        uint256 before = usdc.balanceOf(address(this));
        IUSDC3009(address(usdc)).receiveWithAuthorization(
            msg.sender,
            address(this),
            deposit,
            0,
            validBefore,
            nonce,
            v,
            r,
            s
        );
        if (usdc.balanceOf(address(this)) - before != deposit) revert InvalidParams();

        uint8 seat = uint8(c.seats.length + 1);
        c.seats.push(msg.sender);
        c.deposits.push(deposit);
        c.paid.push(false);
        c.won_.push(false);
        c.wonRound_.push(0);
        c.defaulted_.push(false);
        c.debt_.push(0);

        _memberOf[msg.sender].push(circleId);
        emit MemberJoined(circleId, msg.sender, seat);

        if (c.seats.length == c.params.maxMembers) {
            c.status = CircleStatus.Active;
            c.currentRound = 1;
            c.roundEnd = block.timestamp + c.params.roundDuration;
        }
    }

    /// @notice Leave an open (not-yet-started) circle and reclaim deposit.
    /// @param id Circle id.

    function leave(uint256 id) external nonReentrant {
        Circle storage c = _c[id];
        if (c.status == CircleStatus.Active) revert CannotLeaveActiveCircle();
        if (c.status == CircleStatus.Completed) revert CircleCompleted_();

        uint8 si = _seatOf(c, msg.sender);
        if (si == type(uint8).max) revert NotMember();

        uint256 dep = c.deposits[si];
        c.deposits[si] = 0;

        // Remove from arrays (shift left)
        uint256 n = c.seats.length;
        for (uint256 i = si; i < n - 1; i++) {
            c.seats[i] = c.seats[i + 1];
            c.deposits[i] = c.deposits[i + 1];
            c.paid[i] = c.paid[i + 1];
            c.won_[i] = c.won_[i + 1];
            c.wonRound_[i] = c.wonRound_[i + 1];
            c.defaulted_[i] = c.defaulted_[i + 1];
            c.debt_[i] = c.debt_[i + 1];
        }
        c.seats.pop();
        c.deposits.pop();
        c.paid.pop();
        c.won_.pop();
        c.wonRound_.pop();
        c.defaulted_.pop();
        c.debt_.pop();

        // Remove from _memberOf
        uint256[] storage circles = _memberOf[msg.sender];
        for (uint256 i = 0; i < circles.length; i++) {
            if (circles[i] == id) {
                circles[i] = circles[circles.length - 1];
                circles.pop();
                break;
            }
        }

        if (dep > 0) claimable[msg.sender] += dep;
        emit MemberLeft(id, msg.sender);
    }

    // ─── Round actions ────────────────────────────────────────────────────────

    /// @notice Pay this round's contribution.
    /// @param id Circle id.

    function pay(uint256 id) external nonReentrant {
        _pay(id, msg.sender, false);
    }

    /// @notice Pay this round's contribution using EIP-3009 authorization.
    ///         The authorization `from` address must be a member of the circle.
    ///         Callable by anyone (relayer-friendly).
    /// @param circleId Circle id.
    /// @param from Member address authorizing the payment.
    /// @param validBefore Authorization expiry timestamp.
    /// @param v Signature v component.
    /// @param r Signature r component.
    /// @param s Signature s component.

    function payWithAuthorization(
        uint256 circleId,
        address from,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        Circle storage c = _c[circleId];
        if (c.status != CircleStatus.Active) revert CircleNotActive();
        if (block.timestamp >= c.roundEnd) revert RoundEnded();

        uint8 si = _seatOf(c, from);
        if (si == type(uint8).max) revert NotMember();
        if (c.paid[si]) revert AlreadyPaid();

        bytes32 nonce = roundNonce(circleId, c.currentRound, from);

        uint256 before = usdc.balanceOf(address(this));
        IUSDC3009(address(usdc)).receiveWithAuthorization(
            from,
            address(this),
            c.params.contribution,
            0,
            validBefore,
            nonce,
            v,
            r,
            s
        );
        if (usdc.balanceOf(address(this)) - before != c.params.contribution) revert InvalidParams();

        c.paid[si] = true;
        // Release post-win lock fraction for winner's on-time payment
        if (_postWinLock[circleId][c.seats[si]] > 0) {
            uint256 release = (c.params.contribution * c.params.postWinLockBps) / 10000;
            if (release > _postWinLock[circleId][c.seats[si]]) release = _postWinLock[circleId][c.seats[si]];
            _postWinLock[circleId][c.seats[si]] -= release;
            claimable[c.seats[si]] += release;
        }
        c.potAccumulated += c.params.contribution;
        _stats[from].totalContributed += c.params.contribution;
        // Clear any stored authorization for this round/member (it used the same nonce)
        delete _auth[circleId][c.currentRound][from];

        emit ContributionPaid(circleId, c.currentRound, from, c.params.contribution, false);
    }

    /// @notice Place a bid for this round's pot (ascending auction).
    /// @param id Circle id.
    /// @param discount USDC the bidder gives up from the pot.

    function placeBid(uint256 id, uint256 discount) external nonReentrant {
        Circle storage c = _c[id];
        if (c.status != CircleStatus.Active) revert CircleNotActive();
        if (block.timestamp >= c.roundEnd) revert BidAfterDeadline();

        uint8 si = _seatOf(c, msg.sender);
        if (si == type(uint8).max) revert NotMember();

        // Must have paid this round
        if (!c.paid[si]) revert BidIneligible();
        // Must not have won already
        if (c.won_[si]) revert BidIneligible();
        // Must not be defaulted
        if (c.defaulted_[si]) revert BidIneligible();

        // Only one eligible member left → no auction (they take at 0)
        uint256 eligible = _eligibleCount(c);
        if (eligible <= 1) revert OnlyOneMemberEligible();

        uint256 pot = c.params.contribution * c.seats.length;

        // Minimum step: max(1, 1% of pot)
        uint256 minStep = pot / 100;
        if (minStep == 0) minStep = 1;
        if (discount <= c.highestDiscount) revert BidTooLow();
        if (discount < c.highestDiscount + minStep) revert BidTooLow();

        // Cap check
        uint256 cap = (pot * c.params.maxDiscountBps) / 10000;
        if (discount > cap) revert BidAboveCap();

        // Anti-sniping soft close
        uint256 snipeWindow = c.params.roundDuration / 5;
        if (snipeWindow > 2 minutes) snipeWindow = 2 minutes;
        uint256 timeLeft = c.roundEnd > block.timestamp ? c.roundEnd - block.timestamp : 0;
        if (timeLeft < snipeWindow) {
            uint256 maxExt = snipeWindow * MAX_SNIPE_EXTENSIONS;
            uint256 extended = c.snipeExtensions;
            if (extended < maxExt) {
                uint256 needed = snipeWindow - timeLeft;
                uint256 canAdd = maxExt - extended;
                uint256 toAdd = needed < canAdd ? needed : canAdd;
                c.roundEnd += toAdd;
                c.snipeExtensions += toAdd;
                emit RoundExtended(id, c.currentRound, c.roundEnd);
            }
        }

        c.highestBidder = msg.sender;
        c.highestDiscount = discount;

        emit BidPlaced(id, c.currentRound, msg.sender, discount);
    }

    /// @notice Settle the current round. Callable by anyone after roundEnd,
    ///         or early when every member has paid AND <=1 eligible winner remains.
    /// @param id Circle id.

    function settleRound(uint256 id) external nonReentrant {
        Circle storage c = _c[id];
        if (c.status != CircleStatus.Active) revert CircleNotActive();

        bool deadlinePassed = block.timestamp >= c.roundEnd;
        bool earlySettle = _allPaid(c) && _eligibleCount(c) <= 1;

        if (!deadlinePassed && !earlySettle) revert RoundNotSettleable();

        uint8 round = c.currentRound;
        uint256 n = c.seats.length;

        // Run stored authorizations before slashing (on-time if committed before deadline)
        _executeAutoPay(id, c, true);

        // ── Step 1: slash non-payers ─────────────────────────────────────────
        uint256 pot = 0;
        for (uint256 i = 0; i < n; i++) {
            if (c.paid[i]) {
                pot += c.params.contribution;
            } else {
                // Post-win lock covers missed payments first
                uint256 lockCover = 0;
                if (_postWinLock[id][c.seats[i]] > 0) {
                    lockCover = _postWinLock[id][c.seats[i]] < c.params.contribution
                        ? _postWinLock[id][c.seats[i]]
                        : c.params.contribution;
                    _postWinLock[id][c.seats[i]] -= lockCover;
                    pot += lockCover;
                }
                uint256 remaining = c.params.contribution - lockCover;
                uint256 cover = c.deposits[i] >= remaining ? remaining : c.deposits[i];
                c.deposits[i] -= cover;
                pot += cover;

                uint256 shortfall = remaining - cover;
                if (shortfall > 0) {
                    c.debt_[i] += shortfall;
                    c.defaulted_[i] = true;
                    _stats[c.seats[i]].defaults += 1;
                } else {
                    _stats[c.seats[i]].strikes += 1;
                }

                emit DepositSlashed(id, round, c.seats[i], cover, shortfall);
            }
        }

        totalContributed += pot;

        // Keeper tip: paid to msg.sender from the pot before winner payout
        uint256 keeperTip = 0;
        if (c.params.keeperTipBps > 0) {
            keeperTip = (pot * c.params.keeperTipBps) / 10000;
            if (keeperTip > MAX_KEEPER_TIP) keeperTip = MAX_KEEPER_TIP;
            if (keeperTip > pot) keeperTip = pot;
            pot -= keeperTip;
            claimable[msg.sender] += keeperTip;
            totalKeeperTips += keeperTip;
            emit KeeperTipped(id, round, msg.sender, keeperTip);
        }

        // ── Step 2: pick winner ───────────────────────────────────────────────
        uint8 winnerIdx = _pickWinner(c);

        // ── Step 3: apply winner payout ───────────────────────────────────────
        uint256 discount = (c.highestBidder == c.seats[winnerIdx]) ? c.highestDiscount : 0;
        // Clamp discount to realized pot to prevent underflow if members defaulted
        // and deposit slashing produced a pot smaller than the bid cap assumed.
        if (discount > pot) discount = pot;

        uint256 winnerDebt = c.debt_[winnerIdx];
        uint256 payout = pot - discount;
        if (payout >= winnerDebt) {
            payout -= winnerDebt;
            c.debt_[winnerIdx] = 0;
        } else {
            c.debt_[winnerIdx] -= payout;
            payout = 0;
        }
        uint256 clearedDebt = winnerDebt - c.debt_[winnerIdx];

        // Post-win lock: hold back a fraction to ensure the winner keeps paying.
        uint256 remainingRounds = c.params.maxMembers - round;
        uint256 maxLockBase = remainingRounds * c.params.contribution;
        uint256 lockAmount = (maxLockBase * c.params.postWinLockBps) / 10000;
        if (lockAmount > payout) lockAmount = payout; // can never lock more than the payout
        _postWinLock[id][c.seats[winnerIdx]] += lockAmount;
        payout -= lockAmount;

        claimable[c.seats[winnerIdx]] += payout;
        c.won_[winnerIdx] = true;
        c.wonRound_[winnerIdx] = round;
        totalPayouts += 1;

        // on-time payment credit for winner (if they paid)
        if (c.paid[winnerIdx]) {
            _stats[c.seats[winnerIdx]].onTimePayments += 1;
        }

        // ── Step 4: dividend = discount + recovered debt, split to others ─────
        uint256 dividendPool = discount + clearedDebt;
        uint256 nonDefaultedOthers = 0;
        for (uint256 i = 0; i < n; i++) {
            if (i != winnerIdx && !c.defaulted_[i]) nonDefaultedOthers++;
        }

        uint256 dividendEach = 0;
        uint256 dust = 0;
        if (dividendPool > 0) {
            if (nonDefaultedOthers > 0) {
                dividendEach = dividendPool / nonDefaultedOthers;
                dust = dividendPool - dividendEach * nonDefaultedOthers;
            } else {
                // All others defaulted → entire dividend goes to winner
                dust = dividendPool;
            }
        }

        for (uint256 i = 0; i < n; i++) {
            if (i == winnerIdx) continue;
            if (c.defaulted_[i]) continue;
            claimable[c.seats[i]] += dividendEach;
            // on-time credit for other payers
            if (c.paid[i]) {
                _stats[c.seats[i]].onTimePayments += 1;
            }
        }

        // Dust to winner
        if (dust > 0) claimable[c.seats[winnerIdx]] += dust;
        totalDividendsPaid += dividendPool;

        emit RoundSettled(id, round, c.seats[winnerIdx], pot, discount, dividendEach);

        // ── Step 5: reset for next round / complete ───────────────────────────
        for (uint256 i = 0; i < n; i++) c.paid[i] = false;
        c.potAccumulated = 0;
        c.highestBidder = address(0);
        c.highestDiscount = 0;
        c.snipeExtensions = 0;

        if (round == c.params.maxMembers) {
            c.status = CircleStatus.Completed;
            // Unlock remaining deposits
            for (uint256 i = 0; i < n; i++) {
                uint256 dep = c.deposits[i];
                if (dep > 0) {
                    c.deposits[i] = 0;
                    claimable[c.seats[i]] += dep;
                }
                // Release any remaining post-win locks
                uint256 lock = _postWinLock[id][c.seats[i]];
                if (lock > 0) {
                    _postWinLock[id][c.seats[i]] = 0;
                    claimable[c.seats[i]] += lock;
                }
                if (!c.defaulted_[i]) {
                    _stats[c.seats[i]].circlesCompleted += 1;
                }
            }
            emit CircleCompleted(id);
        } else {
            c.currentRound += 1;
            c.roundEnd = block.timestamp + c.params.roundDuration;
        }

        // Record history
        _history[id].push(
            RoundRecord({
                winner: c.seats[winnerIdx],
                pot: pot,
                discount: discount,
                dividendPerMember: dividendEach
            })
        );
    }

    /// @notice Pre-store EIP-3009 authorizations for future rounds.
    /// @dev IMPORTANT: the signed EIP-3009 type MUST be ReceiveWithAuthorization, NOT
    ///      TransferWithAuthorization. Using TransferWithAuthorization would let anyone
    ///      move USDC into this contract without crediting the member's payment.
    /// @param circleId Circle id.
    /// @param rounds Array of round numbers to store authorizations for.
    /// @param validBefores Array of validBefore timestamps (one per round).
    /// @param vs Signature v components.
    /// @param rs Signature r components.
    /// @param ss Signature s components.

    function storeAuthorizations(
        uint256 circleId,
        uint8[] calldata rounds,
        uint256[] calldata validBefores,
        uint8[] calldata vs,
        bytes32[] calldata rs,
        bytes32[] calldata ss
    ) external nonReentrant {
        Circle storage c = _c[circleId];
        if (c.status == CircleStatus.Completed) revert CircleCompleted_();
        uint8 si = _seatOf(c, msg.sender);
        if (si == type(uint8).max) revert NotMember();

        uint256 len = rounds.length;
        if (len != validBefores.length || len != vs.length || len != rs.length || len != ss.length) {
            revert InvalidParams();
        }

        for (uint256 i = 0; i < len; i++) {
            uint8 rnd = rounds[i];
            if (rnd < c.currentRound) revert InvalidParams();
            if (rnd == c.currentRound && c.paid[si]) revert AlreadyPaid();
            // Disallow storing current-round auth after the deadline — would let
            // members avoid slashing by committing auth post-deadline at settle time.
            if (rnd == c.currentRound && c.status == CircleStatus.Active && block.timestamp >= c.roundEnd)
                revert RoundEnded();

            _auth[circleId][rnd][msg.sender] = StoredAuth({
                validBefore: validBefores[i],
                v: vs[i],
                r: rs[i],
                s: ss[i],
                exists: true
            });
        }
    }

    /// @notice Execute stored authorizations for the current round.
    ///         Anyone may call. Failures emit AutoPayFailed and continue.
    /// @param circleId Circle id.

    function executeAutoPay(uint256 circleId) external nonReentrant {
        Circle storage c = _c[circleId];
        if (c.status != CircleStatus.Active) revert CircleNotActive();
        _executeAutoPay(circleId, c, false);
    }

    /// @notice Delete stored authorizations for caller from `fromRound` onward.
    /// @param circleId Circle id.
    /// @param fromRound First round index to delete inclusively.

    function revokeAutoPay(uint256 circleId, uint8 fromRound) external nonReentrant {
        Circle storage c = _c[circleId];
        uint8 si = _seatOf(c, msg.sender);
        if (si == type(uint8).max) revert NotMember();

        for (uint8 rnd = fromRound; rnd <= c.params.maxMembers; rnd++) {
            if (_auth[circleId][rnd][msg.sender].exists) {
                delete _auth[circleId][rnd][msg.sender];
            }
        }
    }

    // ─── Withdraw ────────────────────────────────────────────────────────────

    /// @notice Pull any claimable USDC (payouts + deposits + dividends + refunds).

    function withdraw() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        PqGuard storage g = _pqGuard[msg.sender];
        if (g.enabled) {
            // Rolling 24h window reset
            if (block.timestamp >= g.windowStart + 24 hours) {
                g.dailyUsed = 0;
                g.windowStart = block.timestamp;
            }
            if (g.dailyUsed + amount > g.dailyFreeLimit) revert PqDailyLimitExceeded();
            g.dailyUsed += amount;
        }

        claimable[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Register an SLH-DSA-SHA2-128s verifying key. While enabled,
    ///         withdraw() is limited to dailyFreeLimit per 24h rolling window;
    ///         larger withdrawals require withdrawPq().
    /// @param vk 32-byte SLH-DSA verifying key.
    /// @param dailyFreeLimit USDC free per 24h rolling window.
    function enablePqGuard(bytes32 vk, uint256 dailyFreeLimit) external nonReentrant {
        PqGuard storage g = _pqGuard[msg.sender];
        if (g.enabled) revert PqGuardAlreadyEnabled();
        g.vk = vk;
        g.dailyFreeLimit = dailyFreeLimit;
        g.enabled = true;
        g.nonce = 0;
        g.dailyUsed = 0;
        g.windowStart = block.timestamp;
        emit PqGuardEnabled(msg.sender, vk);
    }

    /// @notice Withdraw USDC to a chosen address, authenticated by PQ signature.
    ///         The `to` address is bound in the signature, preventing key-only redirection.
    /// @param to Destination address.
    /// @param amount USDC to withdraw.
    /// @param sig 7856-byte SLH-DSA signature over the withdrawal message.
    function withdrawPq(address to, uint256 amount, bytes calldata sig) external nonReentrant {
        PqGuard storage g = _pqGuard[msg.sender];
        if (!g.enabled) revert PqGuardNotEnabled();
        if (amount == 0 || amount > claimable[msg.sender]) revert NothingToWithdraw();

        bytes memory message = abi.encodePacked(
            keccak256(abi.encode("KAMETI_PQ_WITHDRAW", block.chainid, address(this), msg.sender, to, amount, g.nonce))
        );
        _requirePqSig(g.vk, message, sig);
        g.nonce += 1;

        claimable[msg.sender] -= amount;
        usdc.safeTransfer(to, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Update the PQ verifying key and/or daily limit. Requires a PQ signature.
    /// @param newVk New 32-byte SLH-DSA verifying key.
    /// @param newLimit New daily free limit.
    /// @param sig PQ signature over the change message.
    function changePqGuard(bytes32 newVk, uint256 newLimit, bytes calldata sig) external nonReentrant {
        PqGuard storage g = _pqGuard[msg.sender];
        if (!g.enabled) revert PqGuardNotEnabled();

        bytes memory message = abi.encodePacked(
            keccak256(abi.encode("KAMETI_PQ_CHANGE", block.chainid, address(this), msg.sender, newVk, newLimit, g.nonce))
        );
        _requirePqSig(g.vk, message, sig);
        g.nonce += 1;

        g.vk = newVk;
        g.dailyFreeLimit = newLimit;
        g.timelockStart = 0; // cancel any pending timelock when key changes
        emit PqGuardChanged(msg.sender, newVk);
    }

    /// @notice Disable the PQ guard immediately. Requires a valid PQ signature.
    /// @param sig PQ signature over the disable message.
    function disablePqGuard(bytes calldata sig) external nonReentrant {
        PqGuard storage g = _pqGuard[msg.sender];
        if (!g.enabled) revert PqGuardNotEnabled();

        bytes memory message =
            abi.encodePacked(keccak256(abi.encode("KAMETI_PQ_DISABLE", block.chainid, address(this), msg.sender, g.nonce)));
        _requirePqSig(g.vk, message, sig);
        g.nonce += 1;

        g.enabled = false;
        g.timelockStart = 0;
        emit PqGuardDisabled(msg.sender);
    }

    /// @notice Begin a 7-day timelock to disable the PQ guard without the PQ key (lost key escape hatch).
    function requestPqDisable() external nonReentrant {
        PqGuard storage g = _pqGuard[msg.sender];
        if (!g.enabled) revert PqGuardNotEnabled();
        if (g.timelockStart != 0) revert PqTimelockAlreadyStarted();
        g.timelockStart = block.timestamp;
        emit PqDisableRequested(msg.sender, block.timestamp + PQ_TIMELOCK);
    }

    /// @notice Finalize PQ guard disable after the 7-day timelock has elapsed.
    function finalizePqDisable() external nonReentrant {
        PqGuard storage g = _pqGuard[msg.sender];
        if (!g.enabled) revert PqGuardNotEnabled();
        if (g.timelockStart == 0) revert PqTimelockNotStarted();
        if (block.timestamp < g.timelockStart + PQ_TIMELOCK) revert PqTimelockNotExpired();
        g.enabled = false;
        g.timelockStart = 0;
        emit PqGuardDisabled(msg.sender);
    }

    /// @notice Cancel a pending PQ timelock disable. Requires a valid PQ signature.
    /// @param sig PQ signature over the cancel message.
    function cancelPqDisable(bytes calldata sig) external nonReentrant {
        PqGuard storage g = _pqGuard[msg.sender];
        if (!g.enabled) revert PqGuardNotEnabled();
        if (g.timelockStart == 0) revert PqTimelockNotStarted();

        bytes memory message = abi.encodePacked(
            keccak256(abi.encode("KAMETI_PQ_CANCEL_DISABLE", block.chainid, address(this), msg.sender, g.nonce))
        );
        _requirePqSig(g.vk, message, sig);
        g.nonce += 1;

        g.timelockStart = 0;
        emit PqDisableCancelled(msg.sender);
    }

    // ─── Score ────────────────────────────────────────────────────────────────

    /// @notice Kameti Score: 300-900. Default = 600 for new wallets.
    /// @param addr Member address.
    /// @return score Current score for `addr`.
    function scoreOf(address addr) public view override returns (uint16 score) {
        IKametiScore.ScoreStats storage s = _stats[addr];
        int256 calc =
            600 + int256(uint256(s.onTimePayments)) * 5 + int256(uint256(s.circlesCompleted)) * 40
                - int256(uint256(s.strikes)) * 30 - int256(uint256(s.defaults)) * 120;
        if (calc > 900) calc = 900;
        if (calc < 300) calc = 300;
        return uint16(uint256(calc));
    }

    /// @notice Return aggregate score statistics for a member.
    /// @param addr Member address.
    /// @return stats Score stats struct.
    function statsOf(address addr) external view override returns (IKametiScore.ScoreStats memory stats) {
        IKametiScore.ScoreStats storage s = _stats[addr];
        return IKametiScore.ScoreStats({
            onTimePayments: s.onTimePayments,
            strikes: s.strikes,
            defaults: s.defaults,
            circlesCompleted: s.circlesCompleted,
            totalContributed: s.totalContributed
        });
    }

    /// @inheritdoc IKametiScore
    function isReliable(address who, uint16 minScore) external view override returns (bool) {
        return scoreOf(who) >= minScore;
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Return nonce binding for round contribution authorization.
    /// @param circleId Circle id.
    /// @param round Round number.
    /// @param member Member address.
    /// @return nonce Nonce bound to this contract, chain, circle, round, and member.
    function roundNonce(uint256 circleId, uint8 round, address member) public view returns (bytes32 nonce) {
        return keccak256(abi.encode(address(this), block.chainid, circleId, round, member));
    }

    /// @notice Return nonce binding for deposit authorization (join an existing circle).
    /// @param circleId Circle id.
    /// @param member Member address.
    /// @return nonce Nonce bound to this contract, chain, circle, the `deposit` domain, and member.
    function depositNonce(uint256 circleId, address member) public view returns (bytes32 nonce) {
        return keccak256(abi.encode(address(this), block.chainid, circleId, "deposit", member));
    }

    /// @notice Return the current nonce for createCircleWithAuthorization.
    ///         Uses a per-user counter so concurrent circle creations by others cannot shift it.
    /// @param creator Creator address.
    /// @return nonce Nonce for the creator's next circle creation authorization.
    function createDepositNonce(address creator) public view returns (bytes32 nonce) {
        return keccak256(abi.encode(address(this), block.chainid, "create", creator, createNonce[creator]));
    }

    /// @notice Return high-level circle state.
    /// @param id Circle id.
    /// @return params Circle parameters.
    /// @return status Circle lifecycle status.
    /// @return currentRound Current round index.
    /// @return roundEnd Current round deadline.
    /// @return potAccumulated Current round paid contributions tracked in-state.
    /// @return highestBidder Current highest bidder for the round.
    /// @return highestDiscount Current highest discount for the round.
    function getCircle(uint256 id)
        external
        view
        returns (
            CircleParams memory params,
            CircleStatus status,
            uint8 currentRound,
            uint256 roundEnd,
            uint256 potAccumulated,
            address highestBidder,
            uint256 highestDiscount
        )
    {
        Circle storage c = _c[id];
        return (
            c.params,
            c.status,
            c.currentRound,
            c.roundEnd,
            c.potAccumulated,
            c.highestBidder,
            c.highestDiscount
        );
    }

    /// @notice Return per-member status for a circle.
    /// @param id Circle id.
    /// @return infos Array of member status records.
    function getMembers(uint256 id) external view returns (MemberInfo[] memory infos) {
        Circle storage c = _c[id];
        uint256 n = c.seats.length;
        infos = new MemberInfo[](n);

        uint8 cur = c.currentRound;
        uint8 maxRnd = c.params.maxMembers;

        for (uint256 i = 0; i < n; i++) {
            bool hasStoredAuth = false;
            for (uint8 rnd = cur; rnd <= maxRnd; rnd++) {
                if (_auth[id][rnd][c.seats[i]].exists) {
                    hasStoredAuth = true;
                    break;
                }
            }

            infos[i] = MemberInfo({
                addr: c.seats[i],
                seat: uint8(i + 1),
                depositLeft: c.deposits[i],
                lockLeft: _postWinLock[id][c.seats[i]],
                paidThisRound: c.paid[i],
                won: c.won_[i],
                wonRound: c.wonRound_[i],
                defaulted: c.defaulted_[i],
                debt: c.debt_[i],
                hasStoredAuth: hasStoredAuth
            });
        }
    }

    /// @notice Protection breakdown for a member in a circle.
    /// @param circleId Circle id.
    /// @param member Member address.
    /// @return depositLeft Current deposit balance.
    /// @return lockLeft Post-win lock still held.
    /// @return futureObligation Contributions still owed (remaining rounds × contribution).
    function protectionOf(uint256 circleId, address member)
        external
        view
        returns (uint256 depositLeft, uint256 lockLeft, uint256 futureObligation)
    {
        Circle storage c = _c[circleId];
        uint8 si = _seatOf(c, member);
        if (si == type(uint8).max) return (0, 0, 0);
        depositLeft = c.deposits[si];
        lockLeft = _postWinLock[circleId][member];
        uint8 n = c.params.maxMembers;
        uint8 cur = c.currentRound > 0 ? c.currentRound : 1;
        // Paid-so-far count: wonRound rounds already completed
        uint8 won_ = c.wonRound_[si];
        uint8 roundsPaid = won_ > 0 ? won_ : (cur > 1 ? cur - 1 : 0);
        if (n > roundsPaid) {
            futureObligation = uint256(n - roundsPaid) * c.params.contribution;
        }
    }

    /// @notice Returns which future rounds have a stored, unused authorization for a member.
    /// @param circleId Circle id.
    /// @param member Member address.
    /// @return rounds Array of rounds with stored authorizations.
    function getMemberAutoPay(uint256 circleId, address member) external view returns (uint8[] memory rounds) {
        Circle storage c = _c[circleId];
        uint8 maxRnd = c.params.maxMembers;
        uint8 cur = c.currentRound;
        uint8[] memory tmp = new uint8[](maxRnd);
        uint8 count = 0;

        for (uint8 rnd = cur; rnd <= maxRnd; rnd++) {
            if (_auth[circleId][rnd][member].exists) {
                tmp[count++] = rnd;
            }
        }

        rounds = new uint8[](count);
        for (uint8 i = 0; i < count; i++) {
            rounds[i] = tmp[i];
        }
    }

    /// @notice Return all settled round records for a circle.
    /// @param id Circle id.
    /// @return records Round history records.
    function getRoundHistory(uint256 id) external view returns (RoundRecord[] memory records) {
        return _history[id];
    }

    /// @notice Return all circle ids a member belongs to.
    /// @param member Member address.
    /// @return ids Circle ids associated with the member.
    function circlesOf(address member) external view returns (uint256[] memory ids) {
        return _memberOf[member];
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _pay(uint256 id, address member, bool auto_) internal {
        Circle storage c = _c[id];
        if (c.status != CircleStatus.Active) revert CircleNotActive();
        if (block.timestamp >= c.roundEnd) revert RoundEnded();

        uint8 si = _seatOf(c, member);
        if (si == type(uint8).max) revert NotMember();
        if (c.paid[si]) revert AlreadyPaid();

        _receiveExact(member, c.params.contribution);

        c.paid[si] = true;
        // Release post-win lock fraction for winner's on-time payment
        if (_postWinLock[id][c.seats[si]] > 0) {
            uint256 release = (c.params.contribution * c.params.postWinLockBps) / 10000;
            if (release > _postWinLock[id][c.seats[si]]) release = _postWinLock[id][c.seats[si]];
            _postWinLock[id][c.seats[si]] -= release;
            claimable[c.seats[si]] += release;
        }
        c.potAccumulated += c.params.contribution;
        _stats[member].totalContributed += c.params.contribution;

        emit ContributionPaid(id, c.currentRound, member, c.params.contribution, auto_);
    }

    function _executeAutoPay(uint256 circleId, Circle storage c, bool settlePath) internal {
        uint256 n = c.seats.length;
        uint8 round = c.currentRound;

        for (uint256 i = 0; i < n; i++) {
            if (c.paid[i]) continue;

            address member = c.seats[i];
            StoredAuth storage auth = _auth[circleId][round][member];
            if (!auth.exists) continue;

            if (!settlePath && block.timestamp >= c.roundEnd) continue;

            // Gas-griefing guard: refuse to attempt the call if there is not
            // enough gas for it to run.  A griefing caller who passes a tight
            // gas limit hits this check, and we revert the whole transaction
            // rather than letting the inner call be starved and recording a
            // spurious AutoPayFailed that might get the member slashed.
            if (gasleft() < AUTOPAY_MIN_GAS) revert InsufficientGasForAutoPay();

            uint256 gasBeforeCall = gasleft();
            uint256 before = usdc.balanceOf(address(this));

            try IUSDC3009(address(usdc)).receiveWithAuthorization{gas: AUTOPAY_MIN_GAS - 5_000}(
                member,
                address(this),
                c.params.contribution,
                0,
                auth.validBefore,
                roundNonce(circleId, round, member),
                auth.v,
                auth.r,
                auth.s
            ) {
                // If the inner call consumed nearly all of its gas budget (i.e., it was
                // starved by the 63/64 rule despite our explicit stipend), treat this as
                // a griefing attempt and revert the whole transaction.
                if (gasleft() < gasBeforeCall / 64) revert InsufficientGasForAutoPay();

                if (usdc.balanceOf(address(this)) - before == c.params.contribution) {
                    c.paid[i] = true;
                    // Release post-win lock fraction for winner's on-time payment
                    if (_postWinLock[circleId][c.seats[i]] > 0) {
                        uint256 release = (c.params.contribution * c.params.postWinLockBps) / 10000;
                        if (release > _postWinLock[circleId][c.seats[i]]) release = _postWinLock[circleId][c.seats[i]];
                        _postWinLock[circleId][c.seats[i]] -= release;
                        claimable[c.seats[i]] += release;
                    }
                    c.potAccumulated += c.params.contribution;
                    _stats[member].totalContributed += c.params.contribution;
                    delete _auth[circleId][round][member];
                    emit ContributionPaid(circleId, round, member, c.params.contribution, true);
                    emit AutoPayExecuted(circleId, round, member);
                } else {
                    emit AutoPayFailed(circleId, round, member, 1);
                }
            } catch {
                // If gas was starved, revert instead of recording a spurious failure.
                if (gasleft() < gasBeforeCall / 64) revert InsufficientGasForAutoPay();
                emit AutoPayFailed(circleId, round, member, 0);
            }
        }
    }

    /// @dev Verify a PQ (SLH-DSA-SHA2-128s) signature via the Arc precompile.
    ///      Rejects on: wrong key/sig length, precompile revert, empty return, false result.
    ///      A forged signature returns false; malformed inputs revert the precompile itself.
    function _requirePqSig(bytes32 vk, bytes memory message, bytes calldata sig) internal view {
        if (sig.length != PQ_SIG_LEN) revert PqInvalidSignature();
        bytes memory vkBytes = abi.encodePacked(vk);
        if (vkBytes.length != PQ_VK_LEN) revert PqInvalidKeyLength();
        // staticcall the precompile; treat call failure OR false return as invalid
        (bool ok, bytes memory ret) = PQ_PRECOMPILE.staticcall(
            abi.encodeWithSelector(IPQVerify.verifySlhDsaSha2128s.selector, vkBytes, message, sig)
        );
        if (!ok) revert PqInvalidSignature();
        if (ret.length < 32) revert PqInvalidSignature();
        if (!abi.decode(ret, (bool))) revert PqInvalidSignature();
    }

    /// @dev Transfer exactly `amount` from `from`; revert on fee-on-transfer discrepancy.
    function _receiveExact(address from, uint256 amount) internal {
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(from, address(this), amount);
        if (usdc.balanceOf(address(this)) - before != amount) revert InvalidParams();
    }

    /// @dev Return the 0-based index of `addr` in `c.seats`, or type(uint8).max if absent.
    function _seatOf(Circle storage c, address addr) internal view returns (uint8) {
        uint256 n = c.seats.length;
        for (uint256 i = 0; i < n; i++) {
            if (c.seats[i] == addr) return uint8(i);
        }
        return type(uint8).max;
    }

    /// @dev Count members who are eligible to win: not won, not defaulted.
    function _eligibleCount(Circle storage c) internal view returns (uint256 count) {
        uint256 n = c.seats.length;
        for (uint256 i = 0; i < n; i++) {
            if (!c.won_[i] && !c.defaulted_[i]) count++;
        }
    }

    /// @dev True when every member has paid this round.
    function _allPaid(Circle storage c) internal view returns (bool) {
        uint256 n = c.seats.length;
        for (uint256 i = 0; i < n; i++) {
            if (!c.paid[i]) return false;
        }
        return true;
    }

    /// @dev Pick winner index. Highest bidder if they are still eligible; else lowest eligible seat.
    ///      If no eligible members, fall back to lowest non-winner seat regardless of defaulted status.
    function _pickWinner(Circle storage c) internal view returns (uint8) {
        uint256 n = c.seats.length;

        // Check if highest bidder is still eligible
        if (c.highestBidder != address(0)) {
            uint8 bi = _seatOf(c, c.highestBidder);
            if (bi != type(uint8).max && !c.won_[bi] && !c.defaulted_[bi]) {
                return bi;
            }
        }

        // Lowest eligible seat (not won, not defaulted)
        for (uint256 i = 0; i < n; i++) {
            if (!c.won_[i] && !c.defaulted_[i]) return uint8(i);
        }

        // Fallback: lowest non-winner seat (even if defaulted)
        for (uint256 i = 0; i < n; i++) {
            if (!c.won_[i]) return uint8(i);
        }

        // Should never reach here in a well-formed circle
        return 0;
    }
}
