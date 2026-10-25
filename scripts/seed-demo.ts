/**
 * Kameti Demo Seeder
 * Creates a seeded demo circle on Arc Testnet with real on-chain transactions.
 *
 * Circle: "Demo Kameti", 1 USDC contribution, 4 members, 10-min rounds,
 *         deposit 2×, max discount 30%, minScore 0.
 * Round 1: all 4 pay, bids at 5% then 8%, settle after deadline.
 * Round 2: all 4 pay, one bid at 4%, one member turns AutoPay on. Left open.
 *
 * Usage: bun run scripts/seed-demo.ts
 * Keys must be in .env as SEED_KEY_0..3 (set by this script on first run).
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  parseAbiItem,
  type Abi,
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Config ──────────────────────────────────────────────────────────────────
const RPC_URL      = 'https://rpc.testnet.arc.io'
const CHAIN_ID     = 5042002
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as `0x${string}`
const CONTRACT     = (process.env.VITE_CONTRACT_ADDRESS ?? '0x8a6ed216d5c38f0a35f97c327d79e4d456c9db6c') as `0x${string}`
const ENV_PATH     = join(__dirname, '..', '.env')
const CONTRIBUTION = parseUnits('1', 6)      // 1 USDC
const ROUND_DUR    = 600n                    // 10 minutes in seconds
const MAX_MEMBERS  = 4

// ─── Arc Testnet chain definition ────────────────────────────────────────────
const arcTestnet = {
  id: CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const

// ─── ABI snippets ─────────────────────────────────────────────────────────────
const USDC_ABI = [
  parseAbiItem('function approve(address spender, uint256 amount) returns (bool)'),
  parseAbiItem('function balanceOf(address) view returns (uint256)'),
  parseAbiItem('function transfer(address to, uint256 amount) returns (bool)'),
] as const

// Load full ABI from compiled artifact (avoids abitype tuple-parse issues)
const artifactPath = join(__dirname, '..', 'contracts', 'out', 'Kameti.sol', 'Kameti.json')
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { abi: Abi }
const KAMETI_ABI = artifact.abi

// Just the event signature for getLogs
const CIRCLE_CREATED_EVENT = parseAbiItem('event CircleCreated(uint256 indexed id, string name, uint256 contribution, uint8 maxMembers, address indexed creator)')

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(msg: string) { console.log(`[seed] ${msg}`) }

async function waitTx(publicClient: ReturnType<typeof createPublicClient>, hash: `0x${string}`, label: string) {
  log(`  tx ${label}: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
  if (receipt.status !== 'success') throw new Error(`tx reverted: ${label}`)
  log(`  ✓ ${label} confirmed in block ${receipt.blockNumber}`)
  return receipt
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function appendEnv(key: string, value: string) {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''
  if (existing.includes(`${key}=`)) return // already set
  appendFileSync(ENV_PATH, `\n${key}=${value}\n`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('=== Kameti Demo Seeder ===')
  log(`Contract: ${CONTRACT}`)
  log(`RPC:      ${RPC_URL}`)

  // 1. Load or generate 4 wallet keys
  const keys: `0x${string}`[] = []
  for (let i = 0; i < MAX_MEMBERS; i++) {
    const envKey = `SEED_KEY_${i}`
    let k = process.env[envKey] as `0x${string}` | undefined
    if (!k || k.length < 10) {
      k = generatePrivateKey()
      appendEnv(envKey, k)
      log(`Generated wallet ${i}: saved to .env as ${envKey}`)
    }
    keys.push(k)
  }

  const accounts = keys.map(k => privateKeyToAccount(k))
  log('Wallets:')
  accounts.forEach((a, i) => log(`  [${i}] ${a.address}`))

  // 2. Clients
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL) })
  const wallets = accounts.map(a =>
    createWalletClient({ account: a, chain: arcTestnet, transport: http(RPC_URL) })
  )

  // 3. Check balances — need USDC (native) for gas + contribution + deposit
  // On Arc, native token IS USDC (18 dec). Each wallet needs:
  //   gas ~0.01 USDC (native 18-dec units = 1e16)
  //   deposit 2 USDC ERC-20
  //   contribution 1 USDC ERC-20 × 2 rounds = 2 USDC ERC-20
  //   total ≈ 4.1 USDC
  // We'll check ERC-20 balance (6 dec) — need ≥ 4 USDC each.
  log('\nChecking USDC balances (ERC-20)…')
  const balances = await Promise.all(
    accounts.map(a => publicClient.readContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: 'balanceOf', args: [a.address],
    }))
  )
  balances.forEach((b, i) => log(`  [${i}] ${accounts[i].address}: ${Number(b) / 1e6} USDC`))

  const MIN_USDC = parseUnits('5', 6) // 5 USDC ERC-20 each should be enough
  const FUND_AMOUNT = parseUnits('6', 6) // 6 USDC per wallet when self-funding

  // If wallet 0 has enough, auto-distribute to any wallet that needs it
  const needsFunding = accounts.filter((_, i) => balances[i] < MIN_USDC)
  if (needsFunding.length > 0) {
    const totalNeeded = FUND_AMOUNT * BigInt(needsFunding.length)
    if (balances[0] >= MIN_USDC + totalNeeded) {
      log('\nAuto-distributing USDC from wallet 0 to underfunded wallets…')
      for (let i = 1; i < MAX_MEMBERS; i++) {
        if (balances[i] < MIN_USDC) {
          const hash = await wallets[0].writeContract({
            address: USDC_ADDRESS, abi: USDC_ABI,
            functionName: 'transfer', args: [accounts[i].address, FUND_AMOUNT],
          })
          await waitTx(publicClient, hash, `fund wallet[${i}]`)
        }
      }
    } else {
      log('\nWARNING: Some wallets have < 5 USDC and wallet 0 cannot cover them all.')
      log('Please fund these addresses with at least 6 USDC each via the Arc Studio sidebar ("Get test USDC"):')
      needsFunding.forEach(a => log(`  ${a.address}`))
      log('\nWallet 0 (fund this one first — it will distribute to the rest if it has ≥ 30 USDC):')
      log(`  ${accounts[0].address}`)
      process.exit(1)
    }
  }

  // 4. Approve contract to spend USDC for each wallet (deposit + 2 rounds = 4 USDC)
  log('\nApproving USDC…')
  const APPROVE_AMOUNT = parseUnits('10', 6) // 10 USDC allowance per wallet
  for (let i = 0; i < MAX_MEMBERS; i++) {
    const hash = await wallets[i].writeContract({
      address: USDC_ADDRESS, abi: USDC_ABI,
      functionName: 'approve', args: [CONTRACT, APPROVE_AMOUNT],
    })
    await waitTx(publicClient, hash, `approve[${i}]`)
  }

  // 5. Wallet 0 creates the circle
  log('\nCreating circle…')
  const createHash = await wallets[0].writeContract({
    address: CONTRACT, abi: KAMETI_ABI,
    functionName: 'createCircle',
    args: ['Demo Kameti', CONTRIBUTION, MAX_MEMBERS, ROUND_DUR, 2, 3000, 0],
  })
  const createReceipt = await waitTx(publicClient, createHash, 'createCircle')

  // Use getLogs to find the CircleCreated event in this tx
  const allLogs = await publicClient.getLogs({
    address: CONTRACT,
    event: CIRCLE_CREATED_EVENT,
    fromBlock: createReceipt.blockNumber,
    toBlock: createReceipt.blockNumber,
  })
  if (allLogs.length === 0) throw new Error('CircleCreated event not found')
  const circleId = allLogs[allLogs.length - 1].args.id!
  log(`\nCircle created! ID: ${circleId}`)
  log(`Explorer: https://explorer.testnet.arc.io/address/${CONTRACT}`)

  // 6. Wallets 1–3 join
  log('\nJoining circle…')
  for (let i = 1; i < MAX_MEMBERS; i++) {
    const hash = await wallets[i].writeContract({
      address: CONTRACT, abi: KAMETI_ABI,
      functionName: 'join', args: [circleId],
    })
    await waitTx(publicClient, hash, `join[${i}]`)
  }
  log(`All ${MAX_MEMBERS} members joined. Round 1 started.`)

  // ── ROUND 1 ───────────────────────────────────────────────────────────────
  log('\n── Round 1 ──')

  // All 4 pay
  log('All members paying…')
  for (let i = 0; i < MAX_MEMBERS; i++) {
    const hash = await wallets[i].writeContract({
      address: CONTRACT, abi: KAMETI_ABI,
      functionName: 'pay', args: [circleId],
    })
    await waitTx(publicClient, hash, `pay[${i}] round1`)
  }

  // Wallet 1 bids 5% of pot (pot = 4 USDC, 5% = 0.2 USDC)
  const pot = CONTRIBUTION * BigInt(MAX_MEMBERS) // 4 USDC
  const bid1 = pot * 5n / 100n    // 0.2 USDC
  const bid2 = pot * 8n / 100n    // 0.32 USDC
  log(`Wallet 1 bids 5% (${Number(bid1)/1e6} USDC)…`)
  {
    const hash = await wallets[1].writeContract({
      address: CONTRACT, abi: KAMETI_ABI,
      functionName: 'placeBid', args: [circleId, bid1],
    })
    await waitTx(publicClient, hash, 'bid 5%')
  }
  log(`Wallet 2 bids 8% (${Number(bid2)/1e6} USDC)…`)
  {
    const hash = await wallets[2].writeContract({
      address: CONTRACT, abi: KAMETI_ABI,
      functionName: 'placeBid', args: [circleId, bid2],
    })
    await waitTx(publicClient, hash, 'bid 8%')
  }

  // Wait for round deadline (10 min = 600s). We'll warp by checking roundEnd.
  const circleData = await publicClient.readContract({
    address: CONTRACT, abi: KAMETI_ABI,
    functionName: 'getCircle', args: [circleId],
  }) as [unknown, number, number, bigint, bigint, string, bigint]
  const roundEnd = Number(circleData[3]) // roundEnd timestamp
  const now      = Math.floor(Date.now() / 1000)
  const waitSecs = roundEnd - now + 5    // +5s buffer

  if (waitSecs > 0) {
    log(`\nWaiting ${waitSecs}s for round 1 deadline (${new Date(roundEnd * 1000).toISOString()})…`)
    log('(This will take ~10 minutes. Leave this script running.)')
    await sleep(waitSecs * 1000)
  }

  log('\nSettling round 1…')
  {
    const hash = await wallets[0].writeContract({
      address: CONTRACT, abi: KAMETI_ABI,
      functionName: 'settleRound', args: [circleId],
    })
    await waitTx(publicClient, hash, 'settleRound 1')
  }
  log('Round 1 settled. Wallet 2 won with 8% discount.')

  // ── ROUND 2 ───────────────────────────────────────────────────────────────
  log('\n── Round 2 ──')
  log('All members paying round 2…')
  for (let i = 0; i < MAX_MEMBERS; i++) {
    const hash = await wallets[i].writeContract({
      address: CONTRACT, abi: KAMETI_ABI,
      functionName: 'pay', args: [circleId],
    })
    await waitTx(publicClient, hash, `pay[${i}] round2`)
  }

  // Wallet 0 bids 4%
  const bid3 = pot * 4n / 100n  // 0.16 USDC
  log(`Wallet 0 bids 4% (${Number(bid3)/1e6} USDC)…`)
  {
    const hash = await wallets[0].writeContract({
      address: CONTRACT, abi: KAMETI_ABI,
      functionName: 'placeBid', args: [circleId, bid3],
    })
    await waitTx(publicClient, hash, 'bid 4% round2')
  }

  // Wallet 3 turns AutoPay on (approve already done above)
  log('Wallet 3 enables AutoPay…')
  {
    const hash = await wallets[3].writeContract({
      address: CONTRACT, abi: KAMETI_ABI,
      functionName: 'setAutoPay', args: [circleId, true],
    })
    await waitTx(publicClient, hash, 'setAutoPay wallet3')
  }

  log('\n=== SEED COMPLETE ===')
  log(`Circle ID: ${circleId}`)
  log(`Round 2 is LIVE (all paid, bid at 4% shown, AutoPay on for wallet 3).`)
  log(`View: https://explorer.testnet.arc.io/address/${CONTRACT}`)
  log(`App:  /k/${circleId}`)
  log('')
  log('Add to Home.tsx: DEMO_CIRCLE_ID=' + circleId.toString())

  // Write circleId to .env for the app to read
  appendEnv('VITE_DEMO_CIRCLE_ID', circleId.toString())
  log(`Written VITE_DEMO_CIRCLE_ID=${circleId} to .env`)
}

main().catch(e => { console.error(e); process.exit(1) })
