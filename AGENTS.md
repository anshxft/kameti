# Kameti — Agent Notes

## Deployed Contracts

| Version | Contract | Network | Address | Explorer |
|---|---|---|---|---|
| v3.1 (current) | Kameti | Arc Testnet | 0x34f31472c5d16e0562668fbea1e700b19b2ea5a7 | https://explorer.testnet.arc.io/address/0x34f31472c5d16e0562668fbea1e700b19b2ea5a7 |
| v3 | Kameti | Arc Testnet | 0x41fb2089109136463bd5530e294b5be4620f15e5 | https://explorer.testnet.arc.io/address/0x41fb2089109136463bd5530e294b5be4620f15e5 |
| v2.1 | Kameti | Arc Testnet | 0x8a6ed216d5c38f0a35f97c327d79e4d456c9db6c | https://explorer.testnet.arc.io/address/0x8a6ed216d5c38f0a35f97c327d79e4d456c9db6c |
| v2.0 | Kameti | Arc Testnet | 0x04a5fe864ce00d12ba314b3c11afaeecbb4856cc | https://explorer.testnet.arc.io/address/0x04a5fe864ce00d12ba314b3c11afaeecbb4856cc |
| v1 | Kameti | Arc Testnet | 0xbd97fb27b878cef84fe4981e58ba5ca0607623d2 | https://explorer.testnet.arc.io/address/0xbd97fb27b878cef84fe4981e58ba5ca0607623d2 |

## USDC on Arc Testnet
Address: 0x3600000000000000000000000000000000000000 (6 decimals)

## Kameti v3.1 — Security review status
- 137/137 Foundry tests pass (max preset, 2 audit rounds)
  - 41 new v3.1 tests (gas-griefing, post-win lock, keeper tip, PQ guard x22, IKametiScore)
  - 2 invariants: 256 runs × 500 depth = 128,000 calls each; 0 failures (Invariant2 now includes _totalLocks)
  - Max audit rounds 1-2: 2 findings found and fixed
    - [High] hardcoded-pq-precompile-unverifiable: PQ_PRECOMPILE now immutable, set in constructor with Arc default
    - [Low] constructor comment/code mismatch: comment updated to match implementation
  - Slither: all flagged items are false positives (nonReentrant guards, intentional div order, fee-on-transfer check)
- Live Arc Testnet checks (2026-10-27):
  - SLH-DSA: valid sig → precompile returns true; tampered sig → false. PASSED.
  - Gas stipend: receiveWithAuthorization = 88,067 gas. Stipend 115,000 has 23.4% headroom. No changes needed.
- @noble/post-quantum@0.7.1 installed (with @noble/hashes@2.4.0 and @noble/curves@1.8.1)
- scripts/smoke-pq.ts — SLH-DSA precompile smoke test
- scripts/smoke-gas.ts — AutoPay gas stipend live check

## Kameti v3 — Security review status
- 96/96 Foundry tests pass (max preset, 3 audit rounds, EIP-3009 full suite)
- Two invariants (256 runs × 500 depth = 128,000 calls each), 0 failures: v1 approve-based handler + v3 EIP-3009 handler (storeAuth, executeAutoPay, cancelAuth, payWithAuth, soft-close bids)
- Max audit rounds 1-3: 4 findings found and fixed
  - [High] Discount underflow when members default: clamped discount to realized pot
  - [Medium] Stale _auth on payWithAuthorization: deleted after successful payment
  - [High] Late AutoPay deadline bypass: storeAuthorizations now reverts RoundEnded for current-round post-deadline
  - [Medium] createCircleWithAuthorization nonce front-run: per-user createNonce counter
- Slither: 10 flagged items — all false positives (nonReentrant guards, intentional fee-on-transfer check, intentional integer division for dust)
- MockERC20/MockRevertingERC20: permissionless mint is intentional (test-only); NOT for production deployment

## Kameti v2.1 — Security review status (superseded by v3)
- 74/74 Foundry tests pass (max preset + extended invariant)
- Two invariants: 7-action handler (placeBid, payAllAutoPay mixed-allowance, setAutoPay) — 128,000 calls, 0 failures
- Max-severity review: all findings addressed (see v2 notes below)
- Fix in v2.1: _pay now checks block.timestamp >= roundEnd and reverts RoundEnded; payAllAutoPay silently skips when round ended

## Kameti v2 — Security review status (carried forward)
- Solidity auditor: no findings at max severity
- Functional auditor: no findings at max severity
- All previous criticals/highs fixed (see v2 notes)

## Seeded circles (Arc Testnet, v3.1 contract 0x34f31472c5d16e0562668fbea1e700b19b2ea5a7)

| Role | Circle ID | Members | Contribution | Notes |
|---|---|---|---|---|
| Demo Kameti | 2 | 4 (w0–w3) | 0.5 USDC | 30-min rounds, keeperTip=10, postWinLock=5000. Full v3.1 demo: autopay, bidding, PQ guard, round 2 seeded. |
| Attack Lab | 7 | 3 (w1–w3) | 0.1 USDC | 30-day rounds, no lock/tip. Round 1 in progress: w1+w2 paid, w3 has stored auth but hasn't paid. Fixture in src/config/attackFixtures.json. |

### Seed wallet addresses
- Wallet 0 (w0, SEED_KEY_0): 0xA29Ed91f4c473cF73B85c72D2E18164770b83C1E
- Wallet 1 (w1, SEED_KEY_1): 0x7B96e3068Ff1e582413A09c2342e8611ff82c828
- Wallet 2 (w2, SEED_KEY_2): 0xaFdb1d87a1A766E63d22aa5C0FAC8481aaBda3aF (PQ guard enabled in demo circle)
- Wallet 3 (w3, SEED_KEY_3): 0xfA0773372042f56992483080Fa4d7571c5B41400

### Circle event topic
CircleCreated event topic: 0x6b2b204c21110ae9f9b868c47c705e8c2c48109ca830f1c704a1b7d86adbe22d
(Full event sig: CircleCreated(uint256,string,uint256,uint8,address) — not CircleCreated(uint256,string))

## To switch to mainnet
Change VITE_CHAIN_ID and VITE_CONTRACT_ADDRESS and VITE_USDC_ADDRESS in .env, set RPC to Arc mainnet.
