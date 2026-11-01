import metadata from '../../contracts/contract-metadata/Kameti.json'
import {
  CHAIN_ID, KAMETI_ADDRESS, ARC_VIEM_CHAIN, explorerTx, explorerAddr,
} from '@/config/network'

// Re-export the active network values so existing imports keep working.
export { CHAIN_ID, KAMETI_ADDRESS, explorerTx, explorerAddr }

export const ARC_CHAIN    = ARC_VIEM_CHAIN
export const arcTestnet   = ARC_VIEM_CHAIN   // wagmi config compat name

export const KAMETI_ABI = metadata.abi

// ─── Helpers ────────────────────────────────────────────────────────────────
export function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function formatUsdc(raw: bigint) {
  const n = Number(raw) / 1e6
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export function parseUsdc(amount: string): bigint {
  const n = parseFloat(amount)
  if (isNaN(n)) return 0n
  return BigInt(Math.round(n * 1_000_000))
}

export function formatDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

export function formatCountdown(endsAt: number): string {
  const diff = endsAt - Math.floor(Date.now() / 1000)
  if (diff <= 0) return 'Ended'
  const d = Math.floor(diff / 86400)
  const h = Math.floor((diff % 86400) / 3600)
  const m = Math.floor((diff % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// Keep USDC re-export for any files that import it from here
import { getUsdc } from '@/onchain-facts'
export const USDC = getUsdc(CHAIN_ID)!
