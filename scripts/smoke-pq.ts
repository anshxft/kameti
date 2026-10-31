/**
 * SLH-DSA-SHA2-128s live check against Arc Testnet PQ precompile.
 * Uses @noble/post-quantum@0.7.1 with FIPS 205 pure-mode empty context.
 *
 * Signs the exact 32-byte message that Kameti's withdrawPq passes to the precompile:
 *   abi.encodePacked(keccak256(abi.encode("KAMETI_PQ_WITHDRAW", chainId, kameti, member, to, amount, nonce)))
 *
 * Reports:
 *   - valid signature → precompile returns true
 *   - tampered signature → precompile returns false
 */
import { slh_dsa_sha2_128s as slh } from '@noble/post-quantum/slh-dsa.js'
import { createPublicClient, http, encodeFunctionData, parseAbi, toHex, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem'
import { randomBytes } from 'crypto'

const PQ_PRECOMPILE = '0x1800000000000000000000000000000000000004' as const
const KAMETI        = '0x34f31472c5d16e0562668fbea1e700b19b2ea5a7' as const
const CHAIN_ID      = 5042002n
const RPC           = 'https://rpc.testnet.arc.io'

const PQ_ABI = parseAbi([
  'function verifySlhDsaSha2128s(bytes vk, bytes message, bytes sig) view returns (bool)',
])

async function main() {
  const client = createPublicClient({ transport: http(RPC) })

  // 1. Generate SLH-DSA keypair
  const seed = new Uint8Array(randomBytes(48))
  const { publicKey: vk, secretKey: sk } = slh.keygen(seed)
  console.log(`vk length : ${vk.length} bytes (expected 32)`)
  console.log(`sk length : ${sk.length} bytes (expected 64)`)

  // 2. Build the 32-byte message Kameti passes for KAMETI_PQ_WITHDRAW
  //    Solidity: abi.encodePacked(keccak256(abi.encode("KAMETI_PQ_WITHDRAW", chainId, kameti, member, to, amount, nonce)))
  //    = just the raw 32 bytes of the keccak256 hash
  const member  = '0xA29Ed91f4c473cF73B85c72D2E18164770b83C1E' as const  // any address — we sign on behalf of
  const to      = '0xA29Ed91f4c473cF73B85c72D2E18164770b83C1E' as const
  const amount  = 1_000_000n  // 1 USDC
  const nonce   = 0n

  const innerHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters('string, uint256, address, address, address, uint256, uint256'),
      ['KAMETI_PQ_WITHDRAW', CHAIN_ID, KAMETI, member, to, amount, nonce]
    )
  )
  // abi.encodePacked(bytes32) = the raw 32 bytes
  const messageHex = innerHash  // already a 0x-prefixed 32-byte hex string
  const messageBytes = new Uint8Array(Buffer.from(messageHex.slice(2), 'hex'))
  console.log(`\nmessage   : ${messageHex}`)
  console.log(`msg length: ${messageBytes.length} bytes (expected 32)`)

  // 3. Sign with SLH-DSA-SHA2-128s (FIPS 205 pure mode, empty context)
  //    In @noble/post-quantum@0.7.1: sign(msg, sk, opts?)
  const sig = slh.sign(messageBytes, sk)
  console.log(`sig length: ${sig.length} bytes (expected 7856)`)

  // 4. Local verify sanity check
  const localOk = slh.verify(sig, messageBytes, vk)
  console.log(`local verify: ${localOk}`)
  if (!localOk) throw new Error('local verify failed — library issue')

  // 5. Call Arc precompile with valid sig
  const calldataValid = encodeFunctionData({
    abi: PQ_ABI,
    functionName: 'verifySlhDsaSha2128s',
    args: [toHex(vk), messageHex, toHex(sig)],
  })
  console.log('\n--- Arc Testnet calls ---')
  console.log('Calling precompile with VALID signature...')
  const resultValid = await client.call({ to: PQ_PRECOMPILE, data: calldataValid })
  const validTrue = resultValid.data === '0x0000000000000000000000000000000000000000000000000000000000000001'
  console.log(`raw: ${resultValid.data}`)
  console.log(`valid sig → true?  ${validTrue ? 'YES ✓' : 'NO — unexpected!'}`)

  // 6. Call with tampered sig
  const tamperedSig = new Uint8Array(sig)
  tamperedSig[100] ^= 0xff
  const calldataTampered = encodeFunctionData({
    abi: PQ_ABI,
    functionName: 'verifySlhDsaSha2128s',
    args: [toHex(vk), messageHex, toHex(tamperedSig)],
  })
  console.log('\nCalling precompile with TAMPERED signature...')
  const resultTampered = await client.call({ to: PQ_PRECOMPILE, data: calldataTampered })
  const tamperedFalse = resultTampered.data === '0x0000000000000000000000000000000000000000000000000000000000000000'
  console.log(`raw: ${resultTampered.data}`)
  console.log(`tampered sig → false? ${tamperedFalse ? 'YES ✓' : 'NO — unexpected!'}`)

  if (validTrue && tamperedFalse) {
    console.log('\nSMOKE TEST PASSED: Arc PQ precompile works correctly with SLH-DSA-SHA2-128s.')
  } else {
    console.error('\nSMOKE TEST FAILED')
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
