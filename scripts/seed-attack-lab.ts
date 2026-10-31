/**
 * Seed the Attack Lab circle only (3 members, 0.1 USDC, 30-day rounds).
 * Uses wallets 1–3 (wallet 0 out of USDC after the demo circle seed).
 * Wallet 1 acts as creator.
 *
 * Outputs:
 *   - Prints VITE_ATTACK_LAB_ID
 *   - Writes src/config/attackFixtures.json with the wrong-round fixture
 *   - Prints all tx hashes
 */
import {
  createWalletClient, createPublicClient, http,
  type Hex, type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONTRACT   = '0x34f31472c5d16e0562668fbea1e700b19b2ea5a7' as Address
const USDC_ADDR  = '0x3600000000000000000000000000000000000000' as Address
const CHAIN_ID   = 5042002
const RPC_URL    = 'https://rpc.testnet.arc.io'



const USDC_ABI = [
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
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
  { name: 'payWithAuthorization', type: 'function', inputs: [
    { name: 'circleId', type: 'uint256' }, { name: 'from', type: 'address' },
    { name: 'validBefore', type: 'uint256' }, { name: 'v', type: 'uint8' },
    { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
  ], outputs: [], stateMutability: 'nonpayable' },
  { name: 'createDepositNonce', type: 'function', inputs: [{ name: 'creator', type: 'address' }], outputs: [{ name: 'nonce', type: 'bytes32' }], stateMutability: 'view' },
  { name: 'depositNonce', type: 'function', inputs: [{ name: 'circleId', type: 'uint256' }, { name: 'member', type: 'address' }], outputs: [{ name: 'nonce', type: 'bytes32' }], stateMutability: 'view' },
  { name: 'roundNonce', type: 'function', inputs: [{ name: 'circleId', type: 'uint256' }, { name: 'round', type: 'uint8' }, { name: 'member', type: 'address' }], outputs: [{ name: 'nonce', type: 'bytes32' }], stateMutability: 'view' },
  {
    type: 'event', name: 'CircleCreated',
    inputs: [{ name: 'id', type: 'uint256', indexed: true }, { name: 'name', type: 'string', indexed: false }],
  },
] as const

const arcChain = { id: CHAIN_ID, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } }
const transport = http(RPC_URL)
const publicClient = createPublicClient({ transport, chain: arcChain })

function makeWallet(key: string) {
  const acct = privateKeyToAccount(key as Hex)
  return { acct, client: createWalletClient({ account: acct, transport, chain: arcChain }) }
}

async function waitTx(hash: Hex, label: string) {
  console.log(`  ⏳ ${label}: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status === 'reverted') throw new Error(`TX reverted: ${label}`)
  console.log(`  ✓  ${label}: block ${receipt.blockNumber}`)
  return receipt
}

async function signReceiveAuth(
  signer: ReturnType<typeof makeWallet>['acct'],
  from: Address, to: Address, value: bigint,
  validBefore: bigint, nonce: Hex,
): Promise<{ v: number; r: Hex; s: Hex }> {
  // Delegate EIP-712 encoding to viem signTypedData — avoids manual digest errors
  const sigHex = await signer.signTypedData({
    domain: { name: 'USDC', version: '2', chainId: CHAIN_ID, verifyingContract: USDC_ADDR },
    types: { ReceiveWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ]},
    primaryType: 'ReceiveWithAuthorization',
    message: { from, to, value, validAfter: 0n, validBefore, nonce },
  })
  const sigBytes = Buffer.from(sigHex.slice(2), 'hex')
  return {
    r: `0x${sigBytes.subarray(0, 32).toString('hex')}`,
    s: `0x${sigBytes.subarray(32, 64).toString('hex')}`,
    v: sigBytes[64] < 27 ? sigBytes[64] + 27 : sigBytes[64],
  }
}

async function main() {
  console.log('\n=== Attack Lab Seeder ===\n')

  const k1 = process.env.SEED_KEY_1
  const k2 = process.env.SEED_KEY_2
  const k3 = process.env.SEED_KEY_3
  if (!k1 || !k2 || !k3) throw new Error('SEED_KEY_1/2/3 not set')

  const [w1, w2, w3] = [makeWallet(k1), makeWallet(k2), makeWallet(k3)]
  console.log(`Wallet 1 (creator): ${w1.acct.address}`)
  console.log(`Wallet 2: ${w2.acct.address}`)
  console.log(`Wallet 3: ${w3.acct.address}`)

  // Check balances
  for (const [i, w] of [[1, w1],[2, w2],[3, w3]] as const) {
    const bal = await publicClient.readContract({ address: USDC_ADDR, abi: USDC_ABI, functionName: 'balanceOf', args: [w.acct.address] })
    console.log(`  Wallet ${i} balance: ${Number(bal)/1e6} USDC`)
  }

  const CONTRIBUTION = 100_000n   // 0.1 USDC
  const VALID_BEFORE = BigInt(Math.floor(Date.now() / 1000) + 7200)

  // Create circle (w1 is creator)
  const createNonce = await publicClient.readContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'createDepositNonce', args: [w1.acct.address] })
  const createAuth = await signReceiveAuth(w1.acct, w1.acct.address, CONTRACT, CONTRIBUTION, VALID_BEFORE, createNonce)
  const createHash = await w1.client.writeContract({
    address: CONTRACT, abi: KAMETI_ABI, functionName: 'createCircleWithAuthorization',
    args: [
      'Attack Lab', CONTRIBUTION, 3, BigInt(30 * 24 * 3600),  // 30-day rounds
      1, 3000, 0, 0, 0,   // no post-win lock, no keeper tip
      VALID_BEFORE, createNonce, createAuth.v, createAuth.r, createAuth.s,
    ],
  })
  const createReceipt = await waitTx(createHash, 'createCircleWithAuthorization (Attack Lab)')

  // Get the circle ID from receipt logs (topic[1] = circleId, indexed)
  const CIRCLE_CREATED_TOPIC = '0x6b2b204c21110ae9f9b868c47c705e8c2c48109ca830f1c704a1b7d86adbe22d'
  const createdLog = createReceipt.logs.find(l =>
    l.address.toLowerCase() === CONTRACT.toLowerCase() && l.topics[0] === CIRCLE_CREATED_TOPIC
  )
  if (!createdLog) throw new Error('CircleCreated event not found in receipt')
  const labId = BigInt(createdLog.topics[1] ?? '0x0')
  console.log(`\nAttack Lab circle ID: ${labId}`)

  // w2 and w3 join
  for (const [i, w] of [[2, w2],[3, w3]] as const) {
    const nonce = await publicClient.readContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'depositNonce', args: [labId, w.acct.address] })
    const auth = await signReceiveAuth(w.acct, w.acct.address, CONTRACT, CONTRIBUTION, VALID_BEFORE, nonce)
    const hash = await w.client.writeContract({
      address: CONTRACT, abi: KAMETI_ABI, functionName: 'joinWithAuthorization',
      args: [labId, VALID_BEFORE, nonce, auth.v, auth.r, auth.s],
    })
    await waitTx(hash, `joinWithAuthorization (wallet ${i})`)
  }

  // All 3 store authorizations for rounds 1..3
  for (const [i, w] of [[1, w1],[2, w2],[3, w3]] as const) {
    const rounds: number[] = []
    const validBefores: bigint[] = []
    const vs: number[] = []
    const rs: Hex[] = []
    const ss: Hex[] = []
    for (let r = 1; r <= 3; r++) {
      // Use the contract's view function to get the exact nonce (avoids off-chain abi.encode subtlety)
      const nonce = await publicClient.readContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'roundNonce', args: [labId, r, w.acct.address] })
      const auth = await signReceiveAuth(w.acct, w.acct.address, CONTRACT, CONTRIBUTION, VALID_BEFORE, nonce)
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

  // w1 and w2 pay round 1; w3 has stored auth but does NOT pay (attack 4 target)
  for (const [i, w] of [[1, w1],[2, w2]] as const) {
    const nonce = await publicClient.readContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'roundNonce', args: [labId, 1, w.acct.address] })
    const auth = await signReceiveAuth(w.acct, w.acct.address, CONTRACT, CONTRIBUTION, VALID_BEFORE, nonce)
    const hash = await w.client.writeContract({
      address: CONTRACT, abi: KAMETI_ABI, functionName: 'payWithAuthorization',
      args: [labId, w.acct.address, VALID_BEFORE, auth.v, auth.r, auth.s],
    })
    await waitTx(hash, `payWithAuthorization (wallet ${i}, round 1)`)
  }
  console.log('  w3 has stored auth for round 1 but has NOT paid (attack 4 gas-griefing target).')

  // Write wrong-round fixture: w3's round-2 auth submitted as round 1 → USDC nonce rejection
  const r2Nonce = await publicClient.readContract({ address: CONTRACT, abi: KAMETI_ABI, functionName: 'roundNonce', args: [labId, 2, w3.acct.address] })
  const r2Auth = await signReceiveAuth(w3.acct, w3.acct.address, CONTRACT, CONTRIBUTION, VALID_BEFORE, r2Nonce)

  const fixtureData = {
    _comment: `Round-2 auth for w3 (${w3.acct.address}) in Attack Lab circle #${labId}. Submit while circle is in round 1 → USDC nonce mismatch.`,
    wrongRoundFixture: {
      from: w3.acct.address,
      circleId: labId.toString(),
      targetRound: 1,
      signedForRound: 2,
      validBefore: VALID_BEFORE.toString(),
      v: r2Auth.v,
      r: r2Auth.r,
      s: r2Auth.s,
    },
  }
  const fixturePath = resolve(new URL('../src/config/attackFixtures.json', import.meta.url).pathname)
  writeFileSync(fixturePath, JSON.stringify(fixtureData, null, 2))
  console.log(`\n  ✓ Wrote src/config/attackFixtures.json`)

  console.log(`
=== DONE ===
Attack Lab circle ID: ${labId}

Add to .env:
  VITE_ATTACK_LAB_ID=${labId}

Transactions:
  create: ${createHash}
`)
}

main().catch(e => { console.error(e); process.exit(1) })
