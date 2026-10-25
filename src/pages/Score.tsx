import { useRef, useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAccount, usePublicClient } from 'wagmi'
import { Share2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import NumberFlow from '@number-flow/react'
import { useBoot } from '@/motion'
import { KAMETI_ADDRESS, KAMETI_ABI, CHAIN_ID, formatAddress } from '@/lib/contract'
import type { ScoreStats } from '@/lib/types'
import { scoreTier } from '@/lib/types'

// ─── SVG Gauge ───────────────────────────────────────────────────────────────
function ScoreGauge({ score }: { score: number }) {
  const MIN = 300, MAX = 900
  const pct   = (score - MIN) / (MAX - MIN)   // 0..1
  // Semicircle: left = 180°, right = 0°. Needle sweeps left→right as score rises.
  const angle = 180 - pct * 180               // degrees (180 = low, 0 = high)
  const RAD   = Math.PI / 180
  // Arc radius + centre. cy=88 leaves room below for text in 140px-tall viewBox.
  const R = 72, cx = 100, cy = 84
  const needleX = cx + R * Math.cos(angle * RAD)
  const needleY = cy - R * Math.sin(angle * RAD)

  const { label } = scoreTier(score)
  const arcColor  = score >= 650 ? 'var(--ink)' : score >= 550 ? 'var(--muted)' : 'var(--signal)'

  // Arc from 180° (left) to current angle
  const startX   = cx - R
  const endX     = cx + R * Math.cos(angle * RAD)
  const endY     = cy - R * Math.sin(angle * RAD)
  const largeArc = pct > 0.5 ? 1 : 0

  return (
    // viewBox height = 140 → score text at y=112, tier at y=127, both well inside
    <svg viewBox="0 0 200 140" className="w-full max-w-xs mx-auto" aria-label={`Kameti Score: ${score}`}>
      {/* background arc (full semicircle) */}
      <path
        d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
        fill="none" stroke="var(--line)" strokeWidth={7}
      />
      {/* filled progress arc */}
      {pct > 0 && (
        <path
          d={`M ${startX} ${cy} A ${R} ${R} 0 ${largeArc} 1 ${endX} ${endY}`}
          fill="none" stroke={arcColor} strokeWidth={7} strokeLinecap="round"
        />
      )}
      {/* needle */}
      <line x1={cx} y1={cy} x2={needleX} y2={needleY}
        stroke="var(--signal)" strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={4} fill="var(--signal)" />
      {/* score number — sits 28px below pivot, fully inside 140px viewBox */}
      <text x={cx} y={cy + 28} textAnchor="middle"
        style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, fill: 'var(--ink)' }}>
        {score}
      </text>
      {/* tier label */}
      <text x={cx} y={cy + 44} textAnchor="middle"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </text>
      {/* range end-labels sit just outside the arc ends at the same y as the pivot */}
      <text x={cx - R - 6} y={cy + 4} textAnchor="end"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }}>300</text>
      <text x={cx + R + 6} y={cy + 4} textAnchor="start"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }}>900</text>
    </svg>
  )
}

// ─── Score panel ─────────────────────────────────────────────────────────────
function ScorePanel({ addr }: { addr: string }) {
  const [score, setScore]   = useState<number | null>(null)
  const [stats, setStats]   = useState<ScoreStats | null>(null)
  const [loading, setLoading] = useState(true)
  const publicClient = usePublicClient({ chainId: CHAIN_ID })

  useEffect(() => {
    if (!publicClient || !addr) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [s, st] = await Promise.all([
          publicClient.readContract({
            address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
            functionName: 'scoreOf', args: [addr],
          }),
          publicClient.readContract({
            address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
            functionName: 'statsOf', args: [addr],
          }),
        ])
        if (!cancelled) {
          setScore(Number(s))
          const raw = st as ScoreStats
          setStats(raw)
        }
      } catch {
        if (!cancelled) setScore(600)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [publicClient, addr])

  if (loading) return <div className="cell p-12 text-center"><span className="label text-muted">Loading score…</span></div>

  const s = score ?? 600
  const { label } = scoreTier(s)

  return (
    <div className="frame">

      {/* Gauge */}
      <div className="cell p-8 flex flex-col items-center gap-4">
        <ScoreGauge score={s} />
        <div className="flex items-center gap-3">
          <span className={`label px-3 py-1 ${s >= 650 ? 'bg-ink text-paper' : s >= 550 ? 'border border-line text-muted' : 'border border-signal text-signal'}`}>
            {label}
          </span>
          <span className="label text-muted">{formatAddress(addr)}</span>
        </div>
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="frame grid grid-cols-2 sm:grid-cols-4">
          {[
            { label: 'On-Time Payments', value: stats.onTimePayments, good: true },
            { label: 'Circles Completed', value: stats.circlesCompleted, good: true },
            { label: 'Strikes', value: stats.strikes, good: false },
            { label: 'Defaults', value: stats.defaults, good: false },
          ].map(st => (
            <div key={st.label} className="cell p-5">
              <p className="label text-muted mb-2">{st.label}</p>
              <p className={`font-display text-3xl font-bold ${st.value > 0 && !st.good ? 'text-signal' : ''}`}>
                <NumberFlow value={st.value} />
              </p>
            </div>
          ))}
          <div className="cell p-5 col-span-2">
            <p className="label text-muted mb-2">Total Contributed</p>
            <p className="font-display text-3xl font-bold">
              <NumberFlow value={Number(stats.totalContributed) / 1e6} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
            </p>
            <p className="label text-muted">USDC</p>
          </div>
        </div>
      )}

      {/* Formula */}
      <div className="cell p-6 md:p-8">
        <p className="label text-muted mb-3">How the Score Works</p>
        <div className="font-mono text-sm text-muted space-y-1 leading-relaxed">
          <p>Score = 600 (base)</p>
          <p className="text-ink">+ 5 × on-time payments</p>
          <p className="text-ink">+ 40 × circles completed</p>
          <p className="text-signal">− 30 × strikes (missed, covered by deposit)</p>
          <p className="text-signal">− 120 × defaults (deposit exhausted)</p>
          <p className="text-muted">Clamped to [300, 900]</p>
        </div>
      </div>

    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ScorePage() {
  const { address: paramAddr } = useParams<{ address?: string }>()
  const { address: walletAddr } = useAccount()
  const navigate = useNavigate()
  const pageRef = useRef<HTMLDivElement>(null)
  useBoot(pageRef)

  const [lookup, setLookup] = useState('')

  const target = paramAddr ?? walletAddr ?? ''

  return (
    <div ref={pageRef} className="pt-12 min-h-screen overflow-x-hidden">
      <div className="frame">

        <div className="cell px-6 md:px-12 py-10" data-boot>
          <p className="label text-muted mb-2">On-Chain Credit</p>
          <h1 className="font-display text-4xl md:text-5xl font-bold">Kameti Score</h1>
          <p className="text-muted mt-3 max-w-lg">
            Your 300–900 credit score built from your payment history across all Kameti circles.
          </p>
        </div>

        {/* Lookup input */}
        <div className="cell p-6" data-boot>
          <div className="flex gap-0 max-w-lg">
            <input
              type="text"
              value={lookup}
              onChange={e => setLookup(e.target.value)}
              placeholder="0x… wallet address"
              className="flex-1 bg-transparent border border-line px-4 py-3 font-mono text-sm focus:border-ink outline-none transition-colors"
              onKeyDown={e => {
                if (e.key === 'Enter' && lookup.startsWith('0x')) {
                  void navigate(`/score/${lookup}`)
                }
              }}
            />
            <button
              onClick={() => { if (lookup.startsWith('0x')) void navigate(`/score/${lookup}`) }}
              className="press cell px-6 py-3 bg-ink text-paper label">
              Look Up
            </button>
          </div>
        </div>

        {/* Score panel */}
        {target ? (
          <>
            <ScorePanel addr={target} />
            {/* Share */}
            <div className="cell p-6 flex gap-3">
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(window.location.href)
                  toast.success('Link copied!')
                }}
                className="press cell px-5 py-3 label flex items-center gap-2 text-muted hover:bg-paper-2">
                <Copy size={13} /> Copy Link
              </button>
              <Link to="/me" className="press cell px-5 py-3 label flex items-center gap-2 text-muted hover:bg-paper-2">
                <Share2 size={13} /> My Circles
              </Link>
            </div>
          </>
        ) : (
          <div className="cell p-12 text-center" data-boot>
            <p className="font-display text-2xl font-bold mb-4">Connect your wallet or enter an address</p>
            <p className="label text-muted">Your score starts at 600. Build it up by paying on time.</p>
          </div>
        )}

      </div>
    </div>
  )
}
