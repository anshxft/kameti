import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { gsap, reducedMotion } from '@/motion'

const MAX_DISCOUNT_PCT = 40 // contract cap: maxDiscountBps <= 4000
const COUNT_SECONDS = 0.35

const formatUsdcAmount = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatInr = (n: number) =>
  `≈ ₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

/** Eases to each new value by writing to the DOM directly, so a slider drag never re-renders per frame. */
function Count({ value, format }: { value: number; format: (n: number) => string }) {
  const el = useRef<HTMLSpanElement>(null)
  const current = useRef({ value })
  const [initial] = useState(() => format(value)) // React must not overwrite the tween's text

  useEffect(() => {
    const paint = () => { if (el.current) el.current.textContent = format(current.current.value) }
    if (reducedMotion()) {
      current.current.value = value
      paint()
      return
    }
    const tween = gsap.to(current.current, {
      value, duration: COUNT_SECONDS, ease: 'power3.out', overwrite: true, onUpdate: paint,
    })
    return () => { tween.kill() }
  }, [value, format])

  return <span ref={el} className="tabular-nums">{initial}</span>
}

/**
 * The thumb moves continuously and the value rounds, so it never jumps between
 * steps. Arrow keys still move one whole step.
 */
function Slider({ label, position, shown, min, max, onChange }: {
  label: string; position: number; shown: string; min: number; max: number; onChange: (n: number) => void
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    onChange(Math.min(max, Math.max(min, Math.round(position) + delta)))
  }
  const fill = { '--fill': `${((position - min) / (max - min)) * 100}%` } as CSSProperties

  return (
    <label className="block">
      <span className="flex items-baseline justify-between mb-2">
        <span className="label text-muted">{label}</span>
        <span className="font-display text-xl font-bold tabular-nums">{shown}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step="any"
        value={position}
        aria-valuetext={shown}
        style={fill}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyDown={onKeyDown}
        className="calc-range w-full"
      />
    </label>
  )
}

function Result({ label, value, inrRate, accent = false }: {
  label: string; value: number; inrRate: number; accent?: boolean
}) {
  const tone = accent ? 'bg-signal text-on-signal' : ''
  const subTone = accent ? '' : 'text-muted'
  return (
    <div className={`cell flex-1 p-6 md:px-10 flex items-end justify-between gap-4 ${tone}`}>
      <p className={`label ${subTone}`}>{label}</p>
      <div className="text-right">
        <p className="font-display text-3xl md:text-4xl font-bold">
          <Count value={value} format={formatUsdcAmount} />
          <span className="text-sm ml-1">USDC</span>
        </p>
        {inrRate > 0 && (
          <p className={`label text-[9px] mt-0.5 ${subTone}`}>
            <Count value={value * inrRate} format={formatInr} />
          </p>
        )}
      </div>
    </div>
  )
}

export default function RoundCalculator({ inrRate }: { inrRate: number }) {
  const [membersAt, setMembersAt] = useState(5)
  const [contributionAt, setContributionAt] = useState(10)
  const [discountAt, setDiscountAt] = useState(10)

  const members = Math.round(membersAt)
  const contribution = Math.round(contributionAt)
  const discountPct = Math.round(discountAt)

  const pot = members * contribution
  const discount = (pot * discountPct) / 100

  return (
    <section id="calculator" className="frame" data-reveal>
      <div className="cell px-6 md:px-14 py-12">
        <p className="label text-muted mb-2">Run the numbers</p>
        <h2 className="font-display text-4xl md:text-5xl font-bold">One round, in USDC.</h2>
        <p className="font-sans text-muted mt-3">Take the pot early for less, or wait and collect the discount.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="cell px-6 md:px-14 py-10 flex flex-col gap-8">
          <Slider label="Members" position={membersAt} shown={String(members)} min={3} max={10} onChange={setMembersAt} />
          <Slider label="Contribution" position={contributionAt} shown={`${contribution} USDC`} min={1} max={100} onChange={setContributionAt} />
          <Slider label="Winning bid" position={discountAt} shown={`${discountPct}%`} min={0} max={MAX_DISCOUNT_PCT} onChange={setDiscountAt} />
          <p className="label text-muted text-[10px] leading-relaxed">
            Before the keeper tip (up to 0.2%) and the post-win lock, which is released as the winner keeps paying.
          </p>
        </div>
        <div className="flex flex-col">
          <Result label="Pot" value={pot} inrRate={inrRate} />
          <Result label="Winner takes now" value={pot - discount} inrRate={inrRate} accent />
          <Result label="Each other member earns" value={discount / (members - 1)} inrRate={inrRate} />
        </div>
      </div>
    </section>
  )
}
