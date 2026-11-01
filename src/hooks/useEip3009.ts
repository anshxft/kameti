/**
 * EIP-3009 ReceiveWithAuthorization signing hook for Kameti v3.1.
 *
 * Nonces are always fetched from the contract's own view functions:
 *   createCircleWithAuthorization → createDepositNonce(creator)
 *   joinWithAuthorization         → depositNonce(circleId, member)
 *   payWithAuthorization          → roundNonce(circleId, round, member)
 *   storeAuthorizations           → roundNonce(circleId, round, member) for each round
 *
 * Signing uses viem signTypedData (EIP-712) through the wallet.
 * The DOMAIN_SEPARATOR is verified against the live USDC contract before signing.
 */
import { useCallback } from 'react'
import { usePublicClient, useWalletClient } from 'wagmi'
import { type Hex, type Address } from 'viem'
import { CHAIN_ID, KAMETI_ADDRESS, NET } from '@/config/network'

const USDC_ADDRESS = NET.usdcAddress

// Minimal ABI fragments for the view functions we call
const NONCE_ABI = [
  {
    name: 'createDepositNonce', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'creator', type: 'address' }],
    outputs: [{ name: 'nonce', type: 'bytes32' }],
  },
  {
    name: 'depositNonce', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'circleId', type: 'uint256' }, { name: 'member', type: 'address' }],
    outputs: [{ name: 'nonce', type: 'bytes32' }],
  },
  {
    name: 'roundNonce', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'circleId', type: 'uint256' },
      { name: 'round', type: 'uint8' },
      { name: 'member', type: 'address' },
    ],
    outputs: [{ name: 'nonce', type: 'bytes32' }],
  },
  {
    name: 'DOMAIN_SEPARATOR', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'bytes32' }],
  },
] as const

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

  /** Verify the USDC DOMAIN_SEPARATOR matches the expected value for this network */
  const verifyDomain = useCallback(async (): Promise<Hex> => {
    if (!publicClient) throw new Error('No public client')
    const domSep = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: NONCE_ABI,
      functionName: 'DOMAIN_SEPARATOR',
    })
    const expected = NET.usdcDomainSep.toLowerCase()
    if ((domSep as string).toLowerCase() !== expected) {
      throw new Error(
        `DOMAIN_SEPARATOR mismatch. Expected ${NET.usdcDomainSep}, got ${domSep as string}. Refusing to sign.`
      )
    }
    return domSep
  }, [publicClient])

  /** Sign via EIP-712 signTypedData — avoids manual digest errors */
  const signEip712 = useCallback(async (
    from: Address, to: Address, value: bigint, validBefore: bigint, nonce: Hex,
  ): Promise<{ v: number; r: Hex; s: Hex }> => {
    if (!walletClient) throw new Error('No wallet connected')
    const sigHex = await walletClient.signTypedData({
      domain: {
        name: 'USDC', version: '2',
        chainId: CHAIN_ID,
        verifyingContract: USDC_ADDRESS,
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
      message: { from, to, value, validAfter: 0n, validBefore, nonce },
    })
    const sigBytes = Buffer.from((sigHex as string).slice(2), 'hex')
    return {
      r: ('0x' + sigBytes.subarray(0, 32).toString('hex')) as Hex,
      s: ('0x' + sigBytes.subarray(32, 64).toString('hex')) as Hex,
      v: sigBytes[64] < 27 ? sigBytes[64] + 27 : sigBytes[64],
    }
  }, [walletClient])

  /**
   * Sign for createCircleWithAuthorization.
   * value = deposit = contribution × depositMultiplier
   * nonce = contract.createDepositNonce(creator)
   */
  const signCreateAuth = useCallback(async (
    value: bigint,
  ): Promise<Eip3009Signature> => {
    if (!walletClient) throw new Error('No wallet connected')
    if (!publicClient) throw new Error('No public client')
    const from = walletClient.account.address
    await verifyDomain()
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const nonce = await publicClient.readContract({
      address: KAMETI_ADDRESS,
      abi: NONCE_ABI,
      functionName: 'createDepositNonce',
      args: [from],
    })
    const sig = await signEip712(from, KAMETI_ADDRESS, value, validBefore, nonce)
    return { ...sig, validBefore, nonce }
  }, [walletClient, publicClient, verifyDomain, signEip712])

  /**
   * Sign for joinWithAuthorization.
   * value = deposit = contribution × depositMultiplier
   * nonce = contract.depositNonce(circleId, member)
   */
  const signDepositAuth = useCallback(async (
    circleId: bigint,
    value: bigint,
  ): Promise<Eip3009Signature> => {
    if (!walletClient) throw new Error('No wallet connected')
    if (!publicClient) throw new Error('No public client')
    const from = walletClient.account.address
    await verifyDomain()
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const nonce = await publicClient.readContract({
      address: KAMETI_ADDRESS,
      abi: NONCE_ABI,
      functionName: 'depositNonce',
      args: [circleId, from],
    })
    const sig = await signEip712(from, KAMETI_ADDRESS, value, validBefore, nonce)
    return { ...sig, validBefore, nonce }
  }, [walletClient, publicClient, verifyDomain, signEip712])

  /**
   * Sign for payWithAuthorization (single round) or storeAuthorizations (per-round).
   * value = contribution
   * nonce = contract.roundNonce(circleId, round, member)
   *
   * validBeforeOverride: caller supplies the expiry when signing AutoPay batches so
   * that later-round signatures don't expire before they are used.  When omitted
   * (plain pay), defaults to now + 1 hour — short enough to limit replay window.
   */
  const signRoundAuth = useCallback(async (
    circleId: bigint,
    round: number,
    value: bigint,
    validBeforeOverride?: bigint,
  ): Promise<Eip3009Signature> => {
    if (!walletClient) throw new Error('No wallet connected')
    if (!publicClient) throw new Error('No public client')
    const from = walletClient.account.address
    await verifyDomain()
    const validBefore = validBeforeOverride ?? BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 h
    const nonce = await publicClient.readContract({
      address: KAMETI_ADDRESS,
      abi: NONCE_ABI,
      functionName: 'roundNonce',
      args: [circleId, round, from],
    })
    const sig = await signEip712(from, KAMETI_ADDRESS, value, validBefore, nonce)
    return { ...sig, validBefore, nonce }
  }, [walletClient, publicClient, verifyDomain, signEip712])

  return { signCreateAuth, signDepositAuth, signRoundAuth, verifyDomain }
}
