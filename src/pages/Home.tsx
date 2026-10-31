import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Lock, Zap, Eye, Check, X, AlertTriangle } from 'lucide-react'
import NumberFlow from '@number-flow/react'
import { useBoot, useScrollMotion, useMarquee } from '@/motion'
import DotGrid from '@/components/DotGrid'
import { useReadContract } from 'wagmi'
import { KAMETI_ADDRESS, KAMETI_ABI, CHAIN_ID, formatUsdc, explorerAddr } from '@/lib/contract'
import { useArcStrip, useKametiEvents, useInrRate } from '@/hooks/useLiveData'
import type { KametiEvent } from '@/hooks/useLiveData'
import { DEMO_CIRCLE_ID } from '@/config/demo'

// ─── Headline ────────────────────────────────────────────────────────────────
function ShuffleHeadline({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <span className="inline">
      {words.map((word, wi) => (
        <span key={wi} className="inline-block">
          {word.split('').map((ch, ci) => (
            <span key={ci} style={{ display: 'inline-block' }}>{ch}</span>
          ))}
          {wi < words.length - 1 && (
            <span style={{ display: 'inline-block', width: '0.35em' }}>&nbsp;</span>
          )}
        </span>
      ))}
    </span>
  )
}

// ─── Live Arc strip ───────────────────────────────────────────────────────────
function ArcStrip() {
  const strip = useArcStrip()
  return (
    <section className="frame border-t border-line">
      <div className="cell px-6 py-3 flex items-center gap-6 overflow-x-auto scrollbar-none">
        <span className="label text-[9px] text-signal-ink shrink-0 tracking-widest">LIVE FROM ARC</span>
        <div className="flex items-center gap-1 shrink-0">
          <span className="stat-dot" style={{ '--i': 0 } as React.CSSProperties} />
          <span className="label text-[10px] text-muted">
            {strip.blockNumber != null ? `#${strip.blockNumber.toLocaleString()}` : 'connecting…'}
          </span>
        </div>
        {strip.paymentCostUsd != null && (
          <span className="label text-[10px] text-muted shrink-0">
            1 payment ≈ <span className="text-ink font-bold">${strip.paymentCostUsd < 0.001 ? strip.paymentCostUsd.toFixed(5) : strip.paymentCostUsd.toFixed(4)}</span>
          </span>
        )}
        {strip.stablecoinTvlM != null && (
          <span className="label text-[10px] text-muted shrink-0">
            <span className="text-ink font-bold">${strip.stablecoinTvlM.toFixed(1)}M</span> stablecoins on Arc
          </span>
        )}
        {strip.inrRate > 0 && (
          <span className="label text-[10px] text-muted shrink-0">
            1 USDC = <span className="text-ink font-bold">₹{strip.inrRate.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
          </span>
        )}
      </div>
    </section>
  )
}

// ─── Stats strip ─────────────────────────────────────────────────────────────
function Stat({ label, value, unit, inr, i }: { label: string; value: number; unit?: string; inr?: number | null; i: number }) {
  return (
    <div className="stat cell p-6 relative overflow-hidden" style={{ '--i': i } as React.CSSProperties}>
      <div className="flex items-center gap-2 mb-3">
        <div className="stat-dot" style={{ '--i': i } as React.CSSProperties} />
        <span className="label text-muted">{label}</span>
      </div>
      <div className="stat-num font-display text-3xl font-bold">
        <NumberFlow value={value} format={{ minimumFractionDigits: unit === 'USDC' ? 2 : 0, maximumFractionDigits: unit === 'USDC' ? 2 : 0 }} />
        {unit && <span className="text-muted text-base ml-1">{unit}</span>}
      </div>
      {inr != null && inr > 0 && (
        <p className="label text-muted text-[9px] mt-0.5">≈ ₹{(value * inr).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
      )}
      <div className="stat-bar" style={{ '--i': i } as React.CSSProperties} />
    </div>
  )
}

// ─── Marquee ──────────────────────────────────────────────────────────────────
const FALLBACK_ITEMS: KametiEvent[] = [
  { type: 'info', text: 'USDC IS GAS ON ARC', tag: 'ARC', ts: 0 },
  { type: 'info', text: 'PAY YOUR ROUND', tag: 'ROSCA', ts: 0 },
  { type: 'info', text: 'BID FOR THE POT', tag: 'AUCTION', ts: 0 },
  { type: 'info', text: 'EARN DIVIDENDS WHILE YOU WAIT', tag: 'YIELD', ts: 0 },
  { type: 'info', text: 'PRE-SIGN PAYMENTS — NO GAS EACH ROUND', tag: 'EIP-3009', ts: 0 },
  { type: 'info', text: `CONTRACT ${KAMETI_ADDRESS.slice(0, 6)}…${KAMETI_ADDRESS.slice(-4)}`, tag: 'ONCHAIN',
    href: explorerAddr(KAMETI_ADDRESS), ts: 0 },
  { type: 'info', text: 'SLH-DSA POST-QUANTUM WITHDRAWAL GUARD', tag: 'PQ', ts: 0 },
  { type: 'info', text: 'NO MIDDLEMEN · TRUSTLESS', tag: 'KAMETI', ts: 0 },
]

function MarqueeTicker({ events }: { events: KametiEvent[] }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const items = events.length > 0 ? events : FALLBACK_ITEMS
  useMarquee(trackRef)
  return (
    <div className="cell overflow-hidden select-none border-t border-line py-3">
      <div ref={trackRef} className="flex whitespace-nowrap gap-0">
        {[...items, ...items].map((ev, i) => (
          <span key={i} className="label inline-flex items-center gap-3 px-6 text-muted">
            <span className="text-signal-ink">◆</span>
            {ev.href
              ? <a href={ev.href} target="_blank" rel="noopener" className="hover:text-ink transition-colors">{ev.text}</a>
              : <span>{ev.text}</span>
            }
            <span className="px-2 py-0.5 bg-signal text-on-signal label">{ev.tag}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Four cheats section ──────────────────────────────────────────────────────
const CHEATS = [
  {
    icon: Lock,
    cheat: 'The organiser runs with the pot',
    rule:  'No organiser, no admin key',
    detail: 'Kameti has no owner. The contract is immutable. Nobody can move the pot except the protocol.',
  },
  {
    icon: Zap,
    cheat: 'An early winner stops paying',
    rule:  'Post-win lock: 50% of deposit stays locked',
    detail: 'After winning, half your deposit remains locked. Miss a future round and it is slashed. You keep paying.',
  },
  {
    icon: AlertTriangle,
    cheat: 'Members forget or skip rounds',
    rule:  'Pre-signed EIP-3009 AutoPay + deposit',
    detail: 'Sign once. Anyone can execute your payment each round from your pre-signed authorizations — no gas from you.',
  },
  {
    icon: Eye,
    cheat: "Nobody agrees on the hisaab",
    rule:  'Every rupee on a public ledger',
    detail: 'All contributions, payouts, bids, and dividends are emitted as events and verifiable onchain. No spreadsheet.',
  },
]

// ─── Why Arc comparison ───────────────────────────────────────────────────────
interface CompRow { aspect: string; other: string; arc: string }
const COMP_ROWS: CompRow[] = [
  { aspect: 'Gas token',         other: 'ETH — members need two assets',        arc: 'USDC — one asset, zero setup' },
  { aspect: 'Round payment',     other: 'ERC-20 approve + keeper executes',      arc: 'EIP-3009 ReceiveWithAuthorization on native USDC' },
  { aspect: 'Finality',          other: 'Minutes',                               arc: 'Under 1 second' },
  { aspect: 'Post-quantum check', other: 'Not available',                        arc: 'SLH-DSA precompile 0x1800…0004 (FIPS 205)' },
  { aspect: 'Cost per payment',  other: '~$0.05–0.50 USD in ETH gas',            arc: 'Live from strip above' },
  { aspect: 'Bring USDC from another chain', other: 'Bridge + swap per chain',  arc: 'CCTP burn-and-mint straight to Arc, then pay with one signature' },
]

// ─── Steps ────────────────────────────────────────────────────────────────────
const STEPS = [
  { n: '01', title: 'Lock a Deposit', body: 'Each member locks 1–3× their contribution as a security deposit. Your deposit backs your commitment.' },
  { n: '02', title: 'Pay Each Round', body: 'Pre-sign payments once. AutoPay handles it automatically — no gas each round, no forgotten deadlines.' },
  { n: '03', title: 'Bid for the Pot', body: 'An ascending auction opens every round. Bid a discount on the pot — the highest bidder wins early access.' },
  { n: '04', title: 'Earn Dividends', body: 'Discounts and recovered deposits are split equally among all other members. Everyone earns while they wait.' },
]

// ─── Limitations ─────────────────────────────────────────────────────────────
const LIMITS = [
  'No independent security audit yet.',
  'Open bids (not sealed) — bid order is visible on chain.',
  'Deposits do not earn yield while locked.',
  'No INR on-ramp — members need USDC on Arc.',
  'PQ withdrawal guard is experimental on Arc (live on testnet and mainnet).',
]

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const pageRef = useRef<HTMLDivElement>(null)
  useBoot(pageRef)
  useScrollMotion(pageRef)

  const inrRate = useInrRate()
  const liveEvents = useKametiEvents(20)

  const { data: totalCirclesRaw }    = useReadContract({ address: KAMETI_ADDRESS, abi: KAMETI_ABI, functionName: 'totalCircles', chainId: CHAIN_ID })
  const { data: totalContributedRaw } = useReadContract({ address: KAMETI_ADDRESS, abi: KAMETI_ABI, functionName: 'totalContributed', chainId: CHAIN_ID })
  const { data: totalPayoutsRaw }    = useReadContract({ address: KAMETI_ADDRESS, abi: KAMETI_ABI, functionName: 'totalPayouts', chainId: CHAIN_ID })
  const { data: totalDividendsRaw }  = useReadContract({ address: KAMETI_ADDRESS, abi: KAMETI_ABI, functionName: 'totalDividendsPaid', chainId: CHAIN_ID })

  const totalCircles   = Number(totalCirclesRaw ?? 0n)
  const totalSaved     = Number(totalContributedRaw ?? 0n) / 1e6
  const totalPayouts   = Number(totalPayoutsRaw ?? 0n)
  const totalDividends = Number(totalDividendsRaw ?? 0n) / 1e6

  return (
    <div ref={pageRef} className="pt-12 overflow-x-hidden">

      {/* Hero */}
      <section className="frame relative min-h-[80vh] flex flex-col">
        <div data-boot className="cell relative flex-1 flex flex-col items-start justify-center px-6 md:px-14 py-20 overflow-hidden">
          <DotGrid />
          <div className="relative z-10 max-w-3xl">
            <p className="label text-muted mb-4">Real Chit Fund · Arc Testnet · USDC only</p>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold leading-none tracking-tight mb-6">
              <ShuffleHeadline text="A KAMETI" />
              <br />
              {/* Mint is too light for text on paper; render as ink-on-mint block */}
              <span className="inline bg-signal text-on-signal px-2 -mx-1">
                <ShuffleHeadline text="NOBODY CAN" />
              </span>
              <br />
              <ShuffleHeadline text="RUN AWAY WITH." />
            </h1>
            <p className="font-sans text-lg text-muted max-w-2xl mb-3">
              Save together in USDC. Bid for the pot when you need it. Earn dividends while you wait.
            </p>
            <p className="font-sans text-base text-muted max-w-2xl mb-10">
              Enforced by Arc, not an organiser. No admin key. No spreadsheet. No trust.
            </p>
            <div className="flex flex-wrap gap-0">
              <Link to="/new"
                className="press cell px-8 py-4 bg-signal text-on-signal border border-ink label font-bold hover:bg-signal-hover flex items-center gap-2">
                Start a Kameti
                <ArrowRight size={14} />
              </Link>
              <Link to="/break"
                className="press cell px-8 py-4 border border-ink text-ink label hover:bg-paper-2 flex items-center gap-2">
                Try to break it
                <ArrowRight size={14} />
              </Link>
              {DEMO_CIRCLE_ID > 0n && (
                <Link to={`/k/${DEMO_CIRCLE_ID}`}
                  className="press cell px-8 py-4 border border-ink text-ink label hover:bg-paper-2 flex items-center gap-2">
                  View demo circle
                  <ArrowRight size={14} />
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Live Arc strip */}
      <ArcStrip />

      {/* Stats */}
      <section className="frame grid grid-cols-2 md:grid-cols-4">
        <Stat label="USDC Saved"      value={totalSaved}     unit="USDC" inr={inrRate} i={0} />
        <Stat label="Dividends Paid"  value={totalDividends} unit="USDC" inr={inrRate} i={1} />
        <Stat label="Circles Created" value={totalCircles}              i={2} />
        <Stat label="Payouts Sent"    value={totalPayouts}              i={3} />
      </section>

      {/* Marquee with live events */}
      <MarqueeTicker events={liveEvents} />

      {/* Four cheats */}
      <section className="frame" data-reveal>
        <div className="cell px-6 md:px-14 py-12">
          <p className="label text-muted mb-2">Trust model</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold mb-0">Four ways a kameti gets cheated.</h2>
          <p className="font-sans text-muted mt-3">And the onchain rule that stops each one.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {CHEATS.map((c) => (
            <div key={c.cheat} className="cell p-8 flex flex-col gap-4" data-reveal>
              <div className="w-10 h-10 bg-signal flex items-center justify-center shrink-0">
                <c.icon size={20} className="text-on-signal" />
              </div>
              <div>
                <p className="label text-muted mb-1 line-through text-[11px]">{c.cheat}</p>
                <h3 className="font-display text-base font-bold text-ink">{c.rule}</h3>
              </div>
              <p className="text-muted text-sm leading-relaxed">{c.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why Arc comparison */}
      <section className="frame" data-reveal>
        <div className="cell px-6 md:px-14 py-12">
          <p className="label text-muted mb-2">Why only on Arc</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold mb-0">Any other EVM vs Arc.</h2>
        </div>
        <div className="cell overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-line">
                <th className="label text-muted text-left px-6 py-3 font-normal w-1/3">Aspect</th>
                <th className="label text-muted text-left px-6 py-3 font-normal">
                  <span className="flex items-center gap-1"><X size={12} className="text-muted" /> Any other EVM</span>
                </th>
                <th className="label text-left px-6 py-3 font-normal text-signal-ink">
                  <span className="flex items-center gap-1"><Check size={12} /> Arc</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {COMP_ROWS.map((row, i) => (
                <tr key={i} className="border-b border-line hover:bg-paper-2">
                  <td className="label px-6 py-4 text-muted">{row.aspect}</td>
                  <td className="label px-6 py-4 text-muted">{row.other}</td>
                  <td className="label px-6 py-4 text-signal-ink font-bold">{row.arc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="frame" data-reveal>
        <div className="cell px-6 md:px-14 py-12">
          <p className="label text-muted mb-2">Protocol</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold mb-0">How it works</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="step cell p-8 cursor-default" data-reveal>
              <div className="step-num font-display text-5xl font-bold text-ink mb-6">{s.n}</div>
              <div className="step-copy">
                <h3 className="font-display text-xl font-bold mb-2">{s.title}</h3>
                <p className="text-muted text-sm leading-relaxed">{s.body}</p>
              </div>
              <div className="step-arrow absolute bottom-6 right-6 text-signal-ink">
                <ArrowRight size={20} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* What it doesn't do yet */}
      <section className="frame" data-reveal>
        <div className="cell px-6 md:px-14 py-12">
          <p className="label text-muted mb-2">Honest limits</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-6">What it does not do yet.</h2>
          <ul className="space-y-3">
            {LIMITS.map((l, i) => (
              <li key={i} className="flex items-start gap-3">
                <AlertTriangle size={14} className="shrink-0 mt-0.5 text-muted" />
                <span className="label text-muted">{l}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="frame" data-reveal>
        <div className="cell grid grid-cols-1 md:grid-cols-2 items-center">
          <div className="p-10 md:p-14">
            <p className="label text-muted mb-3">Ready?</p>
            <h2 className="font-display text-4xl font-bold mb-6">Start your first Kameti today.</h2>
            <Link to="/new"
              className="press cell px-8 py-4 bg-signal text-on-signal border border-ink label font-bold hover:bg-signal-hover inline-flex items-center gap-2">
              Create a Circle
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="cell h-full min-h-48 bg-paper-2 p-10 md:p-14 flex flex-col justify-end" data-reveal>
            <p className="font-display text-2xl font-bold">
              {totalCircles} circles,<br />{formatUsdc(BigInt(Math.round(totalSaved * 1e6)))} USDC flowing.
            </p>
            {inrRate > 0 && totalSaved > 0 && (
              <p className="label text-muted mt-1">≈ ₹{(totalSaved * inrRate).toLocaleString('en-IN', { maximumFractionDigits: 0 })} in circulation</p>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="frame">
        <div className="cell px-6 md:px-14 py-10 grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
          <div>
            <p className="font-display text-5xl font-bold tracking-tight">KAMETI</p>
            <p className="label text-muted mt-2">Onchain Chit Fund · Arc Testnet</p>
          </div>
          <div className="flex flex-col gap-2">
            <a href={explorerAddr(KAMETI_ADDRESS)} target="_blank" rel="noopener"
              className="link-line label text-muted">Arc Explorer</a>
            <a href="https://github.com/anshxft/kameti" target="_blank" rel="noopener"
              className="link-line label text-muted">GitHub</a>
            <Link to="/reviewers" className="link-line label text-muted">For Reviewers</Link>
            <Link to="/score" className="link-line label text-muted">Kameti Score</Link>
          </div>
          <p className="label text-muted md:text-right">Built on Arc · USDC is gas · Testnet</p>
        </div>
      </footer>

    </div>
  )
}
