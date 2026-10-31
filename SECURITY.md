# Security

Kameti holds other people's savings, so this file states plainly what the contract protects against, how, and what it does not cover.

## Trust model

- **No admin.** The contract has no owner, no pause, no upgrade path and no fee recipient. Nobody, including the deployer, can move a member's funds, change a circle's rules or stop withdrawals.
- **Pull payments.** Payouts, dividends, refunds, keeper tips and unlocked deposits are credited to `claimable` and withdrawn by each member. A blocked or reverting address cannot freeze anyone else.
- **Permissionless progress.** Anyone can run `executeAutoPay` and `settleRound`. A circle never depends on one server, bot or person being online.

## Threats and what stops them

| Threat | Protection |
|---|---|
| Organiser runs with the pot | There is no organiser account with access to funds; the pot only leaves through `settleRound` to the round's winner. |
| Early winner stops paying | Post-win lock: part of the winner's payout stays locked and is released as they keep paying; a missed payment is covered from the lock first, then the security deposit. |
| Member misses a round | Security deposit covers it at settlement; the member gets a strike, and once the deposit runs out the shortfall becomes debt taken from their later payout. |
| Member forgets to pay | Pre-signed AutoPay: EIP-3009 `ReceiveWithAuthorization` signatures stored on-chain and executed by anyone, including during settlement. |
| Authorization reused in another round or circle | Each nonce is `keccak256(contract, chainId, circleId, round, member)`; the contract recomputes it, so a signature only works for its own round. |
| Front-running a signed payment | `receiveWithAuthorization` only accepts a call from the payee (the Kameti contract). Members must sign `ReceiveWithAuthorization`, never `TransferWithAuthorization`; the app enforces this. |
| Starving AutoPay of gas so a member gets slashed | Each AutoPay call requires a minimum gas reserve, and a call that failed because it was starved reverts the whole transaction instead of recording a failure. |
| Last-second auction sniping | Soft close: a bid in the final window extends the round, up to a cap. |
| Stolen wallet key | Optional post-quantum guard: above a daily limit, withdrawals also need an SLH-DSA-SHA2-128s signature verified by Arc's precompile `0x1800…0004`, and the signature fixes the destination address. A lost PQ key can be removed after a 7-day timelock that the PQ key can cancel. |
| Reentrancy | `nonReentrant` on every state-changing external function; checks-effects-interactions. |

## Testing

- Foundry unit, fuzz and handler-based invariant tests. The invariant runs 256 × 500 random calls across payments, bids, AutoPay, cancellations, settlement, locks, keeper tips and withdrawals, and asserts that the USDC held by the contract always equals deposits + post-win locks + current pots + claimable balances.
- EIP-3009 is tested against a mock that mirrors FiatToken v2 (EIP-712 name "USDC", version "2", payee-only `receiveWithAuthorization`), with real `vm.sign` signatures.
- The PQ precompile is not available in Foundry; tests etch a mock that accepts only exact (key, message, signature) triples and also returns false, reverts, returns nothing and returns non-booleans, all of which must be rejected. A live check on Arc testnet verifies a real SLH-DSA signature through the precompile.
- Arc Studio's solidity and functional auditors reviewed each version at the max preset; findings and fixes are listed in the release notes.

## Known limits

- **No independent audit.** Use small amounts.
- **Open bids.** Bids are public; sealed bids are on the roadmap.
- **Post-quantum precompile is experimental** on Arc, and PQ signatures are used only as a second factor next to the wallet key, as Arc recommends.
- **Score is per wallet.** A defaulter can start over with a new wallet at the default score of 600; circles that need more trust should set a minimum score.
- **USDC blocklist.** If Circle blocklists a member, their own transfers fail; pull payments keep everyone else unaffected.

## Reporting

Open a private security advisory on GitHub (`Security` → `Report a vulnerability`) on https://github.com/anshxft/kameti. Please do not open a public issue for vulnerabilities.
