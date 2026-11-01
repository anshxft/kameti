import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: 'What is a kameti?',
    a: 'A group saves a fixed amount every round, and each round one member takes the whole pot. It is also called a committee, chit fund, tanda, susu or hui. Kameti runs the same idea on a contract instead of a notebook.',
  },
  {
    q: 'Who holds the money?',
    a: "The contract. It has no owner, admin key, pause or upgrade, so nobody can move the pot by hand. USDC only leaves by the contract's own rules: payouts, dividends, refunds and a small keeper tip.",
  },
  {
    q: 'Who gets the pot each round?',
    a: 'Members who have paid and have not won yet can bid a discount. The highest bid wins, and the discount is split among the other members. With no bids, the earliest seat still waiting gets the full pot. Everyone gets the pot once.',
  },
  {
    q: 'What if someone stops paying?',
    a: 'Their security deposit covers the round and they get a strike. If they already won, their locked payout is used first. Once the deposit runs out, the shortfall becomes debt, taken from any later payout.',
  },
  {
    q: 'Can AutoPay take more than my contribution?',
    a: 'No. You sign one payment per round. Each signature covers that round’s contribution into your own seat, and only the Kameti contract can use it. You can turn AutoPay off from the circle page.',
  },
  {
    q: 'Do I need ETH or another token?',
    a: (
      <>
        No. Gas on Arc is paid in USDC, so USDC is all you need. To bring USDC over from another chain, use the{' '}
        <Link to="/bridge" className="link-line text-ink">Bridge page</Link>.
      </>
    ),
  },
  {
    q: 'Can I leave a circle?',
    a: 'Before it fills up, yes: leave and your deposit comes back. Once it starts you cannot leave. Missed rounds are covered from your deposit, and whatever is left comes back when the circle ends.',
  },
  {
    q: 'What is the Kameti Score?',
    a: (
      <>
        A 300–900 score built from a wallet’s history across circles. On-time payments and finished circles raise it; strikes and defaults lower it. A circle can set a minimum score to join.{' '}
        <Link to="/score" className="link-line text-ink">Check a score</Link>.
      </>
    ),
  },
  {
    q: 'Has it been audited?',
    a: (
      <>
        Not independently. It has 137 Foundry tests, two invariant suites and reviews from Arc Studio’s auditors, and you can{' '}
        <Link to="/break" className="link-line text-ink">attack it yourself</Link>. Use small amounts.
      </>
    ),
  },
  {
    q: 'Is Kameti a registered chit fund?',
    a: 'No. It is an experimental contract and app, not a registered company or a financial product. Check the rules where you live before putting in real savings.',
  },
]

export default function Faq() {
  const [open, setOpen] = useState(0)

  return (
    <section id="faq" className="frame grid grid-cols-1 lg:grid-cols-[1fr_2fr]" data-reveal>
      <div className="cell px-6 md:px-14 py-12">
        <p className="label text-muted mb-2">FAQ</p>
        <h2 className="font-display text-4xl md:text-5xl font-bold">Questions, answered.</h2>
      </div>
      <div className="cell">
        {FAQS.map(({ q, a }, i) => (
          <div key={q} className="faq-item border-b border-line last:border-b-0" data-open={open === i}>
            <h3>
              <button
                type="button"
                id={`faq-q-${i}`}
                aria-expanded={open === i}
                aria-controls={`faq-a-${i}`}
                onClick={() => setOpen(open === i ? -1 : i)}
                className="faq-q w-full flex items-center justify-between gap-6 px-6 py-5 text-left font-display text-lg font-bold"
              >
                {q}
                <Plus size={18} className="shrink-0 text-signal-ink" aria-hidden="true" />
              </button>
            </h3>
            <div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} className="faq-a">
              <div>
                <p className="px-6 pb-6 max-w-2xl text-muted text-sm leading-relaxed">{a}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
