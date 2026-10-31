/**
 * EIP-3009 ReceiveWithAuthorization signing hook for Kameti v3.1.
 *
 * Arc USDC uses EIP-712 domain: name="USDC", version="2".
 * The DOMAIN_SEPARATOR is verified against the live contract before signing.
 */
import { useCallback } from 'react'
import { usePublicClient, useWalletClient } from 'wagmi'
import { keccak256, encodeAbiParameters, parseAbiParameters, concat, type Hex, type Address } from 'viem'
import { KAMETI_ADDRESS, CHAIN_ID } from '@/lib/contract'
import { getUsdc } from '@/onchain-facts'

// Arc Testnet USDC domain separator — verified on-chain
const EXPECTED_DOMAIN_SEP = '0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0' as Hex

const USDC_ADDRESS = getUsdc(CHAIN_ID)!.address as Address

const RECEIVE_TYPEHASH = keccak256(
  new TextEncoder().encode(
    'ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'
  )
)

const DOMAIN_SEPARATOR_ABI = [
  { name: 'DOMAIN_SEPARATOR', type: 'function', inputs: [], outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view' },
] as const

/** Build the roundNonce that Kameti uses for a member in a given circle+round */
export function buildRoundNonce(circleId: bigint, chainId: bigint, round: number, member: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('address,uint256,uint256,uint8,address'),
      [KAMETI_ADDRESS, chainId, circleId, round, member]
    )
  )
}

/** Build the depositNonce for create/join with authorization */
export function buildDepositNonce(circleId: bigint, chainId: bigint, member: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('address,uint256,uint256,uint8,address'),
      [KAMETI_ADDRESS, chainId, circleId, 0, member]
    )
  )
}

/** Build a ReceiveWithAuthorization EIP-712 digest */
function buildDigest(domainSep: Hex, from: Address, to: Address, value: bigint, validAfter: bigint, validBefore: bigint, nonce: Hex): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32,address,address,uint256,uint256,uint256,bytes32'),
      [RECEIVE_TYPEHASH, from, to, value, validAfter, validBefore, nonce]
    )
  )
  const prefix = new Uint8Array([0x19, 0x01])
  const domBytes = new Uint8Array(Buffer.from(domainSep.slice(2), 'hex'))
  const strBytes = new Uint8Array(Buffer.from(structHash.slice(2), 'hex'))
  return keccak256(concat([prefix, domBytes, strBytes]))
}

export interface Eip3009Signature {
  v: number
  r: Hex
  s: Hex
  validBefore: bigint
  nonce: Hex
}

export function useEip3009Sign() {
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { data: walletClient } = useWalletClient({ chainId: CHAIN_ID })

  /** Verify the USDC DOMAIN_SEPARATOR matches the expected value */
  const verifyDomain = useCallback(async (): Promise<Hex> => {
    if (!publicClient) throw new Error('No public client')
    const domSep = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: DOMAIN_SEPARATOR_ABI,
      functionName: 'DOMAIN_SEPARATOR',
    })
    if (domSep.toLowerCase() !== EXPECTED_DOMAIN_SEP.toLowerCase()) {
      throw new Error(`DOMAIN_SEPARATOR mismatch. Expected ${EXPECTED_DOMAIN_SEP}, got ${domSep}. Refusing to sign.`)
    }
    return domSep
  }, [publicClient])

  /**
   * Sign one ReceiveWithAuthorization for a round payment.
   * Returns { v, r, s, validBefore, nonce }
   */
  const signRoundAuth = useCallback(async (
    circleId: bigint,
    round: number,
    value: bigint,
  ): Promise<Eip3009Signature> => {
    if (!walletClient) throw new Error('No wallet connected')
    const from = walletClient.account.address
    const chainId = BigInt(CHAIN_ID)
    const domainSep = await verifyDomain()
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7) // 7 days
    const nonce = buildRoundNonce(circleId, chainId, round, from)
    const digest = buildDigest(domainSep, from, KAMETI_ADDRESS, value, 0n, validBefore, nonce)
    const sigHex = await walletClient.signMessage({ message: { raw: digest } })
    const sigBytes = Buffer.from(sigHex.slice(2), 'hex')
    return {
      v: sigBytes[64] < 27 ? sigBytes[64] + 27 : sigBytes[64],
      r: ('0x' + sigBytes.subarray(0, 32).toString('hex')) as Hex,
      s: ('0x' + sigBytes.subarray(32, 64).toString('hex')) as Hex,
      validBefore,
      nonce,
    }
  }, [walletClient, verifyDomain])

  /**
   * Sign a deposit ReceiveWithAuthorization for create/join.
   */
  const signDepositAuth = useCallback(async (
    circleId: bigint,
    value: bigint,
  ): Promise<Eip3009Signature> => {
    if (!walletClient) throw new Error('No wallet connected')
    const from = walletClient.account.address
    const chainId = BigInt(CHAIN_ID)
    const domainSep = await verifyDomain()
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const nonce = buildDepositNonce(circleId, chainId, from)
    const digest = buildDigest(domainSep, from, KAMETI_ADDRESS, value, 0n, validBefore, nonce)
    const sigHex = await walletClient.signMessage({ message: { raw: digest } })
    const sigBytes = Buffer.from(sigHex.slice(2), 'hex')
    return {
      v: sigBytes[64] < 27 ? sigBytes[64] + 27 : sigBytes[64],
      r: ('0x' + sigBytes.subarray(0, 32).toString('hex')) as Hex,
      s: ('0x' + sigBytes.subarray(32, 64).toString('hex')) as Hex,
      validBefore,
      nonce,
    }
  }, [walletClient, verifyDomain])

  return { signRoundAuth, signDepositAuth, verifyDomain }
}
