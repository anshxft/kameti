# Kameti

**A real chit fund on Arc.** Pay into a savings circle each round, bid for the pot when you need cash, earn dividends while you wait. Settled in USDC, enforced by a contract, built end to end in [Arc Studio](https://studio.arc.io).

| | |
|---|---|
| Live app | `<LIVE_URL>` |
| Arc Studio project | https://studio.arc.io/app/81700373-0f8c-4789-9edf-fbad498edef8 |
| Contract (Arc mainnet) | `<MAINNET_ADDRESS>` |
| Contract (Arc testnet) | [`0x8a6ed216d5c38f0a35f97c327d79e4d456c9db6c`](https://explorer.testnet.arc.io/address/0x8a6ed216d5c38f0a35f97c327d79e4d456c9db6c) |

## Why

Rotating savings circles (kameti, committee, chit fund, tanda, susu, hui) move money for hundreds of millions of people. They run on trust in an organiser and a notebook. When someone takes the pot early and stops paying, the rest of the group loses. There is no record of who was reliable, so good savers carry no reputation into the next circle.

Kameti keeps the parts people like (save together, get a lump sum in turn, the bidding that makes chit funds pay a return) and moves the trust into a contract.

## How a circle works

1. **Create.** Pick the contribution, 3 to 10 members, round length, security deposit (1x to 3x the contribution), maximum discount (up to 40%) and an optional minimum Kameti Score.
2. **Join.** Each member locks the security deposit. The circle starts when every seat is filled.
3. **Pay.** Every round each member pays the contribution before the deadline.
4. **Bid.** Members who still need the pot bid a discount: the amount they give up to take it now. Highest discount wins.
5. **Settle.** Anyone can settle after the deadline. The winner gets `pot - discount`; the discount is shared equally among the other members as a dividend.
6. **Repeat** until every member has received the pot once. The last member takes it with no auction. Deposits come back at the end.

**Example:** 5 members × 10 USDC = 50 USDC pot. In round 1 a member who needs cash bids a 10% discount and receives 45 USDC. Each of the other 4 earns 1.25 USDC. Members who wait longer earn more.

## Protection against default

- **Missed payment.** At settlement, a missing contribution is taken from that member's deposit, so the pot stays whole. The member gets a strike.
- **Deposit exhausted.** The shortfall becomes the member's debt and they are marked defaulted: they cannot bid, they receive no dividends, and their debt is deducted from any later payout and shared with the others.
- **Pull payments.** Payouts, dividends and refunds are credited and withdrawn by each member, so one blocked address cannot freeze a circle.

## Kameti Score

A 300 to 900 on-chain credit score (the same range as Indian credit bureaus), built from a wallet's history across all circles:

```
score = 600 + 5·onTimePayments + 40·circlesCompleted − 30·strikes − 120·defaults   (clamped to 300..900)
```

Circle creators can require a minimum score to join, so reliable savers get into better circles. Anyone can look up any address at `/score/<address>`.

## AutoPay

Like UPI AutoPay: a member approves USDC once and switches AutoPay on. After that, anyone (the member, another member, or a bot) can call `payAllAutoPay` and every due contribution is pulled in one transaction. Members without enough balance or allowance are skipped, not reverted. AutoPay payments count as on time.

## Contract

`contracts/Kameti.sol`, Solidity 0.8.28, OpenZeppelin 5 (`SafeERC20`, `ReentrancyGuard`). USDC through its ERC-20 interface on Arc (`0x3600…0000`, 6 decimals).

| Function | Who | What |
|---|---|---|
| `createCircle` | anyone | new circle, creator takes seat 1 |
| `join` / `leave` | member | lock / refund the deposit while the circle is open |
| `pay` | member | this round's contribution, before the deadline |
| `placeBid` | paid, not yet won | ascending auction, 1% minimum step, capped |
| `settleRound` | anyone | slash, pick winner, pay out, share dividends |
| `setAutoPay` / `payFor` / `payAllAutoPay` | member / anyone | AutoPay |
| `withdraw` | anyone | pull everything credited to you |
| `scoreOf` / `statsOf` | view | Kameti Score |

### Testing

74 Foundry tests, all passing (`forge test`), including:

- exact payouts and dividends over full 4-member circles with bids every round
- every bid rejection rule, deadline rules, double settlement
- deposit slashing, debt, default and debt recovery
- AutoPay with members who lack balance or allowance
- score math, clamping and the join gate
- fuzz tests on parameters and bid amounts
- a handler-based **invariant** over 128,000 random calls (pay, bid, settle, AutoPay, withdraw, time travel): the USDC held by the contract always equals deposits + current pots + everything claimable

The contract has been reviewed by Arc Studio's built-in auditors. It has **not** had an independent audit; use small amounts.

## How it was built in Arc Studio

Every contract line, test and screen came out of Arc Studio, driven through its CLI from Claude Code:

1. Described the circle, the tests and the "Cybercore" design system; Studio wrote the contract, the Foundry tests and the React app, and deployed to Arc Testnet.
2. Studio's security and functional auditors found fund-lock and griefing issues (push payouts, unpaid recipients, index shifts); Studio fixed them by moving to pull payments and re-audited until clean.
3. Asked Studio for v2 as a real chit fund (bidding, deposits, AutoPay, Kameti Score) on the max preset; it rewrote the contract, added fuzz and invariant tests and fixed every audit finding.
4. Each bug found while testing in the browser (CSS build, scroll reveals, gauge layout, missing deadline check in `pay`) went back to Studio as a prompt and was fixed there.
5. Mainnet deploy from a Circle developer wallet through Studio.

## Run locally

```bash
bun install          # or npm install --legacy-peer-deps
bun run dev          # app
forge test           # contracts
```

`VITE_CONTRACT_ADDRESS` overrides the contract address. Network settings live in `src/lib/contract.ts` and `src/config.ts`.

## Roadmap

- Sealed-bid rounds, so bids can't be sniped in the last seconds
- Idle pot and deposits earning yield between rounds
- Kameti Score as an attestation other apps (lending, rentals) can read
- Group chat and reminders per circle; INR on/off-ramp to USDC
- Organiser (foreman) commission option for community-run circles

## License

MIT
