import { getUsdc, requireChain } from '@/onchain-facts'
import metadata from '../../contracts/contract-metadata/Kameti.json'

// ─── Network config (single source of truth) ────────────────────────────────
// To switch to Arc Mainnet: change CHAIN_ID and CONTRACT_ADDRESS in .env
export const CHAIN_ID: number = 5042002 // Arc Testnet

export const ARC_CHAIN = requireChain(CHAIN_ID)
export const USDC = getUsdc(CHAIN_ID)!

export const KAMETI_ADDRESS = (
  import.meta.env.VITE_CONTRACT_ADDRESS ?? '0x8a6ed216d5c38f0a35f97c327d79e4d456c9db6c'
) as `0x${string}`

export const KAMETI_ABI = metadata.abi

// ─── Arc Testnet chain definition for wagmi ──────────────────────────────────
export const arcTestnet = {
  id: CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ARC_CHAIN.rpcUrls as [string, ...string[]] } },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: ARC_CHAIN.explorerBase },
  },
  testnet: true,
} as const

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

export function explorerTx(hash: string) {
  return `${ARC_CHAIN.explorerBase}/tx/${hash}`
}

export function explorerAddr(addr: string) {
  return `${ARC_CHAIN.explorerBase}/address/${addr}`
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
