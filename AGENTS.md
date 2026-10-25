# Kameti — Agent Notes

## Deployed Contracts

| Version | Contract | Network | Address | Explorer |
|---|---|---|---|---|
| v2.1 (current) | Kameti | Arc Testnet | 0x8a6ed216d5c38f0a35f97c327d79e4d456c9db6c | https://explorer.testnet.arc.io/address/0x8a6ed216d5c38f0a35f97c327d79e4d456c9db6c |
| v2.0 | Kameti | Arc Testnet | 0x04a5fe864ce00d12ba314b3c11afaeecbb4856cc | https://explorer.testnet.arc.io/address/0x04a5fe864ce00d12ba314b3c11afaeecbb4856cc |
| v1 | Kameti | Arc Testnet | 0xbd97fb27b878cef84fe4981e58ba5ca0607623d2 | https://explorer.testnet.arc.io/address/0xbd97fb27b878cef84fe4981e58ba5ca0607623d2 |

## USDC on Arc Testnet
Address: 0x3600000000000000000000000000000000000000 (6 decimals)

## Kameti v2.1 — Security review status
- 74/74 Foundry tests pass (max preset + extended invariant)
- Two invariants: 7-action handler (placeBid, payAllAutoPay mixed-allowance, setAutoPay) — 128,000 calls, 0 failures
- Max-severity review: all findings addressed (see v2 notes below)
- Fix in v2.1: _pay now checks block.timestamp >= roundEnd and reverts RoundEnded; payAllAutoPay silently skips when round ended

## Kameti v2 — Security review status (carried forward)
- Solidity auditor: no findings at max severity
- Functional auditor: no findings at max severity
- All previous criticals/highs fixed (see v2 notes)

## To switch to mainnet
Change VITE_CHAIN_ID and VITE_CONTRACT_ADDRESS and VITE_USDC_ADDRESS in .env, set RPC to Arc mainnet.
