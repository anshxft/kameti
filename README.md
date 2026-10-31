# Kameti

**A kameti nobody can run away with.** Save together in USDC, bid for the pot when you need it, earn dividends while you wait. Enforced by a contract on Arc, not by an organiser. Built end to end in [Arc Studio](https://studio.arc.io).

| | |
|---|---|
| Live app | https://kameti-khaki.vercel.app |
| Review it in 60 seconds | https://kameti-khaki.vercel.app/reviewers |
| Try to break it | https://kameti-khaki.vercel.app/break |
| Arc Studio project | https://studio.arc.io/app/81700373-0f8c-4789-9edf-fbad498edef8 |
| Contract (Arc mainnet) | `<MAINNET_ADDRESS>` |
| Contract (Arc testnet) | [`0x34f31472c5d16e0562668fbea1e700b19b2ea5a7`](https://explorer.testnet.arc.io/address/0x34f31472c5d16e0562668fbea1e700b19b2ea5a7) |

## The problem

Rotating savings circles (kameti, committee, chit fund, tanda, susu, hui) move money for hundreds of millions of people. They run on one notebook and one organiser's honesty, and they get cheated in four ways:

1. **The organiser runs with the pot.**
2. **An early winner stops paying** once they have the money.
3. **Members forget or skip rounds**, and everyone else is short.
4. **Nobody agrees on the hisaab** of who paid, who won and what is owed.

WhatsApp groups and register-books don't fix this, because whoever holds the money can still walk away. Good savers also carry no record into the next circle.

## Enforced on-chain

| Risk | What the contract does |
|---|---|
| Organiser runs with the pot | There is no organiser account. No owner, no admin key, no pause, no upgrade. The pot only leaves through `settleRound` to that round's winner. |
| Early winner stops paying | **Post-win lock**: part of the winner's payout stays locked and is released as they keep paying. A missed payment is covered from the lock first, then the deposit. |
| Member skips a round | **Security deposit** (1–3× the contribution) covers it at settlement; the member gets a strike. Once the deposit runs out, the shortfall becomes debt taken from their later payout. |
| Member forgets to pay | **Pre-signed AutoPay**: members sign one EIP-3009 `ReceiveWithAuthorization` per round when they join; the signatures are stored on-chain and executed by anyone, including during settlement. No server, no allowance. |
| Disputes over the hisaab | Every payment, bid, settlement, slash, lock release and withdrawal is an event on Arc, readable on `/verify` without a wallet. |
| Stolen wallet key | Optional **post-quantum guard**: above a daily limit, withdrawals also need an SLH-DSA-SHA2-128s signature checked by Arc's precompile `0x1800…0004`, and the signature fixes the destination. |
| Last-second bid sniping | **Soft close**: a bid in the last window extends the round, up to a cap. |

## How a circle works

1. **Create**: contribution, 3–10 members, round length, deposit multiplier, post-win lock, maximum discount (≤ 40%), keeper tip (≤ 0.2%, capped at 0.05 USDC) and an optional minimum Kameti Score.
2. **Join** with one signature that locks the deposit (no approve transaction). The circle starts when every seat is filled.
3. **Turn on AutoPay**: sign each remaining round once; one transaction stores them.
4. **Bid**: members who still need the pot bid a discount. Highest discount wins.
5. **Settle**: anyone can settle after the deadline and earns the keeper tip. The winner gets `pot − discount`, minus the post-win lock; the discount is paid to the other members as a dividend.
6. **Repeat** until every member has received the pot once. Deposits and remaining locks come back at the end.

**Example:** 5 members × 10 USDC = 50 USDC pot. In round 1 a member who needs cash bids 10% and receives 45 USDC (part of it locked until they finish paying). Each of the other 4 earns 1.25 USDC. Waiting longer earns more.

## Why only on Arc

| | Any other EVM chain | Arc |
|---|---|---|
| Gas | ETH plus the stablecoin | USDC is the gas token: members hold one asset |
| Pre-signed payments | approve + an off-chain keeper with a key | EIP-3009 `ReceiveWithAuthorization` on native USDC, consumed only by the Kameti contract |
| Finality | minutes | under a second |
| Post-quantum check | not available | SLH-DSA precompile at `0x1800…0004` |
| Cost of one payment | volatile | stable, a fraction of a cent (live on the site) |

## Kameti Score

A 300–900 on-chain credit score (the same range as Indian credit bureaus), built from a wallet's history across all circles:

```
score = 600 + 5·onTimePayments + 40·circlesCompleted − 30·strikes − 120·defaults   (clamped to 300..900)
```

Circles can require a minimum score to join. Other Arc apps can read it through `IKametiScore` (`scoreOf`, `statsOf`, `isReliable`).

## Keeper Agent

A small agent runs every 5 minutes, executes stored AutoPay authorizations, settles rounds whose deadline has passed and collects the keeper tip, so it pays for its own gas. Anyone can run one; the contract does not depend on it. Its balance and actions are public on `/agent`.

## Contract

`contracts/Kameti.sol`, Solidity 0.8.28, OpenZeppelin 5 (`SafeERC20`, `ReentrancyGuard`), no owner. USDC through its ERC-20 interface on Arc (`0x3600…0000`, 6 decimals).

| Function | Who | What |
|---|---|---|
| `createCircle` / `createCircleWithAuthorization` | anyone | new circle; creator takes seat 1 and locks the deposit |
| `join` / `joinWithAuthorization` / `leave` | member | lock or refund the deposit while the circle is open |
| `pay` / `payWithAuthorization` | member (relayable) | this round's contribution before the deadline |
| `storeAuthorizations` / `revokeAutoPay` | member | pre-signed AutoPay for future rounds |
| `executeAutoPay` | anyone | run stored authorizations for the current round |
| `placeBid` | paid, not yet won | ascending auction, 1% minimum step, capped, soft close |
| `settleRound` | anyone | AutoPay pass, slash, keeper tip, winner payout + lock, dividends |
| `withdraw` / `withdrawPq` | member | pull everything credited to you; PQ-signed above the daily limit |
| `enablePqGuard` / `changePqGuard` / `disablePqGuard` / `requestPqDisable` | member | manage the post-quantum guard (7-day timelock if the PQ key is lost) |
| `scoreOf` / `statsOf` / `isReliable` / `protectionOf` | view | score and protection |

## Testing and checks

- **137 Foundry tests**, all passing (`forge test`): exact payouts and dividends, every bid and deadline rule, slashing, debt, post-win lock, keeper tip, AutoPay replay/cross-round/cross-circle rejection, gas-starvation griefing, PQ guard against mocks that return false, revert, return nothing or return non-booleans.
- **Two handler-based invariants**, 256 runs × 500 calls each: the USDC held by the contract always equals deposits + post-win locks + current pots + claimable balances, across payments, bids, AutoPay, cancellations, settlements and withdrawals.
- **Live on Arc testnet**: a real SLH-DSA-SHA2-128s signature verifies through the precompile and a tampered one is rejected; `receiveWithAuthorization` on Arc USDC measured at 88,067 gas including the transaction base cost, well inside the AutoPay gas reserve.
- Arc Studio's solidity and functional auditors reviewed every version at the max preset; each finding was fixed in Studio. See [SECURITY.md](SECURITY.md) for the threat model and known limits.

The contract has **not** had an independent audit. Use small amounts.

## How it was built in Arc Studio

Every contract line, test and screen came out of Arc Studio, driven through its CLI from a coding agent. Each bug found in review or in the browser went back to Studio as a prompt and was fixed there:

1. v1: circle, tests and the Cybercore design system; Studio's auditors found fund-lock and griefing risks, fixed with pull payments.
2. v2: a real chit fund (bidding, deposits, debt, Kameti Score), max preset with fuzz and invariant tests; review caught a missing deadline check in `pay`.
3. v3: pre-signed AutoPay on Arc's EIP-3009 USDC, one-signature join and pay, soft-close auctions.
4. v3.1: post-win lock, keeper tip, post-quantum withdrawal guard, `IKametiScore`; review caught a 63/64 gas-griefing path that could slash honest members, fixed with a gas reserve and starvation check.
5. Mainnet deploy from a Circle developer wallet through Studio.

## Run locally

```bash
bun install          # or npm install --legacy-peer-deps
bun run dev          # app
forge test           # contracts
```

## What it does not do yet

- No independent audit.
- Bids are open, not sealed.
- Deposits and locks do not earn yield.
- No INR on-ramp; members need USDC on Arc.
- The post-quantum precompile is marked experimental by Arc; PQ signatures are a second factor, never the only one.

## Roadmap

Sealed-bid rounds · yield on locked deposits · insurance pool from a slice of dividends · reminders over Telegram/WhatsApp · organiser commission option for community-run circles · Kameti Score as an attestation for lending and rentals.

## License

MIT
