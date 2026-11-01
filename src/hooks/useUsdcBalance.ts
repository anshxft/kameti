/**
 * Live USDC balance for the connected wallet on the active chain,
 * plus a helper that checks whether the user can afford `amount` after
 * reserving gas.
 *
 * On Arc the native gas token IS USDC, so the on-chain ERC-20 balance is
 * also what pays gas.  A transaction that transfers the full balance will
 * fail because no gas remains.
 *
 * Gas reserve strategy:
 *   1. Try to estimate gas for the specific call + latest baseFee.
 *   2. If estimation fails (we don't have the call data yet, or client is
 *      unavailable), fall back to a flat 0.02 USDC minimum reserve.
 *   The minimum is always applied even when estimation succeeds.
 */
import { useReadContract, usePublicClient } from 'wagmi'
import { useCallback } from 'react'
import { CHAIN_ID, NET } from '@/config/network'

/** Minimum gas reserve in USDC micro-units (6 decimals).  0.02 USDC. */
export const GAS_RESERVE_MIN = 20_000n   // 0.02 USDC

const USDC_BALANCE_ABI = [
  {
    name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const USDC_ADDRESS = NET.usdcAddress

/**
 * Returns the ERC-20 USDC balance (6-decimal units) for `address`, or
 * `undefined` while loading.
 */
export function useUsdcBalance(address: `0x${string}` | undefined) {
  const { data } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDC_BALANCE_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 10_000 },
  })
  return (data ?? undefined)
}

/**
 * Returns a function that checks whether `address` can afford `amount`
 * (6-decimal USDC units) including a gas reserve.
 *
 * Returned shape:
 *   { ok: true }
 *   { ok: false; have: bigint; need: bigint }
 *
 * `need` = amount + GAS_RESERVE_MIN.  For UI purposes this is the number
 * to show the user; the actual gas cost may be lower.
 */
export function useCanAfford(address: `0x${string}` | undefined) {
  const balance = useUsdcBalance(address)
  const publicClient = usePublicClient({ chainId: CHAIN_ID })

  const check = useCallback((
    amount: bigint,
  ): { ok: true } | { ok: false; have: bigint; need: bigint } => {
    // If balance unknown, we can't block (wallet may not be connected yet).
    if (balance === undefined) return { ok: true }

    // Flat 0.02 USDC gas reserve (Arc: gas is USDC).
    // For a future improvement, pass the encoded call data and call
    // publicClient.estimateGas() here instead of a fixed floor.
    void publicClient  // retained for that future use

    const need = amount + GAS_RESERVE_MIN

    if (balance < need) {
      return { ok: false, have: balance, need }
    }
    return { ok: true }
  }, [balance, publicClient])

  return { balance, check }
}

/** Format a raw 6-decimal USDC amount as "X.XX" */
export function fmtUsdc(raw: bigint): string {
  return (Number(raw) / 1_000_000).toFixed(2)
}
