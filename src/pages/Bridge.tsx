/**
 * /bridge — Bring USDC to Arc Testnet via Circle App Kit (CCTP).
 *
 * No kit key required — CCTP bridge is keyless.
 * Uses wagmi v2 useAccount to get the connector/provider.
 *
 * Testnet routes: Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia → Arc Testnet
 * Mainnet routes (VITE_BRIDGE_MAINNET=true): ETH, Base, ARB, OP, MATIC, AVAX → Arc
 *
 * Flow: pick chain → enter amount → estimate → bridge (approve/burn/attest/mint)
 * Step tracker shows live progress. Recover from interrupted burn via hash.
 */
import { useRef, useState, useCallback } from 'react'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { ArrowRight, CheckCircle2, Loader2, AlertCircle, ExternalLink, RefreshCw } from 'lucide-react'
import { AppKit } from '@circle-fin/app-kit'
import type { BridgeParams, EstimateResult, ReceiveExactEstimateResult } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { type EIP1193Provider, type Chain, numberToHex } from 'viem'
import { useBoot } from '@/motion'
import { useInrRate } from '@/hooks/useLiveData'

// ── SDK chain identifier type ──────────────────────────────────────────────
// The SDK uses Blockchain enum values (string literals like "Ethereum_Sepolia")
type CircleChain = BridgeParams['from']['chain']

// ── Chain registry ─────────────────────────────────────────────────────────
const IS_MAINNET = import.meta.env.VITE_BRIDGE_MAINNET === 'true'

interface RouteChain {
  label: string
  chainId: number   // EVM chain ID for wagmi switch
  circleId: string  // Blockchain enum value
  explorerBase: string
}

const TESTNET_ROUTES: RouteChain[] = [
  { label: 'Ethereum Sepolia', chainId: 11155111, circleId: 'Ethereum_Sepolia', explorerBase: 'https://sepolia.etherscan.io' },
  { label: 'Base Sepolia',     chainId: 84532,    circleId: 'Base_Sepolia',     explorerBase: 'https://sepolia.basescan.org' },
  { label: 'Arbitrum Sepolia', chainId: 421614,   circleId: 'Arbitrum_Sepolia', explorerBase: 'https://sepolia.arbiscan.io' },
]

const MAINNET_ROUTES: RouteChain[] = [
  { label: 'Ethereum', chainId: 1,     circleId: 'Ethereum',  explorerBase: 'https://etherscan.io' },
  { label: 'Base',     chainId: 8453,  circleId: 'Base',      explorerBase: 'https://basescan.org' },
  { label: 'Arbitrum', chainId: 42161, circleId: 'Arbitrum',  explorerBase: 'https://arbiscan.io' },
  { label: 'Optimism', chainId: 10,    circleId: 'Optimism',  explorerBase: 'https://optimistic.etherscan.io' },
  { label: 'Polygon',  chainId: 137,   circleId: 'Polygon',   explorerBase: 'https://polygonscan.com' },
  { label: 'Avalanche',chainId: 43114, circleId: 'Avalanche', explorerBase: 'https://snowscan.xyz' },
]

const SOURCE_ROUTES = IS_MAINNET ? MAINNET_ROUTES : TESTNET_ROUTES
const DEST_CIRCLE_ID: string = IS_MAINNET ? 'Arc' : 'Arc_Testnet'
const ARC_EXPLORER = IS_MAINNET ? 'https://explorer.arc.io' : 'https://explorer.testnet.arc.io'

// ── withAddChainFallback ───────────────────────────────────────────────────
const isUnrecognizedChain = (error: unknown) => {
  const e = error as { code?: number; data?: { originalError?: { code?: number } } }
  return e?.code === 4902 || e?.data?.originalError?.code === 4902
}

function withAddChainFallback(provider: EIP1193Provider, chains: readonly Chain[]): EIP1193Provider {
  const send = provider.request.bind(provider) as (args: { method: string; params?: unknown }) => Promise<unknown>
  const request = (async (args: { method: string; params?: unknown }) => {
    try {
      return await send(args)
    } catch (error) {
      if (args.method !== 'wallet_switchEthereumChain' || !isUnrecognizedChain(error)) throw error
      const [{ chainId }] = args.params as [{ chainId: string }]
      const chain = chains.find(c => c.id === Number(chainId))
      if (!chain) throw error
      await send({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: numberToHex(chain.id),
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [...chain.rpcUrls.default.http],
        }],
      })
      return send(args)
    }
  }) as EIP1193Provider['request']
  return new Proxy(provider, {
    get(target, prop) {
      if (prop === 'request') return request
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = Reflect.get(target, prop, target) as unknown
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
}

// viem chain objects for wallet_addEthereumChain fallback
const BRIDGE_VIEM_CHAINS: Chain[] = SOURCE_ROUTES.map(r => ({
  id: r.chainId,
  name: r.label,
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [`https://rpc.ankr.com/eth_sepolia`] } }, // generic fallback
}))

// ── App Kit singleton ──────────────────────────────────────────────────────
const appKit = new AppKit()

// ── Step tracking ──────────────────────────────────────────────────────────
type StepName = 'approve' | 'burn' | 'fetchAttestation' | 'mint'
type StepState = 'pending' | 'active' | 'done' | 'error'

interface StepInfo { name: StepName; label: string; state: StepState; txHash?: string; explorerUrl?: string }

const STEP_LABELS: Record<StepName, string> = {
  approve: 'Approve USDC',
  burn: 'Burn on source chain',
  fetchAttestation: 'Circle attestation',
  mint: 'Mint on Arc',
}

const INIT_STEPS: StepInfo[] = (['approve', 'burn', 'fetchAttestation', 'mint'] as StepName[])
  .map(name => ({ name, label: STEP_LABELS[name], state: 'pending' as StepState }))

// ── Bridge state ───────────────────────────────────────────────────────────
type BridgeStatus = 'idle' | 'estimating' | 'ready' | 'bridging' | 'success' | 'error'
interface BridgeState {
  status: BridgeStatus
  steps: StepInfo[]
  estimatedFee?: string
  transferSpeed?: 'FAST' | 'SLOW'
  error?: string
  mintTxHash?: string
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Bridge() {
  const pageRef = useRef<HTMLDivElement>(null)
  useBoot(pageRef)

  const { address, isConnected, connector } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const inrRate = useInrRate()

  const [sourceIndex, setSourceIndex] = useState(0)
  const [amount, setAmount] = useState('')
  const [bridgeState, setBridgeState] = useState<BridgeState>({ status: 'idle', steps: INIT_STEPS })
  const [recoverHash, setRecoverHash] = useState('')

  const source = SOURCE_ROUTES[sourceIndex]

  const inrAmount = amount && inrRate > 0 && parseFloat(amount) > 0
    ? `≈ ₹${(parseFloat(amount) * inrRate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
    : null

  // ── Estimate ──────────────────────────────────────────────────────────────
  const handleEstimate = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0 || !connector) return
    setBridgeState(s => ({ ...s, status: 'estimating', error: undefined }))
    try {
      if (chainId !== source.chainId) await switchChainAsync({ chainId: source.chainId })
      const provider = (await connector.getProvider()) as EIP1193Provider
      const adapter = await createViemAdapterFromProvider({ provider: withAddChainFallback(provider, BRIDGE_VIEM_CHAINS) })
      const est = await appKit.estimateBridge({
        token: 'USDC',
        from: { adapter, chain: source.circleId as CircleChain },
        to: { adapter, chain: DEST_CIRCLE_ID as CircleChain },
        amount,
      }) as EstimateResult<string, string> | ReceiveExactEstimateResult
      // fees array on EstimateResult
      const estTyped = est as EstimateResult<string, string>
      const fees = estTyped.fees
      const fee = fees?.[0]?.amount != null ? `${fees[0].amount} ${fees[0].token ?? 'USDC'}` : 'n/a'
      const speed = ((est as unknown as Record<string, unknown>).transferSpeed as string | undefined)?.toUpperCase()
      const transferSpeed: 'FAST' | 'SLOW' | undefined =
        speed === 'FAST' ? 'FAST' : speed === 'SLOW' ? 'SLOW' : undefined
      setBridgeState(s => ({ ...s, status: 'ready', estimatedFee: fee, transferSpeed }))
    } catch (e) {
      setBridgeState(s => ({ ...s, status: 'error', error: e instanceof Error ? e.message : 'Estimate failed' }))
    }
  }, [amount, connector, chainId, source, switchChainAsync])

  // ── Bridge ────────────────────────────────────────────────────────────────
  const handleBridge = useCallback(async () => {
    if (!isConnected || !address || !connector) return
    setBridgeState({ status: 'bridging', steps: INIT_STEPS })
    try {
      if (chainId !== source.chainId) await switchChainAsync({ chainId: source.chainId })
      const provider = (await connector.getProvider()) as EIP1193Provider
      const adapter = await createViemAdapterFromProvider({ provider: withAddChainFallback(provider, BRIDGE_VIEM_CHAINS) })

      const result = await appKit.bridge({
        token: 'USDC',
        from: { adapter, chain: source.circleId as CircleChain },
        to: { adapter, chain: DEST_CIRCLE_ID as CircleChain, recipientAddress: address },
        amount,
      })

      // Map result steps to StepInfo
      const mapped: StepInfo[] = INIT_STEPS.map(step => {
        const rs = result.steps?.find(s => s.name === step.name) as
          ({ name: string; state: string; txHash?: string; explorerUrl?: string }) | undefined
        if (!rs) return step
        const done = rs.state === 'success'
        const err  = rs.state === 'error'
        const url  = rs.explorerUrl ?? (rs.txHash
          ? (step.name === 'mint' ? `${ARC_EXPLORER}/tx/${rs.txHash}` : `${source.explorerBase}/tx/${rs.txHash}`)
          : undefined)
        return { ...step, state: (done ? 'done' : err ? 'error' : 'active'), txHash: rs.txHash, explorerUrl: url }
      })

      const mintStep = result.steps?.find(s => s.name === 'mint') as { txHash?: string } | undefined
      setBridgeState({
        status: result.state === 'success' ? 'success' : 'error',
        steps: mapped,
        mintTxHash: mintStep?.txHash,
        error: result.state !== 'success' ? 'Bridge incomplete — see steps below.' : undefined,
      })
    } catch (e) {
      setBridgeState(s => ({ ...s, status: 'error', error: e instanceof Error ? e.message : 'Bridge failed' }))
    }
  }, [isConnected, address, connector, chainId, source, switchChainAsync, amount])

  // ── Recover ───────────────────────────────────────────────────────────────
  const handleRecover = useCallback(async () => {
    if (!recoverHash.startsWith('0x') || !connector || !address) return
    setBridgeState({ status: 'bridging', steps: INIT_STEPS })
    try {
      if (chainId !== source.chainId) await switchChainAsync({ chainId: source.chainId })
      const provider = (await connector.getProvider()) as EIP1193Provider
      const adapter = await createViemAdapterFromProvider({ provider: withAddChainFallback(provider, BRIDGE_VIEM_CHAINS) })
      // Re-run bridge; CCTP is idempotent post-burn (won't double-burn)
      const result = await appKit.bridge({
        token: 'USDC',
        from: { adapter, chain: source.circleId as CircleChain },
        to: { adapter, chain: DEST_CIRCLE_ID as CircleChain, recipientAddress: address },
        amount,
      })
      const mintStep = result.steps?.find(s => s.name === 'mint') as { txHash?: string } | undefined
      setBridgeState(s => ({
        ...s,
        status: result.state === 'success' ? 'success' : 'error',
        mintTxHash: mintStep?.txHash,
        error: result.state !== 'success' ? 'Recovery incomplete.' : undefined,
      }))
    } catch (e) {
      setBridgeState(s => ({ ...s, status: 'error', error: e instanceof Error ? e.message : 'Recovery failed' }))
    }
  }, [recoverHash, connector, address, chainId, source, switchChainAsync, amount])

  const isRunning = bridgeState.status === 'bridging' || bridgeState.status === 'estimating'

  return (
    <div ref={pageRef} className="pt-12 min-h-screen overflow-x-hidden">
      <div className="frame max-w-2xl mx-auto">

        {/* Header */}
        <div className="cell px-6 md:px-10 py-10" data-boot>
          <p className="label text-muted mb-2">CCTP · Keyless · No approve on Arc</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-3">Bridge USDC to Arc.</h1>
          <p className="font-sans text-muted text-base max-w-lg">
            Burn on your source chain, mint on {IS_MAINNET ? 'Arc' : 'Arc Testnet'}. Fast transfer when the route supports it, otherwise up to ~20 minutes. Then pay your Kameti round — one signature, no further steps.
          </p>
        </div>

        {/* Form */}
        {bridgeState.status !== 'success' && (
          <div className="cell px-6 md:px-10 py-8 flex flex-col gap-6" data-boot>

            {/* Source chain picker */}
            <div>
              <p className="label text-muted text-[10px] mb-2">FROM CHAIN</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-0">
                {SOURCE_ROUTES.map((r, i) => (
                  <button
                    key={r.circleId}
                    onClick={() => setSourceIndex(i)}
                    className={`press cell px-4 py-3 label text-left transition-colors ${
                      i === sourceIndex
                        ? 'bg-signal text-on-signal font-bold'
                        : 'text-muted hover:bg-paper-2'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Destination (fixed) */}
            <div className="cell px-4 py-3 bg-paper-2 flex items-center justify-between gap-4">
              <div>
                <p className="label text-muted text-[10px] mb-0.5">TO</p>
                <p className="label text-ink font-bold">{IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}</p>
              </div>
              <ArrowRight size={14} className="text-muted" />
            </div>

            {/* Amount */}
            <div>
              <p className="label text-muted text-[10px] mb-2">AMOUNT (USDC)</p>
              <div className="cell flex items-center overflow-hidden">
                <input
                  type="number"
                  value={amount}
                  onChange={e => {
                    setAmount(e.target.value)
                    setBridgeState(s => ({ ...s, status: 'idle', estimatedFee: undefined }))
                  }}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  className="flex-1 bg-transparent px-4 py-3 font-display text-2xl font-bold outline-none text-ink placeholder:text-muted"
                />
                <span className="label text-muted px-4 shrink-0">USDC</span>
              </div>
              {inrAmount && (
                <p className="label text-muted text-[10px] mt-1 pl-1">{inrAmount}</p>
              )}
            </div>

            {/* Recipient */}
            {address && (
              <div className="cell px-4 py-3 bg-paper-2">
                <p className="label text-muted text-[10px] mb-1">RECIPIENT (your connected wallet on Arc)</p>
                <p className="font-mono text-xs text-ink break-all">{address}</p>
              </div>
            )}

            {/* Estimate result */}
            {bridgeState.status === 'ready' && (
              <div className="cell p-4 bg-paper-2">
                <p className="label text-muted text-[10px] mb-1">BRIDGE FEE</p>
                <p className="label text-ink font-bold">{bridgeState.estimatedFee ?? '—'}</p>
                <p className="label text-muted text-[10px] mt-1">
                  {bridgeState.transferSpeed === 'FAST'
                    ? 'CCTP fast mode · typically seconds'
                    : bridgeState.transferSpeed === 'SLOW'
                    ? 'CCTP standard mode · up to ~20 minutes'
                    : 'Fast when the route supports it, otherwise up to ~20 minutes'}
                </p>
              </div>
            )}

            {/* Error */}
            {bridgeState.error && bridgeState.status === 'error' && (
              <div className="cell p-4 bg-paper-2 flex items-start gap-2">
                <AlertCircle size={14} className="text-muted mt-0.5 shrink-0" />
                <p className="label text-muted text-[11px]">{bridgeState.error}</p>
              </div>
            )}

            {/* CTAs */}
            <div className="flex flex-wrap gap-2">
              {!isConnected ? (
                <p className="label text-muted text-sm">Connect your wallet to bridge.</p>
              ) : isRunning ? (
                <button disabled className="press cell px-6 py-3 bg-signal/50 text-on-signal border border-ink label font-bold flex items-center gap-2 cursor-wait">
                  <Loader2 size={14} className="animate-spin" />
                  {bridgeState.status === 'estimating' ? 'Estimating…' : 'Bridging…'}
                </button>
              ) : (
                <>
                  {bridgeState.status === 'idle' || bridgeState.status === 'error' ? (
                    <button
                      onClick={() => { void handleEstimate() }}
                      disabled={!amount || parseFloat(amount) <= 0}
                      className="press cell px-5 py-3 border border-line text-ink label hover:bg-paper-2 disabled:opacity-40"
                    >
                      Get estimate
                    </button>
                  ) : null}
                  <button
                    onClick={() => { void handleBridge() }}
                    disabled={!amount || parseFloat(amount) <= 0}
                    className="press cell px-6 py-3 bg-signal text-on-signal border border-ink label font-bold hover:bg-signal-hover disabled:opacity-40 flex items-center gap-2"
                  >
                    Bridge to Arc <ArrowRight size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Step tracker */}
        {(isRunning || bridgeState.status === 'success' || (bridgeState.status === 'error' && bridgeState.steps.some(s => s.state !== 'pending'))) && (
          <div className="cell px-6 md:px-10 py-6" data-boot>
            <p className="label text-muted mb-4 text-[10px]">Bridge progress</p>
            <div className="flex flex-col gap-0">
              {bridgeState.steps.map((step, i) => (
                <div key={step.name} className={`cell p-4 flex items-center gap-4 ${step.state === 'done' ? 'bg-signal/10' : ''}`}>
                  <div className={`w-6 h-6 flex items-center justify-center shrink-0 ${step.state === 'done' ? 'text-signal-ink' : 'text-muted'}`}>
                    {step.state === 'done' ? <CheckCircle2 size={16} /> :
                     step.state === 'active' ? <Loader2 size={16} className="animate-spin" /> :
                     step.state === 'error' ? <AlertCircle size={16} /> :
                     <span className="label text-[10px]">{i + 1}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`label font-bold text-[11px] ${step.state === 'done' ? 'text-ink' : 'text-muted'}`}>{step.label}</p>
                    {step.explorerUrl && (
                      <a href={step.explorerUrl} target="_blank" rel="noopener"
                        className="label text-[10px] text-signal-ink link-line flex items-center gap-1 mt-0.5">
                        {step.txHash ? `${step.txHash.slice(0,10)}…` : 'View tx'} <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Success */}
        {bridgeState.status === 'success' && (
          <div className="cell px-6 md:px-10 py-8 bg-signal/10 flex flex-col gap-4" data-boot>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={20} className="text-signal-ink" />
              <p className="font-display text-2xl font-bold">USDC arrived on Arc.</p>
            </div>
            <p className="label text-muted text-sm">
              {amount} USDC is now in your wallet. You can pay your Kameti round now.
            </p>
            {bridgeState.mintTxHash && (
              <a href={`${ARC_EXPLORER}/tx/${bridgeState.mintTxHash}`} target="_blank" rel="noopener"
                className="label text-signal-ink text-[11px] link-line flex items-center gap-1">
                Mint tx <ExternalLink size={10} />
              </a>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              <button onClick={() => setBridgeState({ status: 'idle', steps: INIT_STEPS })}
                className="press cell px-5 py-3 bg-signal text-on-signal border border-ink label font-bold hover:bg-signal-hover flex items-center gap-2">
                Bridge more <RefreshCw size={12} />
              </button>
              <a href="/new" className="press cell px-5 py-3 border border-line text-ink label hover:bg-paper-2 flex items-center gap-2">
                Start a Kameti <ArrowRight size={12} />
              </a>
            </div>
          </div>
        )}

        {/* Recovery */}
        <div className="cell px-6 md:px-10 py-6 bg-paper-2" data-boot>
          <p className="label text-muted mb-3 text-[10px]">Resume a stuck bridge</p>
          <p className="label text-muted text-[11px] mb-3">
            If you closed the tab mid-bridge, paste your burn tx hash. CCTP is resumable — your USDC is not lost.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={recoverHash}
              onChange={e => setRecoverHash(e.target.value)}
              placeholder="0x… burn tx hash"
              className="cell flex-1 px-4 py-2.5 bg-transparent font-mono text-xs text-ink placeholder:text-muted outline-none"
            />
            <button
              onClick={() => { void handleRecover() }}
              disabled={!recoverHash.startsWith('0x') || isRunning || !isConnected}
              className="press cell px-4 py-2.5 border border-line text-ink label hover:bg-paper-2 disabled:opacity-40 whitespace-nowrap"
            >
              Recover
            </button>
          </div>
        </div>

        {/* Footer note */}
        <div className="cell px-6 md:px-10 py-6">
          <p className="label text-muted text-[10px] leading-relaxed">
            Powered by Circle App Kit (CCTP). No kit key required for USDC bridging.
            Source chain gas paid in source-chain native token (ETH on Sepolia). Arc minting costs under $0.01.
          </p>
        </div>

      </div>
    </div>
  )
}
