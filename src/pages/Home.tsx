import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck, Award, Zap } from 'lucide-react'
import NumberFlow from '@number-flow/react'
import { useBoot, useScrollMotion, useMarquee } from '@/motion'
import DotGrid from '@/components/DotGrid'
import { useReadContract } from 'wagmi'
import { KAMETI_ADDRESS, KAMETI_ABI, CHAIN_ID, formatUsdc } from '@/lib/contract'

// ─── Headline letter-shuffle ──────────────────────────────────────────────────
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

// ─── Stats ────────────────────────────────────────────────────────────────────
function Stat({ label, value, unit, i }: { label: string; value: number; unit?: string; i: number }) {
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
      <div className="stat-bar" style={{ '--i': i } as React.CSSProperties} />
    </div>
  )
}

// ─── Marquee ──────────────────────────────────────────────────────────────────
interface TickerEvent { text: string; tag: string; href?: string }

const FALLBACK_ITEMS: TickerEvent[] = [
  { text: 'USDC IS GAS ON ARC', tag: 'ARC' },
  { text: 'PAY YOUR ROUND', tag: 'ROSCA' },
  { text: 'BID FOR THE POT', tag: 'AUCTION' },
  { text: 'EARN DIVIDENDS WHILE YOU WAIT', tag: 'YIELD' },
  { text: 'DEPOSIT PROTECTS THE CIRCLE', tag: 'SECURITY' },
  { text: `CONTRACT ${KAMETI_ADDRESS.slice(0, 6)}…${KAMETI_ADDRESS.slice(-4)}`, tag: 'ONCHAIN',
    href: `https://explorer.testnet.arc.io/address/${KAMETI_ADDRESS}` },
  { text: 'KAMETI SCORE 300–900', tag: 'CREDIT' },
  { text: 'NO MIDDLEMEN · TRUSTLESS', tag: 'KAMETI' },
]

function MarqueeTicker({ events }: { events: TickerEvent[] }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const items: TickerEvent[] = events.length > 0 ? events : FALLBACK_ITEMS
  useMarquee(trackRef)

  return (
    <div className="cell overflow-hidden select-none border-t border-line py-3">
      <div ref={trackRef} className="flex whitespace-nowrap gap-0">
        {[...items, ...items].map((ev, i) => (
          <span key={i} className="label inline-flex items-center gap-3 px-6 text-muted">
            <span className="text-signal">◆</span>
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

// ─── Steps ────────────────────────────────────────────────────────────────────
const STEPS = [
  { n: '01', title: 'Lock a Deposit', body: 'Each member locks 1–3× their contribution as a security deposit. Your deposit backs your commitment.' },
  { n: '02', title: 'Pay Each Round', body: 'Everyone contributes each round before the deadline. AutoPay handles it automatically if you enable it.' },
  { n: '03', title: 'Bid for the Pot', body: 'An ascending auction opens every round. Bid a discount on the pot — the highest bidder wins early access.' },
  { n: '04', title: 'Earn Dividends', body: 'Discounts and recovered deposits are split equally among all other members. Everyone earns while they wait.' },
]

// ─── Why Kameti ───────────────────────────────────────────────────────────────
const WHY = [
  {
    icon: ShieldCheck,
    title: 'DEPOSIT PROTECTION',
    body: 'Missed payments are covered from the defaulter\'s locked deposit. The pot stays full even if someone doesn\'t pay.',
  },
  {
    icon: Award,
    title: 'KAMETI SCORE',
    body: 'A 300–900 on-chain credit score tracks your payment history across all circles. Higher score = access to better circles.',
  },
  {
    icon: Zap,
    title: 'AUTOPAY',
    body: 'Approve once, pay every round automatically. Anyone can trigger AutoPay for the whole circle with one transaction.',
  },
]

// Demo circle id injected at build time via VITE_DEMO_CIRCLE_ID env var
const DEMO_CIRCLE_ID = import.meta.env.VITE_DEMO_CIRCLE_ID as string | undefined

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const pageRef = useRef<HTMLDivElement>(null)
  useBoot(pageRef)
  useScrollMotion(pageRef)

  const { data: totalCirclesRaw } = useReadContract({
    address: KAMETI_ADDRESS, abi: KAMETI_ABI,
    functionName: 'totalCircles', chainId: CHAIN_ID,
  })
  const { data: totalContributedRaw } = useReadContract({
    address: KAMETI_ADDRESS, abi: KAMETI_ABI,
    functionName: 'totalContributed', chainId: CHAIN_ID,
  })
  const { data: totalPayoutsRaw } = useReadContract({
    address: KAMETI_ADDRESS, abi: KAMETI_ABI,
    functionName: 'totalPayouts', chainId: CHAIN_ID,
  })
  const { data: totalDividendsRaw } = useReadContract({
    address: KAMETI_ADDRESS, abi: KAMETI_ABI,
    functionName: 'totalDividendsPaid', chainId: CHAIN_ID,
  })

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
            <p className="label text-muted mb-4">Real Chit Fund · Arc Testnet · USDC</p>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold leading-none tracking-tight mb-6">
              <ShuffleHeadline text="SAVE TOGETHER." />
              <br />
              <ShuffleHeadline text="GET PAID IN TURN." />
            </h1>
            <p className="font-sans text-lg text-muted max-w-xl mb-10">
              A real chit fund on Arc. Pay in each round, bid for the pot when you need it, earn dividends while you wait.
            </p>
            <div className="flex flex-wrap gap-0">
              <Link to="/new"
                className="press cell px-8 py-4 bg-signal text-on-signal label font-bold hover:opacity-90 flex items-center gap-2">
                Start a Kameti
                <ArrowRight size={14} />
              </Link>
              <a href="#how"
                className="press cell px-8 py-4 label hover:bg-paper-2 flex items-center">
                How it works
              </a>
              {DEMO_CIRCLE_ID && (
                <Link to={`/k/${DEMO_CIRCLE_ID}`}
                  className="press cell px-8 py-4 label hover:bg-paper-2 flex items-center gap-2 text-muted">
                  View demo circle
                  <ArrowRight size={14} />
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="frame grid grid-cols-2 md:grid-cols-4">
        <Stat label="USDC Saved"      value={totalSaved}     unit="USDC" i={0} />
        <Stat label="Dividends Paid"  value={totalDividends} unit="USDC" i={1} />
        <Stat label="Circles Created" value={totalCircles}              i={2} />
        <Stat label="Payouts Sent"    value={totalPayouts}              i={3} />
      </section>

      {/* Marquee */}
      <MarqueeTicker events={[]} />

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
              <div className="step-arrow absolute bottom-6 right-6 text-signal">
                <ArrowRight size={20} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Why Kameti */}
      <section className="frame" data-reveal>
        <div className="cell px-6 md:px-14 py-12">
          <p className="label text-muted mb-2">Why Kameti</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold mb-0">Built different.</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3">
          {WHY.map((w) => (
            <div key={w.title} className="cell p-8 flex flex-col gap-4" data-reveal>
              <div className="w-10 h-10 bg-signal flex items-center justify-center shrink-0">
                <w.icon size={20} className="text-on-signal" />
              </div>
              <h3 className="font-display text-xl font-bold">{w.title}</h3>
              <p className="text-muted text-sm leading-relaxed">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="frame" data-reveal>
        <div className="cell grid grid-cols-1 md:grid-cols-2 items-center">
          <div className="p-10 md:p-14">
            <p className="label text-muted mb-3">Ready?</p>
            <h2 className="font-display text-4xl font-bold mb-6">Start your first Kameti today.</h2>
            <Link to="/new"
              className="press cell px-8 py-4 bg-signal text-on-signal label font-bold hover:opacity-90 inline-flex items-center gap-2">
              Create a Circle
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="cell h-full min-h-48 bg-paper-2 p-10 md:p-14 flex flex-col justify-end" data-reveal>
            <p className="font-display text-2xl font-bold">
              {totalCircles} circles,<br />{formatUsdc(BigInt(Math.round(totalSaved * 1e6)))} USDC flowing.
            </p>
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
            <a href={`https://explorer.testnet.arc.io/address/${KAMETI_ADDRESS}`}
              target="_blank" rel="noopener"
              className="link-line label text-muted">Arc Explorer</a>
            <Link to="/score" className="link-line label text-muted">Kameti Score</Link>
            <a href="https://developers.circle.com" target="_blank" rel="noopener"
              className="link-line label text-muted">Circle Docs</a>
          </div>
          <p className="label text-muted md:text-right">Built on Arc · USDC is gas · Testnet</p>
        </div>
      </footer>

    </div>
  )
}
