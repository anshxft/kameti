import { useState } from 'react'
import NumberFlow from '@number-flow/react'

const USDC_FORMAT = { minimumFractionDigits: 2, maximumFractionDigits: 2 }
const MAX_DISCOUNT_PCT = 40 // contract cap: maxDiscountBps <= 4000

function Slider({ label, value, shown, min, max, onChange }: {
  label: string; value: number; shown: string; min: number; max: number; onChange: (n: number) => void
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between mb-2">
        <span className="label text-muted">{label}</span>
        <span className="font-display text-xl font-bold">{shown}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
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
          <NumberFlow value={value} format={USDC_FORMAT} />
          <span className="text-sm ml-1">USDC</span>
        </p>
        {inrRate > 0 && (
          <p className={`label text-[9px] mt-0.5 ${subTone}`}>
            ≈ ₹{(value * inrRate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </p>
        )}
      </div>
    </div>
  )
}

export default function RoundCalculator({ inrRate }: { inrRate: number }) {
  const [members, setMembers] = useState(5)
  const [contribution, setContribution] = useState(10)
  const [discountPct, setDiscountPct] = useState(10)

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
          <Slider label="Members" value={members} shown={String(members)} min={3} max={10} onChange={setMembers} />
          <Slider label="Contribution" value={contribution} shown={`${contribution} USDC`} min={1} max={100} onChange={setContribution} />
          <Slider label="Winning bid" value={discountPct} shown={`${discountPct}%`} min={0} max={MAX_DISCOUNT_PCT} onChange={setDiscountPct} />
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
