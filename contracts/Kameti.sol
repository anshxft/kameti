// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Kameti v2 — Onchain Chit Fund / ROSCA with auction, deposits, and credit score
/// @notice Members join a circle, pay contributions each round, bid for the pot,
///         and the winner (highest bidder, or lowest seat by default) receives the pot
///         minus their bid discount. Dividends from discounts are split among other members.
contract Kameti is ReentrancyGuard {
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
    error AutoPayNotEnabled();
    error CircleAlreadyStarted();
    error CannotLeaveActiveCircle();
    error RoundEnded();

    // ─── Enums & structs ─────────────────────────────────────────────────────
    enum CircleStatus { Open, Active, Completed }

    struct CircleParams {
        string  name;
        uint256 contribution;     // USDC per round (6 dec)
        uint8   maxMembers;       // 3..10
        uint256 roundDuration;    // seconds, >= 10 min
        uint8   depositMultiplier; // 1..3
        uint16  maxDiscountBps;   // <= 4000 (40 %)
        uint16  minScore;         // 0..900
    }

    struct MemberInfo {
        address addr;
        uint8   seat;            // 1-based join order
        uint256 depositLeft;     // current locked deposit
        bool    paidThisRound;
        bool    won;
        uint8   wonRound;
        bool    defaulted;
        uint256 debt;            // unpaid contribution shortfall
        bool    autoPay;
    }

    struct Circle {
        CircleParams params;
        CircleStatus status;
        uint8   currentRound;    // 1-based; 0 = not started
        uint256 roundEnd;        // timestamp
        uint256 potAccumulated;  // USDC paid into pot this round
        address highestBidder;
        uint256 highestDiscount; // USDC the bidder gives up
        // parallel arrays — index = seat-1
        address[] seats;         // stable seat order (set on start)
        uint256[] deposits;
        bool[]   paid;
        bool[]   won_;
        uint8[]  wonRound_;
        bool[]   defaulted_;
        uint256[] debt_;
        bool[]   autoPay_;
    }

    struct RoundRecord {
        address winner;
        uint256 pot;
        uint256 discount;
        uint256 dividendPerMember;
    }

    struct ScoreStats {
        uint32 onTimePayments;
        uint32 strikes;           // missed round, covered by deposit
        uint32 defaults;          // deposit exhausted
        uint32 circlesCompleted;
        uint256 totalContributed; // USDC units
    }

    // ─── State ───────────────────────────────────────────────────────────────
    IERC20 public immutable usdc;

    uint256 public totalCircles;
    uint256 public totalContributed;   // all-time USDC contributed
    uint256 public totalPayouts;       // count of pot claims
    uint256 public totalDividendsPaid; // all-time dividend USDC

    uint256 private _nextId;

    mapping(uint256 => Circle)                     internal _c;
    mapping(uint256 => RoundRecord[])              internal _history; // 0-based index = round-1
    mapping(address => uint256[])                  internal _memberOf;
    mapping(address => uint256)                    public   claimable;
    mapping(address => ScoreStats)                 internal _stats;

    // ─── Events ──────────────────────────────────────────────────────────────
    event CircleCreated(uint256 indexed id, string name, uint256 contribution, uint8 maxMembers, address indexed creator);
    event MemberJoined(uint256 indexed id, address indexed member, uint8 seat);
    event MemberLeft(uint256 indexed id, address indexed member);
    event ContributionPaid(uint256 indexed id, uint8 round, address indexed member, uint256 amount, bool autoPay);
    event BidPlaced(uint256 indexed id, uint8 round, address indexed bidder, uint256 discount);
    event DepositSlashed(uint256 indexed id, uint8 round, address indexed member, uint256 slashed, uint256 shortfall);
    event RoundSettled(uint256 indexed id, uint8 round, address indexed winner, uint256 pot, uint256 discount, uint256 dividendPerMember);
    event AutoPayExecuted(uint256 indexed id, uint8 round, address indexed member);
    event AutoPayFailed(uint256 indexed id, uint8 round, address indexed member);
    event Withdrawn(address indexed member, uint256 amount);
    event CircleCompleted(uint256 indexed id);

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(address usdcAddress) {
        if (usdcAddress == address(0)) revert InvalidParams();
        if (usdcAddress.code.length == 0) revert InvalidParams();
        usdc = IERC20(usdcAddress);
    }

    // ─── Circle creation ─────────────────────────────────────────────────────

    /// @notice Create a new circle. Creator auto-joins as seat 1 and pays the deposit.
    function createCircle(
        string calldata name,
        uint256 contribution,
        uint8  maxMembers,
        uint256 roundDuration,
        uint8  depositMultiplier,
        uint16 maxDiscountBps,
        uint16 minScore
    ) external nonReentrant returns (uint256 id) {
        if (contribution == 0) revert InvalidParams();
        if (maxMembers < 3 || maxMembers > 10) revert InvalidParams();
        if (roundDuration < 10 minutes) revert InvalidParams();
        if (depositMultiplier < 1 || depositMultiplier > 3) revert InvalidParams();
        if (maxDiscountBps > 4000) revert InvalidParams();
        if (minScore > 900) revert InvalidParams();

        id = _nextId++;

        Circle storage c = _c[id];
        c.params = CircleParams(name, contribution, maxMembers, roundDuration, depositMultiplier, maxDiscountBps, minScore);
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
        c.autoPay_.push(false);

        _memberOf[msg.sender].push(id);
        totalCircles += 1;

        // Collect deposit from creator
        _receiveExact(msg.sender, deposit);

        emit CircleCreated(id, name, contribution, maxMembers, msg.sender);
        emit MemberJoined(id, msg.sender, 1);
    }

    /// @notice Join an open circle (score gate, deposit required).
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
        c.autoPay_.push(false);

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

    /// @notice Leave an open (not-yet-started) circle, reclaim deposit.
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
            c.seats[i]     = c.seats[i+1];
            c.deposits[i]  = c.deposits[i+1];
            c.paid[i]      = c.paid[i+1];
            c.won_[i]      = c.won_[i+1];
            c.wonRound_[i] = c.wonRound_[i+1];
            c.defaulted_[i]= c.defaulted_[i+1];
            c.debt_[i]     = c.debt_[i+1];
            c.autoPay_[i]  = c.autoPay_[i+1];
        }
        c.seats.pop(); c.deposits.pop(); c.paid.pop(); c.won_.pop();
        c.wonRound_.pop(); c.defaulted_.pop(); c.debt_.pop(); c.autoPay_.pop();

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
    function pay(uint256 id) external nonReentrant {
        _pay(id, msg.sender, false);
    }

    /// @notice Place a bid for this round's pot (ascending auction).
    /// @param discount  USDC the bidder gives up from the pot.
    function placeBid(uint256 id, uint256 discount) external {
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

        c.highestBidder  = msg.sender;
        c.highestDiscount = discount;

        emit BidPlaced(id, c.currentRound, msg.sender, discount);
    }

    /// @notice Settle the current round. Callable by anyone after roundEnd,
    ///         or early when every member has paid AND ≤1 eligible winner remains.
    function settleRound(uint256 id) external nonReentrant {
        Circle storage c = _c[id];
        if (c.status != CircleStatus.Active) revert CircleNotActive();

        bool deadlinePassed = block.timestamp >= c.roundEnd;
        bool earlySettle    = _allPaid(c) && _eligibleCount(c) <= 1;

        if (!deadlinePassed && !earlySettle) revert RoundNotSettleable();

        uint8 round = c.currentRound;
        uint256 n   = c.seats.length;

        // ── Step 1: slash non-payers ─────────────────────────────────────────
        uint256 pot = 0;
        for (uint256 i = 0; i < n; i++) {
            if (c.paid[i]) {
                pot += c.params.contribution;
            } else {
                uint256 cover = c.deposits[i] >= c.params.contribution
                    ? c.params.contribution
                    : c.deposits[i];
                c.deposits[i] -= cover;
                pot += cover;

                uint256 shortfall = c.params.contribution - cover;
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

        // ── Step 2: pick winner ───────────────────────────────────────────────
        uint8 winnerIdx = _pickWinner(c);

        // ── Step 3: apply winner payout ───────────────────────────────────────
        uint256 discount = (c.highestBidder == c.seats[winnerIdx])
            ? c.highestDiscount
            : 0;

        uint256 winnerDebt = c.debt_[winnerIdx];
        uint256 payout     = pot - discount;
        if (payout >= winnerDebt) {
            payout -= winnerDebt;
            c.debt_[winnerIdx] = 0;
        } else {
            c.debt_[winnerIdx] -= payout;
            payout = 0;
        }
        uint256 clearedDebt = winnerDebt - c.debt_[winnerIdx];

        claimable[c.seats[winnerIdx]] += payout;
        c.won_[winnerIdx]      = true;
        c.wonRound_[winnerIdx] = round;
        totalPayouts          += 1;

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
        uint256 dust         = 0;
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
        c.potAccumulated  = 0;
        c.highestBidder   = address(0);
        c.highestDiscount = 0;

        if (round == c.params.maxMembers) {
            c.status = CircleStatus.Completed;
            // Unlock remaining deposits
            for (uint256 i = 0; i < n; i++) {
                uint256 dep = c.deposits[i];
                if (dep > 0) {
                    c.deposits[i] = 0;
                    claimable[c.seats[i]] += dep;
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
        _history[id].push(RoundRecord({
            winner:            c.seats[winnerIdx],
            pot:               pot,
            discount:          discount,
            dividendPerMember: dividendEach
        }));
    }

    // ─── AutoPay ─────────────────────────────────────────────────────────────

    /// @notice Toggle AutoPay for a circle. Member must separately approve USDC allowance.
    function setAutoPay(uint256 id, bool enabled) external {
        Circle storage c = _c[id];
        uint8 si = _seatOf(c, msg.sender);
        if (si == type(uint8).max) revert NotMember();
        c.autoPay_[si] = enabled;
    }

    /// @notice Pay on behalf of a specific member (autopay must be on, member unpaid).
    function payFor(uint256 id, address member) external nonReentrant {
        Circle storage c = _c[id];
        uint8 si = _seatOf(c, member);
        if (si == type(uint8).max) revert NotMember();
        if (!c.autoPay_[si]) revert AutoPayNotEnabled();
        if (c.paid[si]) revert AlreadyPaid();
        _pay(id, member, true);
    }

    /// @notice Try autopay for every unpaid autopay member; skips failures silently.
    function payAllAutoPay(uint256 id) external nonReentrant {
        Circle storage c = _c[id];
        if (c.status != CircleStatus.Active) revert CircleNotActive();
        // Skip the whole batch silently if the round has already ended (settle first)
        if (block.timestamp >= c.roundEnd) return;
        uint256 n = c.seats.length;
        for (uint256 i = 0; i < n; i++) {
            if (!c.autoPay_[i] || c.paid[i]) continue;
            address member = c.seats[i];
            // Try transfer; skip on failure
            uint256 bal = usdc.balanceOf(member);
            uint256 allowance = usdc.allowance(member, address(this));
            if (bal < c.params.contribution || allowance < c.params.contribution) {
                emit AutoPayFailed(id, c.currentRound, member);
                continue;
            }
            uint256 before = usdc.balanceOf(address(this));
            bool ok = false;
            try IERC20(address(usdc)).transferFrom(member, address(this), c.params.contribution) returns (bool success) {
                ok = success && (usdc.balanceOf(address(this)) - before == c.params.contribution);
            } catch {
                ok = false;
            }
            if (!ok) {
                emit AutoPayFailed(id, c.currentRound, member);
                continue;
            }
            c.paid[i] = true;
            c.potAccumulated += c.params.contribution;
            _stats[member].totalContributed += c.params.contribution;
            emit ContributionPaid(id, c.currentRound, member, c.params.contribution, true);
            emit AutoPayExecuted(id, c.currentRound, member);
        }
    }

    // ─── Withdraw ────────────────────────────────────────────────────────────

    /// @notice Pull any claimable USDC (payouts + deposits + dividends + refunds).
    function withdraw() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        claimable[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ─── Score ────────────────────────────────────────────────────────────────

    /// @notice Kameti Score: 300-900. Default = 600 for new wallets.
    function scoreOf(address addr) public view returns (uint16) {
        ScoreStats storage s = _stats[addr];
        int256 score = 600
            + int256(uint256(s.onTimePayments)) * 5
            + int256(uint256(s.circlesCompleted)) * 40
            - int256(uint256(s.strikes)) * 30
            - int256(uint256(s.defaults)) * 120;
        if (score > 900) score = 900;
        if (score < 300) score = 300;
        return uint16(uint256(score));
    }

    function statsOf(address addr) external view returns (ScoreStats memory) {
        return _stats[addr];
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getCircle(uint256 id) external view returns (
        CircleParams memory params,
        CircleStatus status,
        uint8  currentRound,
        uint256 roundEnd,
        uint256 potAccumulated,
        address highestBidder,
        uint256 highestDiscount
    ) {
        Circle storage c = _c[id];
        return (c.params, c.status, c.currentRound, c.roundEnd,
                c.potAccumulated, c.highestBidder, c.highestDiscount);
    }

    function getMembers(uint256 id) external view returns (MemberInfo[] memory) {
        Circle storage c = _c[id];
        uint256 n = c.seats.length;
        MemberInfo[] memory infos = new MemberInfo[](n);
        for (uint256 i = 0; i < n; i++) {
            infos[i] = MemberInfo({
                addr:         c.seats[i],
                seat:         uint8(i + 1),
                depositLeft:  c.deposits[i],
                paidThisRound: c.paid[i],
                won:          c.won_[i],
                wonRound:     c.wonRound_[i],
                defaulted:    c.defaulted_[i],
                debt:         c.debt_[i],
                autoPay:      c.autoPay_[i]
            });
        }
        return infos;
    }

    function getRoundHistory(uint256 id) external view returns (RoundRecord[] memory) {
        return _history[id];
    }

    function circlesOf(address member) external view returns (uint256[] memory) {
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
        c.potAccumulated += c.params.contribution;
        _stats[member].totalContributed += c.params.contribution;

        emit ContributionPaid(id, c.currentRound, member, c.params.contribution, auto_);
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
