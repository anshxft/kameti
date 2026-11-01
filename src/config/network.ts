/**
 * Network configuration — single switch via VITE_NETWORK.
 *
 * Default network is COMMITTED here as 'testnet'.
 * Set VITE_NETWORK=mainnet to point the whole app at Arc Mainnet.
 *
 * Mainnet Kameti address is also committed here (empty = not deployed yet).
 * Set VITE_KAMETI_MAINNET to override after mainnet deploy.
 * When the mainnet address is empty, KAMETI_DEPLOYED is false and the app
 * shows a "Mainnet contract not deployed yet" banner instead of calling a
 * wrong address.
 *
 * /break is ALWAYS pinned to testnet — it never reads from this file.
 */

// ── Committed defaults (Vercel builds have no .env) ──────────────────────────
/** Default network. Change this when mainnet is ready to go live. */
const DEFAULT_NETWORK = 'testnet' as const

/**
 * Mainnet Kameti contract address — committed constant.
 * Empty string means not deployed yet.
 * Set VITE_KAMETI_MAINNET to override.
 */
const MAINNET_KAMETI_DEFAULT = '' // fill in after mainnet deploy

// ── Determine active network ─────────────────────────────────────────────────
export type NetworkId = 'testnet' | 'mainnet'

const _raw = String(import.meta.env.VITE_NETWORK ?? '')
export const NETWORK: NetworkId =
  _raw === 'mainnet' ? 'mainnet' : _raw === 'testnet' ? 'testnet' : DEFAULT_NETWORK

export const IS_MAINNET = NETWORK === 'mainnet'

// ── Per-network config ───────────────────────────────────────────────────────

interface NetworkConfig {
  chainId:        number
  displayName:    string
  rpcUrl:         string
  wsUrl:          string
  explorerBase:   string
  /** Empty string when not yet deployed (only possible on mainnet). */
  kametiAddress:  string
  usdcAddress:    `0x${string}`
  usdcDomainSep:  `0x${string}`
  deployBlock:    bigint
  demoCircleId:   bigint
  attackLabId:    bigint
  isTestnet:      boolean
  /** Circle App Kit blockchain identifier for the bridge destination. */
  bridgeDestId:   string
  mainnetReceipts: { label: string; hash: string }[]
}

const TESTNET_CONFIG: NetworkConfig = {
  chainId:       5042002,
  displayName:   'Arc Testnet',
  rpcUrl:        'https://rpc.testnet.arc.io',
  wsUrl:         'wss://rpc.testnet.arc.io',
  explorerBase:  'https://explorer.testnet.arc.io',
  kametiAddress: (import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined)
                   ?? '0x34f31472c5d16e0562668fbea1e700b19b2ea5a7',
  usdcAddress:   '0x3600000000000000000000000000000000000000',
  usdcDomainSep: '0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0',
  deployBlock:   69_160_000n,
  demoCircleId:  BigInt(String(import.meta.env.VITE_DEMO_CIRCLE_ID ?? '2')),
  attackLabId:   BigInt(String(import.meta.env.VITE_ATTACK_LAB_ID ?? '7')),
  isTestnet:     true,
  bridgeDestId:  'Arc_Testnet',
  mainnetReceipts: [],
}

// Mainnet Kameti address: env override first, then committed default (may be '').
const _mainnetAddr = (import.meta.env.VITE_KAMETI_MAINNET as string | undefined) ?? MAINNET_KAMETI_DEFAULT

const MAINNET_CONFIG: NetworkConfig = {
  chainId:       5042,
  displayName:   'Arc',
  rpcUrl:        'https://rpc.mainnet.arc.io',
  wsUrl:         'wss://rpc.mainnet.arc.io',
  explorerBase:  'https://explorer.arc.io',
  kametiAddress: _mainnetAddr,            // empty string when not deployed
  usdcAddress:   '0x3600000000000000000000000000000000000000',
  usdcDomainSep: '0x940506929bba468048a19b567f4f0d534714bc06604b5c3017e5d16785ccdf84',
  deployBlock:   0n,                      // set after mainnet deploy
  demoCircleId:  0n,
  attackLabId:   0n,
  isTestnet:     false,
  bridgeDestId:  'Arc',                   // Blockchain.Arc — confirmed in App Kit types
  mainnetReceipts: [],
}

export const NET: NetworkConfig = IS_MAINNET ? MAINNET_CONFIG : TESTNET_CONFIG

/**
 * True when the Kameti contract is deployed on the active network.
 * Always true on testnet. False on mainnet until VITE_KAMETI_MAINNET is set.
 * Pages that trigger write transactions MUST gate on this flag.
 */
export const KAMETI_DEPLOYED: boolean = NET.kametiAddress.length > 0

// ── Viem chain object (for wagmi config) ─────────────────────────────────────
export const ARC_VIEM_CHAIN = {
  id: NET.chainId,
  name: NET.displayName,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [NET.rpcUrl] as [string, ...string[]] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: NET.explorerBase } },
  testnet: NET.isTestnet,
} as const

// ── Convenience re-exports ────────────────────────────────────────────────────
/**
 * Active Kameti address. Only use this after checking KAMETI_DEPLOYED.
 * On mainnet before deploy this is '' — passing it to a contract call will throw.
 */
export const CHAIN_ID       = NET.chainId
export const KAMETI_ADDRESS = NET.kametiAddress as `0x${string}`
export const USDC_ADDRESS   = NET.usdcAddress
export const EXPLORER_BASE  = NET.explorerBase
export const DISPLAY_NAME   = NET.displayName

export function explorerTx(hash: string)   { return `${NET.explorerBase}/tx/${hash}` }
export function explorerAddr(addr: string)  { return `${NET.explorerBase}/address/${addr}` }
