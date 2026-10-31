/**
 * Live data hooks for Kameti.
 * - useInrRate: USDC/INR price (CoinGecko + jsdelivr fallback, 60s cache)
 * - useArcStrip: block number, gas price, stablecoin TVL on Arc, INR rate
 * - useKametiEvents: WebSocket subscription to Kameti events
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPublicClient, http, webSocket, parseAbiItem } from 'viem'
import { KAMETI_ADDRESS, CHAIN_ID } from '@/lib/contract'
import { requireChain } from '@/onchain-facts'

const chain = requireChain(CHAIN_ID)
// HTTP RPC
const HTTP_RPC = chain.rpcUrls[0]
// WebSocket RPC (same host, swap protocol)
const WS_RPC = HTTP_RPC.replace(/^https:\/\//, 'wss://')

// ── INR rate ─────────────────────────────────────────────────────────────────
let cachedInr = 0
let cacheTs   = 0
const CACHE_TTL = 60_000

async function fetchInrRate(): Promise<number> {
  if (cachedInr && Date.now() - cacheTs < CACHE_TTL) return cachedInr
  // Primary: CoinGecko free API
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=inr',
      { signal: AbortSignal.timeout(4000) }
    )
    const j = await r.json() as { 'usd-coin'?: { inr?: number } }
    const rate = j['usd-coin']?.inr
    if (rate && rate > 0) { cachedInr = rate; cacheTs = Date.now(); return rate }
  } catch { /* fall through */ }
  // Fallback: fawazahmed0 currency API
  try {
    const r2 = await fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usdc.json',
      { signal: AbortSignal.timeout(4000) }
    )
    const j2 = await r2.json() as { usdc?: { inr?: number } }
    const rate = j2.usdc?.inr
    if (rate && rate > 0) { cachedInr = rate; cacheTs = Date.now(); return rate }
  } catch { /* ignore */ }
  return cachedInr // stale value or 0
}

export function useInrRate() {
  const [rate, setRate] = useState(cachedInr)
  useEffect(() => {
    let alive = true
    void fetchInrRate().then(r => { if (alive) setRate(r) })
    const timer = setInterval(() => {
      void fetchInrRate().then(r => { if (alive) setRate(r) })
    }, CACHE_TTL)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  return rate
}

// ── Arc chain strip ───────────────────────────────────────────────────────────
export interface ArcStripData {
  blockNumber: bigint | null
  gasPriceGwei: number | null
  paymentCostUsd: number | null   // estimated 80k gas x gasPrice
  stablecoinTvlM: number | null   // $M on Arc
  inrRate: number
}

// Stablecoin TVL: DefiLlama stablecoinchains
async function fetchArcStablecoinTvl(): Promise<number | null> {
  try {
    const r = await fetch('https://stablecoins.llama.fi/stablecoinchains', {
      signal: AbortSignal.timeout(5000),
    })
    const j = await r.json() as Array<{ name: string; totalCirculatingUSD?: { peggedUSD?: number } }>
    const entry = j.find((c) => c.name?.toLowerCase() === 'arc')
    const usd = entry?.totalCirculatingUSD?.peggedUSD
    return usd != null ? usd / 1_000_000 : null
  } catch { return null }
}

export function useArcStrip() {
  const [data, setData] = useState<ArcStripData>({
    blockNumber: null, gasPriceGwei: null, paymentCostUsd: null,
    stablecoinTvlM: null, inrRate: 0,
  })

  useEffect(() => {
    let alive = true
    const client = createPublicClient({ transport: http(HTTP_RPC) })

    async function refresh() {
      const [blockNumber, gasPrice, inrRate, tvl] = await Promise.allSettled([
        client.getBlockNumber(),
        client.getGasPrice(),
        fetchInrRate(),
        fetchArcStablecoinTvl(),
      ])
      if (!alive) return
      const bn   = blockNumber.status === 'fulfilled' ? blockNumber.value : null
      const gp   = gasPrice.status === 'fulfilled' ? gasPrice.value : null
      const inr  = inrRate.status === 'fulfilled' ? inrRate.value : 0
      const sTvl = tvl.status === 'fulfilled' ? tvl.value : null
      // Arc native USDC: gas price is in 10^-18 USDC (18 dec native)
      // 1 payment ~ 80k gas. cost = gasPrice * 80000 / 1e18 USDC
      const payUsd = gp != null ? Number(gp) * 80_000 / 1e18 : null
      setData({
        blockNumber: bn,
        gasPriceGwei: gp != null ? Number(gp) / 1e9 : null,
        paymentCostUsd: payUsd,
        stablecoinTvlM: sTvl,
        inrRate: inr,
      })
    }

    void refresh()
    const timer = setInterval(() => { void refresh() }, 6000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  return data
}

// ── Kameti event feed ─────────────────────────────────────────────────────────
export interface KametiEvent {
  type: string
  text: string
  tag: string
  href?: string
  ts: number
}

const explorerBase = chain.explorerBase

export function useKametiEvents(maxEvents = 20) {
  const [events, setEvents] = useState<KametiEvent[]>([])
  const wsClientRef = useRef<ReturnType<typeof createPublicClient> | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastBlockRef = useRef<bigint>(0n)

  const push = useCallback((ev: KametiEvent) => {
    setEvents(prev => [ev, ...prev].slice(0, maxEvents))
  }, [maxEvents])

  // Poll fallback: fetch recent Kameti events over HTTP
  const pollEvents = useCallback(async () => {
    try {
      const client = createPublicClient({ transport: http(HTTP_RPC) })
      const head = await client.getBlockNumber()
      const from = head > 2000n ? head - 2000n : 0n
      if (from <= lastBlockRef.current) return
      lastBlockRef.current = head

      const [settled, paid, bid] = await Promise.allSettled([
        client.getLogs({
          address: KAMETI_ADDRESS,
          event: parseAbiItem('event RoundSettled(uint256 indexed id, uint8 round, address winner, uint256 pot, uint256 discount, uint256 dividendPerMember)'),
          fromBlock: from, toBlock: head,
        }),
        client.getLogs({
          address: KAMETI_ADDRESS,
          event: parseAbiItem('event ContributionPaid(uint256 indexed id, uint8 round, address indexed member, uint256 amount, bool autoPay)'),
          fromBlock: from, toBlock: head,
        }),
        client.getLogs({
          address: KAMETI_ADDRESS,
          event: parseAbiItem('event BidPlaced(uint256 indexed id, uint8 round, address indexed bidder, uint256 discount)'),
          fromBlock: from, toBlock: head,
        }),
      ])

      const evs: KametiEvent[] = []
      if (settled.status === 'fulfilled') {
        for (const l of settled.value.slice(-5)) {
          const a = l.args as { winner?: string; pot?: bigint; id?: bigint }
          const addr = a.winner ?? ''
          evs.push({
            type: 'settle', tag: 'SETTLED',
            text: `CIRCLE #${a.id ?? '?'} SETTLED · ${Number(a.pot ?? 0n) / 1e6} USDC TO ${addr.slice(0,6)}…${addr.slice(-4)}`,
            href: l.transactionHash ? `${explorerBase}/tx/${l.transactionHash}` : undefined,
            ts: Date.now(),
          })
        }
      }
      if (paid.status === 'fulfilled') {
        for (const l of paid.value.slice(-5)) {
          const a = l.args as { member?: string; amount?: bigint; id?: bigint; autoPay?: boolean }
          const addr = a.member ?? ''
          evs.push({
            type: 'paid', tag: a.autoPay ? 'AUTOPAY' : 'PAID',
            text: `CIRCLE #${a.id ?? '?'} · ${addr.slice(0,6)}…${addr.slice(-4)} PAID ${Number(a.amount ?? 0n)/1e6} USDC`,
            ts: Date.now(),
          })
        }
      }
      if (bid.status === 'fulfilled') {
        for (const l of bid.value.slice(-5)) {
          const a = l.args as { bidder?: string; discount?: bigint; id?: bigint }
          const addr = a.bidder ?? ''
          evs.push({
            type: 'bid', tag: 'BID',
            text: `CIRCLE #${a.id ?? '?'} · ${addr.slice(0,6)}…${addr.slice(-4)} BID ${Number(a.discount ?? 0n)/1e6} USDC`,
            ts: Date.now(),
          })
        }
      }
      if (evs.length > 0) {
        setEvents(prev => [...evs, ...prev].slice(0, maxEvents))
      }
    } catch { /* ignore */ }
  }, [maxEvents])

  useEffect(() => {
    let wsOk = false

    // Try WebSocket subscription
    try {
      const wsClient = createPublicClient({ transport: webSocket(WS_RPC) })
      wsClientRef.current = wsClient

      // Subscribe to all Kameti events via logs
      try {
        wsClient.watchContractEvent({
          address: KAMETI_ADDRESS,
          abi: [parseAbiItem('event RoundSettled(uint256 indexed id, uint8 round, address winner, uint256 pot, uint256 discount, uint256 dividendPerMember)')],
          eventName: 'RoundSettled',
          onLogs: (logs) => {
            for (const l of logs) {
              const a = l.args as { winner?: string; pot?: bigint; id?: bigint }
              const addr = a.winner ?? ''
              push({ type: 'settle', tag: 'SETTLED',
                text: `CIRCLE #${a.id ?? '?'} SETTLED · ${Number(a.pot ?? 0n)/1e6} USDC TO ${addr.slice(0,6)}…${addr.slice(-4)}`,
                href: l.transactionHash ? `${explorerBase}/tx/${l.transactionHash}` : undefined,
                ts: Date.now() })
            }
          },
        })
        wsOk = true
      } catch {
        // WebSocket failed — fall back to polling
        wsOk = false
      }

      // Give the WS 2s to connect, then fall back to polling
      setTimeout(() => {
        if (!wsOk) {
          pollTimerRef.current = setInterval(() => { pollEvents().catch(() => null) }, 10_000)
          setTimeout(() => { pollEvents().catch(() => null) }, 0)
        }
      }, 2000)
    } catch {
      pollTimerRef.current = setInterval(() => { pollEvents().catch(() => null) }, 10_000)
      setTimeout(() => { pollEvents().catch(() => null) }, 0)
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [pollEvents, push])

  return events
}
