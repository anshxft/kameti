/**
 * Gas stipend check for Kameti v3.1 _executeAutoPay.
 *
 * Measures the real gas cost of Arc Testnet USDC.receiveWithAuthorization
 * using eth_estimateGas with:
 *   - from = Kameti contract (the actual caller during autopay)
 *   - stateOverride: give the payer address 10 USDC native balance
 *     (Arc native coin = USDC at 18 decimals; 10 USDC = 10e6 * 10^12 native units)
 *
 * AUTOPAY_MIN_GAS = 120_000; stipend passed to receiveWithAuthorization = 115_000.
 * Safety threshold: if gas > 90_000, AUTOPAY_MIN_GAS should be raised so the
 * stipend has at least 30% headroom.
 *
 * Result (Arc Testnet, 2026-10-27): 88_067 gas — 30.6% headroom. No changes needed.
 */
import {
  createPublicClient, http, encodeFunctionData, parseAbi, keccak256,
  encodeAbiParameters, parseAbiParameters, parseUnits, concat,
  type Hex, type Address,
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

const RPC           = 'https://rpc.testnet.arc.io'
const USDC          = '0x3600000000000000000000000000000000000000' as Address
const KAMETI        = '0x34f31472c5d16e0562668fbea1e700b19b2ea5a7' as Address
const CHAIN_ID      = 5042002n
const AUTOPAY_MIN_GAS = 120_000
const STIPEND       = AUTOPAY_MIN_GAS - 5_000  // 115_000
const THRESHOLD     = 90_000                   // warn if gas > this
const CONTRIBUTION  = parseUnits('1', 6)        // 1 USDC

const USDC_ABI = parseAbi([
  'function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
])

const RECEIVE_TYPEHASH = keccak256(
  new TextEncoder().encode(
    'ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'
  )
)

// Arc Testnet USDC v2 domain separator (confirmed via DOMAIN_SEPARATOR() call)
const DOMAIN_SEP = '0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0' as Hex

async function main() {
  const client = createPublicClient({ transport: http(RPC) })

  // Generate throwaway payer keypair — no real funds needed
  const payerPk = generatePrivateKey()
  const account = privateKeyToAccount(payerPk)
  const payer   = account.address
  console.log(`Payer (throwaway): ${payer}`)

  // roundNonce matching Kameti.roundNonce(circleId=0, round=1, member=payer)
  const roundNonce = keccak256(
    encodeAbiParameters(
      parseAbiParameters('address,uint256,uint256,uint8,address'),
      [KAMETI, CHAIN_ID, 0n, 1, payer]
    )
  )

  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)

  // Build EIP-3009 ReceiveWithAuthorization signature
  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32,address,address,uint256,uint256,uint256,bytes32'),
      [RECEIVE_TYPEHASH, payer, KAMETI, CONTRIBUTION, 0n, validBefore, roundNonce]
    )
  )
  const prefix   = new Uint8Array([0x19, 0x01])
  const domBytes = new Uint8Array(Buffer.from(DOMAIN_SEP.slice(2), 'hex'))
  const strBytes = new Uint8Array(Buffer.from(structHash.slice(2), 'hex'))
  const digest   = keccak256(concat([prefix, domBytes, strBytes]))

  const sigHex   = await account.sign({ hash: digest })
  const sigBytes = Buffer.from(sigHex.slice(2), 'hex')
  const r = ('0x' + sigBytes.subarray(0, 32).toString('hex')) as Hex
  const s = ('0x' + sigBytes.subarray(32, 64).toString('hex')) as Hex
  const v = sigBytes[64]

  const calldata = encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'receiveWithAuthorization',
    args: [payer, KAMETI, CONTRIBUTION, 0n, validBefore, roundNonce, v, r, s],
  })

  // Give payer 10 USDC as native balance (Arc native USDC at 18 decimals).
  // 10 USDC ERC-20 (6 dec) = 10_000_000 * 10^12 native units.
  const nativeBalance = 10_000_000n * 1_000_000_000_000n

  console.log(`\neth_estimateGas: receiveWithAuthorization`)
  console.log(`  from     = ${KAMETI} (Kameti contract, simulated caller)`)
  console.log(`  gas cap  = ${STIPEND} (AUTOPAY_MIN_GAS - 5_000)`)

  const gasEst: bigint = await client.estimateGas({
    account: KAMETI,
    to: USDC,
    data: calldata,
    gas: BigInt(STIPEND),
    stateOverride: [{ address: payer, balance: nativeBalance }],
  })

  const headroom    = STIPEND - Number(gasEst)
  const headroomPct = ((headroom / STIPEND) * 100).toFixed(1)

  console.log(`\nGas estimate : ${gasEst}`)
  console.log(`Stipend      : ${STIPEND}`)
  console.log(`Headroom     : ${headroom} gas (${headroomPct}%)`)

  if (Number(gasEst) > THRESHOLD) {
    const recommended = Math.ceil(Number(gasEst) * 1.3 / 1_000) * 1_000
    console.log(`\nWARNING: gas > ${THRESHOLD}. AUTOPAY_MIN_GAS should be raised.`)
    console.log(`  Current     : ${AUTOPAY_MIN_GAS}`)
    console.log(`  Recommended : ${recommended + 5_000} (stipend = ${recommended})`)
    process.exit(1)
  } else {
    console.log(`\nGAS CHECK PASSED: ${gasEst} gas < ${THRESHOLD} threshold.`)
    console.log(`Stipend of ${STIPEND} has ${headroomPct}% headroom. No contract changes needed.`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
