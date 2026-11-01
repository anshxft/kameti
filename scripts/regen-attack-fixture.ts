/**
 * Regenerate src/config/attackFixtures.json with a one-year validBefore.
 *
 * Signs w3's round-2 authorization for Attack Lab circle #7 using
 * SEED_KEY_3.  The signature is intentionally for round 2 while the
 * circle is in round 1, so payWithAuthorization rejects it with
 * "FiatTokenV2: invalid signature" (USDC nonce mismatch).
 *
 * Only changes validBefore — everything else (member, circle, round
 * numbers) stays identical to the original fixture.
 */
import {
  createPublicClient, http,
  type Hex, type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONTRACT  = '0x34f31472c5d16e0562668fbea1e700b19b2ea5a7' as Address
const USDC_ADDR = '0x3600000000000000000000000000000000000000' as Address
const CHAIN_ID  = 5042002
const RPC_URL   = 'https://rpc.testnet.arc.io'

const CIRCLE_ID    = 7n
const SIGNED_ROUND = 2   // deliberately wrong — circle is in round 1
const CONTRIBUTION = 100_000n   // 0.1 USDC (attack lab contribution)

const KAMETI_ABI = [
  { name: 'roundNonce', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'circleId', type: 'uint256' },
      { name: 'round',    type: 'uint8'   },
      { name: 'member',   type: 'address' },
    ],
    outputs: [{ name: 'nonce', type: 'bytes32' }] },
] as const

const arcChain = {
  id: CHAIN_ID, name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
}

async function main() {
  const key = process.env.SEED_KEY_3
  if (!key) throw new Error('SEED_KEY_3 not set in environment')

  const acct = privateKeyToAccount(key as Hex)
  console.log(`Signer (w3): ${acct.address}`)

  const pub = createPublicClient({ transport: http(RPC_URL), chain: arcChain })

  // One-year expiry from now
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 3600)
  console.log(`validBefore: ${validBefore}  (${new Date(Number(validBefore) * 1000).toISOString()})`)

  // Read the exact nonce the contract will use for round 2 of this member
  const nonce = await pub.readContract({
    address: CONTRACT, abi: KAMETI_ABI,
    functionName: 'roundNonce',
    args: [CIRCLE_ID, SIGNED_ROUND, acct.address],
  })
  console.log(`roundNonce(${CIRCLE_ID}, ${SIGNED_ROUND}, ${acct.address}): ${nonce}`)

  // Sign ReceiveWithAuthorization via EIP-712 (same as seed script)
  const sigHex = await acct.signTypedData({
    domain: {
      name: 'USDC', version: '2',
      chainId: CHAIN_ID,
      verifyingContract: USDC_ADDR,
    },
    types: {
      ReceiveWithAuthorization: [
        { name: 'from',        type: 'address' },
        { name: 'to',          type: 'address' },
        { name: 'value',       type: 'uint256' },
        { name: 'validAfter',  type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce',       type: 'bytes32' },
      ],
    },
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from:        acct.address,
      to:          CONTRACT,
      value:       CONTRIBUTION,
      validAfter:  0n,
      validBefore,
      nonce,
    },
  })

  const sigBytes = Buffer.from(sigHex.slice(2), 'hex')
  const v = sigBytes[64] < 27 ? sigBytes[64] + 27 : sigBytes[64]
  const r = ('0x' + sigBytes.subarray(0, 32).toString('hex')) as Hex
  const s = ('0x' + sigBytes.subarray(32, 64).toString('hex')) as Hex

  const fixture = {
    _comment: `Round-${SIGNED_ROUND} auth for w3 (${acct.address}) in Attack Lab circle #${CIRCLE_ID}. Submit while circle is in round 1 → USDC nonce mismatch (FiatTokenV2: invalid signature).`,
    wrongRoundFixture: {
      from:          acct.address,
      circleId:      CIRCLE_ID.toString(),
      targetRound:   1,
      signedForRound: SIGNED_ROUND,
      validBefore:   validBefore.toString(),
      v,
      r,
      s,
    },
  }

  const outPath = resolve(new URL('../src/config/attackFixtures.json', import.meta.url).pathname)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2))
  console.log(`\n✓  Wrote ${outPath}`)
  console.log(`   validBefore = ${validBefore} (expires ${new Date(Number(validBefore) * 1000).toUTCString()})`)
}

main().catch(e => { console.error(e); process.exit(1) })
