/**
 * Kameti v3.1 Demo + Attack Lab seeder.
 *
 * Requires SEED_KEY_0..3 in .env.
 * Wallet 0 (0xA29Ed91f4c473cF73B85c72D2E18164770b83C1E) must hold ≥20 USDC.
 *
 * What it does:
 * A) Demo circle: 4 members, 0.5 USDC, 30-min rounds, postWinLock=5000, keeperTip=10.
 *    - All join via joinWithAuthorization (EIP-3009).
 *    - All 4 storeAuthorizations for every remaining round.
 *    - Round 1: executeAutoPay (4/4), two bids, wait for deadline, settleRound.
 *    - Round-1 winner (wallet 2) enables PQ guard with a real SLH-DSA key.
 *    - Round 2: wallet 1 pays via payWithAuthorization; wallets 2+3 left unpaid (one unexecuted auth).
 *
 * B) Attack Lab: 3 members, 0.1 USDC, 30-DAY rounds, deposit 1x, no lock/tip.
 *    - Keeps round 1 open indefinitely so /break attacks stay valid.
 *    - Two members pay via executeAutoPay; one member's stored auth left unexecuted.
 *    - Writes attackFixtures.json with a real member's round-2 auth for the wrong-round attack.
 *
 * Outputs: prints circle IDs and tx hashes, writes src/config/attackFixtures.json.
 *
 * FIX vs previous version:
 *   - Import '@noble/post-quantum/slh-dsa.js' (needs .js extension in Node/Bun ESM)
 *   - Use getTransactionReceipt(hash) instead of reading .blockNumber off the hash directly
 *   - Removed bad 'unsafe-assignment' TypeScript usage
 */
import {
  createWalletClient, createPublicClient, http,
  encodeAbiParameters, parseAbiParameters, keccak256,
  toHex, type Hex, type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── @noble/post-quantum uses .js exports map — must use the .js path in ESM
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js'

// ── Contract / chain constants ───────────────────────────────────────────────
const CONTRACT   = '0x34f31472c5d16e0562668fbea1e700b19b2ea5a7' as Address
const USDC_ADDR  = '0x3600000000000000000000000000000000000000' as Address
const CHAIN_ID   = 5042002
const RPC_URL    = 'https://rpc.testnet.arc.io'

// EIP-712 domain for Arc Testnet USDC (name="USDC", version="2")
const DOMAIN_SEP = '0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0' as Hex

const RECEIVE_TYPEHASH = keccak256(
  new TextEncoder().encode(
    'ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'
  )
)

// ── Minimal ABIs ─────────────────────────────────────────────────────────────
const USDC_ABI = [
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'transfer',  type: 'function', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'receiveWithAuthorization', type: 'function', inputs: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
  ], outputs: [], stateMutability: 'nonpayable' },
  { name: 'cancelAuthorization', type: 'function', inputs: [
    { name: 'authorizer', type: 'address' }, { name: 'nonce', type: 'bytes32' },
    { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
  ], outputs: [], stateMutability: 'nonpayable' },
] as const

const KAMETI_ABI = [
  { name: 'createCircleWithAuthorization', type: 'function', inputs: [
    { name: 'name', type: 'string' }, { name: 'contribution', type: 'uint256' },
    { name: 'maxMembers', type: 'uint8' }, { name: 'roundDuration', type: 'uint256' },
    { name: 'depositMultiplier', type: 'uint8' }, { name: 'maxDiscountBps', type: 'uint16' },
    { name: 'minScore', type: 'uint16' }, { name: 'postWinLockBps', type: 'uint16' },
    { name: 'keeperTipBps', type: 'uint8' },
    { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
  ], outputs: [{ name: 'id', type: 'uint256' }], stateMutability: 'nonpayable' },
  { name: 'joinWithAuthorization', type: 'function', inputs: [
    { name: 'circleId', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
  ], outputs: [], stateMutability: 'nonpayable' },
  { name: 'storeAuthorizations', type: 'function', inputs: [
    { name: 'circleId', type: 'uint256' }, { name: 'rounds', type: 'uint8[]' },
    { name: 'validBefores', type: 'uint256[]' }, { name: 'vs', type: 'uint8[]' },
    { name: 'rs', type: 'bytes32[]' }, { name: 'ss', type: 'bytes32[]' },
  ], outputs: [], stateMutability: 'nonpayable' },
  { name: 'executeAutoPay', type: 'function', inputs: [{ name: 'circleId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'payWithAuthorization', type: 'function', inputs: [
    { name: 'circleId', type: 'uint256' }, { name: 'from', type: 'address' },
    { name: 'validBefore', type: 'uint256' }, { name: 'v', type: 'uint8' },
    { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
  ], outputs: [], stateMutability: 'nonpayable' },
  { name: 'placeBid', type: 'function', inputs: [
    { name: 'circleId', type: 'uint256' }, { name: 'discountBps', type: 'uint16' },
  ], outputs: [], stateMutability: 'nonpayable' },
  { name: 'settleRound', type: 'function', inputs: [{ name: 'circleId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'enablePqGuard', type: 'function', inputs: [
    { name: 'vk', type: 'bytes32' }, { name: 'dailyFreeLimit', type: 'uint256' },
  ], outputs: [], stateMutability: 'nonpayable' },
  { name: 'createDepositNonce', type: 'function', inputs: [{ name: 'creator', type: 'address' }], outputs: [{ name: 'nonce', type: 'bytes32' }], stateMutability: 'view' },
  { name: 'depositNonce', type: 'function', inputs: [{ name: 'circleId', type: 'uint256' }, { name: 'member', type: 'address' }], outputs: [{ name: 'nonce', type: 'bytes32' }], stateMutability: 'view' },
  { name: 'roundNonce', type: 'function', inputs: [{ name: 'circleId', type: 'uint256' }, { name: 'round', type: 'uint8' }, { name: 'member', type: 'address' }], outputs: [{ name: 'nonce', type: 'bytes32' }], stateMutability: 'view' },
  { name: 'getCircle', type: 'function', inputs: [{ name: 'circleId', type: 'uint256' }], outputs: [
    { name: 'params', type: 'tuple', components: [
      { name: 'contribution', type: 'uint256' }, { name: 'maxMembers', type: 'uint8' },
      { name: 'roundDuration', type: 'uint256' }, { name: 'depositMultiplier', type: 'uint8' },
      { name: 'maxDiscountBps', type: 'uint16' }, { name: 'minScore', type: 'uint16' },
      { name: 'postWinLockBps', type: 'uint16' }, { name: 'keeperTipBps', type: 'uint8' },
    ]},
    { name: 'status', type: 'uint8' },
    { name: 'currentRound', type: 'uint8' },
    { name: 'roundEnd', type: 'uint256' },
    { name: 'memberCount', type: 'uint8' },
  ], stateMutability: 'view' },
  { name: 'totalCircles', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'event', name: 'CircleCreated',
    inputs: [{ name: 'id', type: 'uint256', indexed: true }, { name: 'name', type: 'string', indexed: false }],
  },
] as const

// ── Helpers ──────────────────────────────────────────────────────────────────
const transport = http(RPC_URL)
const publicClient = createPublicClient({ transport, chain: { id: CHAIN_ID, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } } })

function wallet(key: string) {
  const acct = privateKeyToAccount(key as Hex)
  return { acct, client: createWalletClient({ account: acct, transport, chain: { id: CHAIN_ID, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } } }) }
}

async function waitTx(hash: Hex, label: string): Promise<{ blockNumber: bigint; logs: unknown[] }> {
  console.log(`  ⏳ ${label}: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status === 'reverted') throw new Error(`TX reverted: ${label} (${hash})`)
  console.log(`  ✓  ${label}: block ${receipt.blockNumber}`)
  return receipt
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

/** Sign a ReceiveWithAuthorization EIP-712 message. */
async function signReceiveAuth(
  signer: ReturnType<typeof wallet>['acct'],
  from: Address,
  to: Address,
  value: bigint,
  validBefore: bigint,
  nonce: Hex,
): Promise<{ v: number; r: Hex; s: Hex }> {
  const structHash = keccak256(encodeAbiParameters(
    parseAbiParameters('bytes32,address,address,uint256,uint256,uint256,bytes32'),
    [RECEIVE_TYPEHASH, from, to, value, 0n, validBefore, nonce]
  ))
  const prefix = new Uint8Array([0x19, 0x01])
  const domainBytes = Buffer.from(DOMAIN_SEP.slice(2), 'hex')
  const structBytes = Buffer.from(structHash.slice(2), 'hex')
  const digest = keccak256(Buffer.concat([prefix, domainBytes, structBytes]) as unknown as Uint8Array)
  const sigHex = await signer.sign({ hash: digest })
  const sigBytes = Buffer.from(sigHex.slice(2), 'hex')
  return {
    r: `0x${sigBytes.subarray(0, 32).toString('hex')}`,
    s: `0x${sigBytes.subarray(32, 64).toString('hex')}`,
    v: sigBytes[64] < 27 ? sigBytes[64] + 27 : sigBytes[64],
  }
}

async function signRoundAuth(
  signer: ReturnType<typeof wallet>['acct'],
  circleId: bigint,
  round: number,
  contribution: bigint,
  validBefore: bigint,
): Promise<{ v: number; r: Hex; s: Hex; nonce: Hex }> {
  const nonce = keccak256(encodeAbiParameters(
    parseAbiParameters('address,uint256,uint256,uint8,address'),
    [CONTRACT, BigInt(CHAIN_ID), circleId, round, signer.address]
  ))
  const sig = await signReceiveAuth(signer, signer.address, CONTRACT, contribution, validBefore, nonce)
  return { ...sig, nonce }
}

async function signCreateAuth(
  signer: ReturnType<typeof wallet>['acct'],
  contribution: bigint,
  validBefore: bigint,
): Promise<{ v: number; r: Hex; s: Hex; nonce: Hex }> {
  const nonce = await publicClient.readContract({
    address: CONTRACT, abi: KAMETI_ABI, functionName: 'createDepositNonce', args: [signer.address],
  })
  const sig = await signReceiveAuth(signer, signer.address, CONTRACT, contribution, validBefore, nonce)
  return { ...sig, nonce }
}

async function signJoinAuth(
  signer: ReturnType<typeof wallet>['acct'],
  circleId: bigint,
  contribution: bigint,
  validBefore: bigint,
): Promise<{ v: number; r: Hex; s: Hex; nonce: Hex }> {
  const nonce = await publicClient.readContract({
    address: CONTRACT, abi: KAMETI_ABI, functionName: 'depositNonce', args: [circleId, signer.address],
  })
  const sig = await signReceiveAuth(signer, signer.address, CONTRACT, contribution, validBefore, nonce)
  return { ...sig, nonce }
}

function loadKeys() {
  const keys = [
    process.env.SEED_KEY_0,
    process.env.SEED_KEY_1,
    process.env.SEED_KEY_2,
    process.env.SEED_KEY_3,
  ]
  for (let i = 0; i < keys.length; i++) {
    if (!keys[i]) throw new Error(`SEED_KEY_${i} not set in .env`)
  }
  return keys.map((k, i) => {
    const w = wallet(k!)
    console.log(`  Wallet ${i}: ${w.acct.address}`)
    return w
  })
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Kameti v3.1 Seed Demo ===\n')
  const [w0, w1, w2, w3] = loadKeys()

  // Check balances
  const bal0 = await publicClient.readContract({ address: USDC_ADDR, abi: USDC_ABI, functionName: 'balanceOf', args: [w0.acct.address] })
  console.log(`\nWallet 0 USDC: ${Number(bal0)/1e6} USDC`)

  const CONTRIBUTION_DEMO   = 500_000n        // 0.5 USDC
  const DEPOSIT_DEMO        = 1_000_000n       // 2x = 1.0 USDC deposit
  const CONTRIBUTION_LAB    = 100_000n         // 0.1 USDC
  const DEPOSIT_LAB         = 100_000n         // 1x deposit
  const ROUND_DURATION_DEMO = 30 * 60          // 30 minutes
  const ROUND_DURATION_LAB  = 30 * 24 * 3600   // 30 days
  const VALID_BEFORE        = BigInt(Math.floor(Date.now() / 1000) + 7200)

  // Fund wallets 1–3 from wallet 0 if needed
  const MIN_FUND = 5_000_000n  // 5 USDC per wallet to cover contributions + deposits
  for (const w of [w1, w2, w3]) {
    const bal = await publicClient.readContract({ address: USDC_ADDR, abi: USDC_ABI, functionName: 'balanceOf', args: [w.acct.address] })
    if (bal < MIN_FUND) {
      const top = MIN_FUND - bal
      console.log(`\nFunding wallet ${w.acct.address.slice(0,10)}… with ${Number(top)/1e6} USDC`)
      const hash = await w0.client.writeContract({ address: USDC_ADDR, abi: USDC_ABI, functionName: 'transfer', args: [w.acct.address, top] })
      await waitTx(hash, 'fund wallet')
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // A. DEMO CIRCLE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n── DEMO CIRCLE ──')

  // Create
  const createAuth = await signCreateAuth(w0.acct, CONTRIBUTION_DEMO, VALID_BEFORE)
  const createHash = await w0.client.writeContract({
    address: CONTRACT, abi: KAMETI_ABI, functionName: 'createCircleWithAuthorization',
    args: [
      'Demo Kameti', CONTRIBUTION_DEMO, 4, BigInt(ROUND_DURATION_DEMO),
      2, 3000, 0, 5000, 10,
      VALID_BEFORE, createAuth.nonce, createAuth.v, createAuth.r, createAuth.s,
    ],
  })
  const createReceipt = await waitTx(createHash, 'createCircleWithAuthorization')
  // Read circle ID from logs
  const circleLogs = await publicClient.getLogs({
    address: CONTRACT,
    event: { type: 'event', name: 'CircleCreated', inputs: [{ name: 'id', type: 'uint256', indexed: true }, { name: 'name', type: 'string', indexed: false }] } as const,
    fromBlock: createReceipt.blockNumber,
    toBlock: createReceipt.blockNumber,
  })
  const demoId = circleLogs[0]?.args.id ?? 0n
  console.log(`\n  Demo circle ID: ${demoId}`)

  // Members 1–3 join
  for (const [i, w] of [[1, w1], [2, w2], [3, w3]] as const) {
    const auth = await signJoinAuth(w.acct, demoId, DEPOSIT_DEMO, VALID_BEFORE)
    const hash = await w.client.writeContract({
      address: CONTRACT, abi: KAMETI_ABI, functionName: 'joinWithAuthorization',
      args: [demoId, VALID_BEFORE, auth.nonce, auth.v, auth.r, auth.s],
    })
    await waitTx(hash, `joinWithAuthorization (wallet ${i})`)
  }

  // All 4 store authorizations for rounds 1..4
  const TOTAL_ROUNDS = 4
  for (const [i, w] of [[0, w0], [1, w1], [2, w2], [3, w3]] as const) {
    const rounds: number[] = []
    const validBefores: bigint[] = []
    const vs: number[] = []
    const rs: Hex[] = []
    const ss: Hex[] = []
    for (let r = 1; r <= TOTAL_ROUNDS; r++) {
      const auth = await signRoundAuth(w.acct, demoId, r, CONTRIBUTION_DEMO, VALID_BEFORE)
      rounds.push(r)
      validBefores.push(VALID_BEFORE)
      vs.push(auth.v)
      rs.push(auth.r)
      ss.push(auth.s)
    }
    const hash = await w.client.writeContract({
      address: CONTRACT, abi: KAMETI_ABI, functionName: 'storeAuthorizations',
      args: [demoId, rounds, validBefores, vs, rs, ss],
    })
    await waitTx(hash, `storeAuthorizations (wallet ${i})`)
  }

  // Round 1: executeAutoPay
  console.log('\n  Round 1: executeAutoPay')
  const autoPayHash = await w0.client.writeContract({
    address: CONTRACT, abi: KAMETI_ABI, functionName: 'executeAutoPay', args: [demoId],
  })
  await waitTx(autoPayHash, 'executeAutoPay')

  // Two bids
  const bid1Hash = await w1.client.writeContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'placeBid', args: [demoId, 1000] })
  await waitTx(bid1Hash, 'placeBid w1 10%')
  const bid2Hash = await w2.client.writeContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'placeBid', args: [demoId, 2000] })
  await waitTx(bid2Hash, 'placeBid w2 20%')

  // Wait for round deadline
  const circleInfo = await publicClient.readContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'getCircle', args: [demoId] }) as unknown as { roundEnd: bigint }
  const now = Math.floor(Date.now() / 1000)
  const waitSecs = Number(circleInfo.roundEnd) - now + 5
  if (waitSecs > 0) {
    console.log(`\n  Waiting ${waitSecs}s for round deadline…`)
    await sleep(waitSecs * 1000)
  }

  // Settle round 1 (w0 acts as keeper)
  const settleHash = await w0.client.writeContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'settleRound', args: [demoId] })
  await waitTx(settleHash, 'settleRound (keeper)')

  // Enable PQ guard for w2 (round-1 winner based on highest bid 2000bps)
  const pqSeed = new Uint8Array(64)
  crypto.getRandomValues(pqSeed)
  const { publicKey: pqPub } = slh_dsa_sha2_128s.keygen(pqSeed)
  const pqVk = toHex(pqPub)  // 32-byte public key → bytes32
  const pqHash = await w2.client.writeContract({
    address: CONTRACT, abi: KAMETI_ABI, functionName: 'enablePqGuard',
    args: [pqVk, 100_000n],  // dailyFreeLimit = 0.1 USDC
  })
  await waitTx(pqHash, 'enablePqGuard (wallet 2)')
  console.log(`  PQ key for w2: ${pqVk.slice(0,18)}…`)

  // Round 2: w0 pays via payWithAuthorization; w1,w2,w3 NOT paid (one unexecuted auth left)
  console.log('\n  Round 2: w0 pays, others not paid (unexecuted stored auth)')
  const circleAfterSettle = await publicClient.readContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'getCircle', args: [demoId] }) as unknown as { params: { contribution: bigint }; currentRound: number }
  const round2Nonce = await publicClient.readContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'roundNonce', args: [demoId, circleAfterSettle.currentRound, w0.acct.address] })
  const r2Auth = await signReceiveAuth(w0.acct, w0.acct.address, CONTRACT, CONTRIBUTION_DEMO, VALID_BEFORE, round2Nonce)
  const payR2Hash = await w0.client.writeContract({
    address: CONTRACT, abi: KAMETI_ABI, functionName: 'payWithAuthorization',
    args: [demoId, w0.acct.address, VALID_BEFORE, r2Auth.v, r2Auth.r, r2Auth.s],
  })
  await waitTx(payR2Hash, 'payWithAuthorization w0 round 2')

  console.log(`\n  ✓ Demo circle #${demoId} ready.`)

  // ─────────────────────────────────────────────────────────────────────────────
  // B. ATTACK LAB CIRCLE (30-day rounds, stays open forever)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n── ATTACK LAB CIRCLE ──')

  const labCreateAuth = await signCreateAuth(w0.acct, CONTRIBUTION_LAB, VALID_BEFORE)
  const labCreateHash = await w0.client.writeContract({
    address: CONTRACT, abi: KAMETI_ABI, functionName: 'createCircleWithAuthorization',
    args: [
      'Attack Lab', CONTRIBUTION_LAB, 3, BigInt(ROUND_DURATION_LAB),
      1, 3000, 0, 0, 0,  // no post-win lock, no keeper tip
      VALID_BEFORE, labCreateAuth.nonce, labCreateAuth.v, labCreateAuth.r, labCreateAuth.s,
    ],
  })
  const labCreateReceipt = await waitTx(labCreateHash, 'createCircleWithAuthorization (lab)')
  const labLogs = await publicClient.getLogs({
    address: CONTRACT,
    event: { type: 'event', name: 'CircleCreated', inputs: [{ name: 'id', type: 'uint256', indexed: true }, { name: 'name', type: 'string', indexed: false }] } as const,
    fromBlock: labCreateReceipt.blockNumber,
    toBlock: labCreateReceipt.blockNumber,
  })
  const labId = labLogs[0]?.args.id ?? 0n
  console.log(`  Attack Lab circle ID: ${labId}`)

  // Members 1–2 join
  for (const [i, w] of [[1, w1], [2, w2]] as const) {
    const auth = await signJoinAuth(w.acct, labId, DEPOSIT_LAB, VALID_BEFORE)
    const hash = await w.client.writeContract({
      address: CONTRACT, abi: KAMETI_ABI, functionName: 'joinWithAuthorization',
      args: [labId, VALID_BEFORE, auth.nonce, auth.v, auth.r, auth.s],
    })
    await waitTx(hash, `joinWithAuthorization (wallet ${i})`)
  }

  // All 3 store authorizations for rounds 1..3
  for (const [i, w] of [[0, w0], [1, w1], [2, w2]] as const) {
    const rounds: number[] = []
    const validBefores: bigint[] = []
    const vs: number[] = []
    const rs: Hex[] = []
    const ss: Hex[] = []
    for (let r = 1; r <= 3; r++) {
      const auth = await signRoundAuth(w.acct, labId, r, CONTRIBUTION_LAB, VALID_BEFORE)
      rounds.push(r)
      validBefores.push(VALID_BEFORE)
      vs.push(auth.v)
      rs.push(auth.r)
      ss.push(auth.s)
    }
    const hash = await w.client.writeContract({
      address: CONTRACT, abi: KAMETI_ABI, functionName: 'storeAuthorizations',
      args: [labId, rounds, validBefores, vs, rs, ss],
    })
    await waitTx(hash, `storeAuthorizations (wallet ${i})`)
  }

  // Execute autopay for w0 and w1 only — leave w2's stored auth UNEXECUTED
  // (w2 pays the wrong attack in attack 4: has stored auth but not yet paid)
  // Actually: executeAutoPay will try all stored auths. We need a partial state.
  // Instead: manually pay w0 and w1 via payWithAuthorization; w2 stores auth but is not paid.
  for (const [i, w] of [[0, w0], [1, w1]] as const) {
    const nonce = await publicClient.readContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'roundNonce', args: [labId, 1, w.acct.address] })
    const auth = await signReceiveAuth(w.acct, w.acct.address, CONTRACT, CONTRIBUTION_LAB, VALID_BEFORE, nonce)
    const hash = await w.client.writeContract({
      address: CONTRACT, abi: KAMETI_ABI, functionName: 'payWithAuthorization',
      args: [labId, w.acct.address, VALID_BEFORE, auth.v, auth.r, auth.s],
    })
    await waitTx(hash, `payWithAuthorization w${i} (lab round 1)`)
  }
  console.log(`  w2 has stored auth for round 1 but has NOT paid — attack 4 (gas starvation) target.`)

  // ─── Write wrong-round fixture ────────────────────────────────────────────
  // w2 has a stored round-1 auth AND a round-2 auth. Save the round-2 auth as the
  // "wrong round" fixture: submitting it while the circle is still in round 1 causes
  // the USDC contract to reject it (nonce mismatch).
  const fixtureRound2Auth = await signRoundAuth(w2.acct, labId, 2, CONTRIBUTION_LAB, VALID_BEFORE)
  const fixtureData = {
    _comment: `Round-2 auth for ${w2.acct.address} in Attack Lab circle #${labId}. Submit it while the circle is in round 1 to trigger the USDC nonce rejection.`,
    wrongRoundFixture: {
      from: w2.acct.address,
      circleId: labId.toString(),
      targetRound: 1,
      signedForRound: 2,
      validBefore: VALID_BEFORE.toString(),
      v: fixtureRound2Auth.v,
      r: fixtureRound2Auth.r,
      s: fixtureRound2Auth.s,
    },
  }
  const fixturePath = resolve(new URL('../src/config/attackFixtures.json', import.meta.url).pathname)
  writeFileSync(fixturePath, JSON.stringify(fixtureData, null, 2))
  console.log(`\n  ✓ Wrote attackFixtures.json`)

  // ─────────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`
=== DONE ===

Demo circle:       ${demoId}  (VITE_DEMO_CIRCLE_ID=${demoId})
Attack Lab circle: ${labId}   (VITE_ATTACK_LAB_ID=${labId})

Add these to your .env:
  VITE_DEMO_CIRCLE_ID=${demoId}
  VITE_ATTACK_LAB_ID=${labId}

Key transactions:
  createCircleWithAuthorization (demo): ${createHash}
  executeAutoPay (demo round 1):        ${autoPayHash}
  settleRound (demo round 1):           ${settleHash}
  enablePqGuard (w2):                   ${pqHash}
  payWithAuthorization (demo round 2):  ${payR2Hash}
  createCircleWithAuthorization (lab):  ${labCreateHash}
`)
}

main().catch(e => { console.error(e); process.exit(1) })
