/**
 * /reviewers — Review Kameti in 60 seconds
 */
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, ArrowRight, Check } from 'lucide-react'
import { useBoot } from '@/motion'
import { KAMETI_ADDRESS, CHAIN_ID, explorerAddr, explorerTx } from '@/lib/contract'
import { DEMO_CIRCLE_ID } from '@/config/demo'

// ── Config (one-line switches when live) ────────────────────────────────────
const GITHUB_URL       = 'https://github.com/anshxft/kameti'
const ARC_STUDIO_URL   = 'https://studio.arc.io/app/81700373-0f8c-4789-9edf-fbad498edef8'
const EXPLORER_URL     = explorerAddr(KAMETI_ADDRESS)
const DEMO_VIDEO_URL   = '' // fill in when recorded
// DEMO_CIRCLE_ID imported from @/config/demo (committed default: 2)

// ── Testnet proof transactions (seeded demo circle #2) ──────────────────────
// These are real Arc Testnet transactions pushing real USDC through EIP-3009.
const TESTNET_PROOF_TXS: { label: string; hash: string }[] = [
  { label: 'createCircleWithAuthorization (demo circle #2)', hash: '0x0b15024048bec12363e0c7092795ff32ae2a5674fb65163cfeedbc45e02ac219' },
  { label: 'executeAutoPay — 4/4 members, all EIP-3009', hash: '0xd396594d875fa07f0b77ae6aea5d8c98a4e71e6db59bb5f6b6f8847122a75221' },
  { label: 'settleRound — keeper earned tip', hash: '0x7894a743736436bb7e262c8ce8f8fe77f01b5d62b525d95649c77739fa74caf6' },
  { label: 'enablePqGuard — SLH-DSA key registered', hash: '0x9def538ce6fd29b10ef833f625085a696646b960aaf84400d07d3fe5f62a0305' },
  { label: 'payWithAuthorization — round 2, single payment', hash: '0xf8afbef2647a0386e4fd663244b11e41c7698def28f662695c3ca13dd359ed29' },
]

// Mainnet receipts — empty until the mainnet circle runs
const MAINNET_RECEIPTS: { label: string; hash: string }[] = []

const ABI_STATS = {
  totalEntries:  90,
  testCount:     137,
  auditRounds:   2,
  invariantRuns: 256,
  invariantDepth: 500,
}

const WHAT_DONE = [
  'EIP-3009 ReceiveWithAuthorization on native Arc USDC — sign once, no approve, no gas each round',
  'Post-win lock: part of the winner\'s payout stays locked and releases as they keep paying future rounds',
  'Keeper tip: configurable % incentivises timely settlement',
  'SLH-DSA (FIPS 205) post-quantum withdrawal guard via Arc precompile 0x1800…0004',
  'IKametiScore interface for external credit integrations',
  'Gas-griefing fix: settleRound reverts instead of silently skipping on low gas',
]

const WHAT_NOT_YET = [
  'No independent security audit',
  'Open (not sealed) bids — bid order is visible on chain',
  'Deposits do not earn yield while locked',
  'No INR on-ramp — members need USDC on Arc',
  'PQ withdrawal guard is experimental on Arc (live on testnet and mainnet)',
]

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener"
      className="link-line label text-ink font-bold flex items-center gap-1.5 hover:text-ink">
      {children} <ExternalLink size={10} className="shrink-0" />
    </a>
  )
}

interface CheckItemProps { n: number; label: string; link?: React.ReactNode; note?: string }

function CheckItem({ n, label, link, note }: CheckItemProps) {
  return (
    <div className="cell p-5 flex items-start gap-4">
      <div className="w-8 h-8 bg-signal flex items-center justify-center shrink-0">
        <span className="label font-bold text-on-signal text-xs">{n}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="label font-bold text-ink mb-1">{label}</p>
        {link && <div className="mt-1">{link}</div>}
        {note && <p className="label text-muted text-[10px] mt-1">{note}</p>}
      </div>
      <Check size={14} className="text-signal-ink shrink-0 mt-0.5" />
    </div>
  )
}

export default function Reviewers() {
  const pageRef = useRef<HTMLDivElement>(null)
  useBoot(pageRef)

  return (
    <div ref={pageRef} className="pt-12 min-h-screen overflow-x-hidden">
      <div className="frame">

        {/* Header */}
        <div className="cell px-6 md:px-14 py-12" data-boot>
          <p className="label text-muted mb-2">Review guide</p>
          <h1 className="font-display text-5xl md:text-7xl font-bold mb-4">Review Kameti in 60 seconds.</h1>
          <p className="font-sans text-muted text-lg max-w-2xl">
            Everything a reviewer needs: live links, test results, testnet receipts, and what still needs work.
          </p>
        </div>

        {/* Contract facts */}
        <div className="cell px-6 md:px-14 py-8 bg-paper-2 grid grid-cols-2 md:grid-cols-4 gap-6" data-boot>
          <div>
            <p className="label text-muted mb-1 text-[10px]">CONTRACT</p>
            <a href={EXPLORER_URL} target="_blank" rel="noopener"
              className="font-mono text-xs text-ink break-all hover:text-signal-ink transition-colors">
              {KAMETI_ADDRESS.slice(0,8)}…{KAMETI_ADDRESS.slice(-6)}
            </a>
          </div>
          <div>
            <p className="label text-muted mb-1 text-[10px]">NETWORK</p>
            <p className="label text-ink font-bold">Arc Testnet ({CHAIN_ID})</p>
          </div>
          <div>
            <p className="label text-muted mb-1 text-[10px]">ABI ENTRIES</p>
            <p className="font-display text-2xl font-bold">{ABI_STATS.totalEntries}</p>
          </div>
          <div>
            <p className="label text-muted mb-1 text-[10px]">TESTS</p>
            <p className="font-display text-2xl font-bold">{ABI_STATS.testCount} pass</p>
          </div>
        </div>

        {/* Checklist */}
        <div className="cell">
          <div className="px-6 md:px-14 py-8">
            <p className="label text-muted mb-4">Checklist</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2">
            <CheckItem n={1} label="Arc Studio project"
              link={<ExtLink href={ARC_STUDIO_URL}>Open in Arc Studio</ExtLink>}
              note="Full build history, contract versions, and test runs." />

            <CheckItem n={2} label="Contract on Arc Explorer"
              link={<ExtLink href={EXPLORER_URL}>View contract</ExtLink>}
              note={`Deployed at ${KAMETI_ADDRESS}`} />

            <CheckItem n={3} label="Source code"
              link={<ExtLink href={GITHUB_URL}>github.com/anshxft/kameti</ExtLink>}
              note="contracts/Kameti.sol · contracts/test/ · scripts/" />

            <CheckItem n={4} label="Test suite"
              link={<ExtLink href={`${GITHUB_URL}/tree/main/contracts/test`}>contracts/test/</ExtLink>}
              note={`${ABI_STATS.testCount} tests pass, ${ABI_STATS.auditRounds} max-severity audit rounds, Slither: no actionable findings (remaining items reviewed as false positives). Invariants: ${ABI_STATS.invariantRuns} runs × ${ABI_STATS.invariantDepth} depth.`} />

            <CheckItem n={5} label="Try to break it"
              link={<Link to="/break" className="link-line label text-ink font-bold flex items-center gap-1.5">Five attack cards <ArrowRight size={10} /></Link>}
              note="Real eth_call simulations against the live contract." />

            <CheckItem n={6} label="Live smoke tests"
              link={<ExtLink href={`${GITHUB_URL}/blob/main/scripts/smoke-pq.ts`}>smoke-pq.ts</ExtLink>}
              note="SLH-DSA: valid=true, tampered=false on Arc Testnet precompile. Gas: receiveWithAuthorization measured at 88,067 gas including the 21,000 transaction base cost; AutoPay forwards 115,000 to it." />

            {DEMO_CIRCLE_ID > 0n && (
              <CheckItem n={7} label="Demo circle on testnet"
                link={<Link to={`/k/${DEMO_CIRCLE_ID}`} className="link-line label text-ink font-bold flex items-center gap-1.5">View demo circle #{DEMO_CIRCLE_ID.toString()} <ArrowRight size={10} /></Link>}
                note="Real USDC flowing through EIP-3009, AutoPay, keeper tip, and PQ guard." />
            )}

            <CheckItem n={8} label="Mainnet receipts"
              link={MAINNET_RECEIPTS.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {MAINNET_RECEIPTS.map((r, i) => (
                    <a key={i} href={explorerTx(r.hash)} target="_blank" rel="noopener"
                      className="link-line label text-ink text-[10px] flex items-center gap-1">
                      {r.label} <ExternalLink size={9} />
                    </a>
                  ))}
                </div>
              ) : <p className="label text-muted text-[10px]">Mainnet receipts appear here after the mainnet circle runs.</p>}
            />

            <CheckItem n={DEMO_CIRCLE_ID ? 9 : 8} label="Demo video"
              link={DEMO_VIDEO_URL
                ? <ExtLink href={DEMO_VIDEO_URL}>Watch demo</ExtLink>
                : <p className="label text-muted text-[10px]">Not recorded yet.</p>}
            />
          </div>
        </div>

        {/* Testnet proof */}
        {TESTNET_PROOF_TXS.length > 0 && (
          <div className="cell px-6 md:px-14 py-8 bg-paper-2 border-t border-line" data-boot>
            <p className="label text-muted mb-4">Testnet proof: real Arc USDC through EIP-3009</p>
            <p className="label text-muted text-[10px] mb-4">
              Demo circle #2 — 4 members, 0.5 USDC contribution, 30-min rounds, keeper tip 10 bps, post-win lock 50%.
              All payments went through <code className="font-mono">receiveWithAuthorization</code> on native Arc USDC. No approve. No gas from members.
            </p>
            <div className="flex flex-col gap-2">
              {TESTNET_PROOF_TXS.map((tx, i) => (
                <a
                  key={i}
                  href={explorerTx(tx.hash)}
                  target="_blank"
                  rel="noopener"
                  className="cell p-3 flex items-center justify-between gap-4 hover:bg-paper-2 press group"
                >
                  <span className="label text-ink text-[11px]">{tx.label}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-muted text-[10px]">{tx.hash.slice(0,10)}…</span>
                    <ExternalLink size={10} className="text-muted group-hover:text-signal-ink transition-colors" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* What was built v3.1 */}
        <div className="cell px-6 md:px-14 py-8 border-t border-line" data-boot>
          <p className="label text-muted mb-4">v3.1 additions</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {WHAT_DONE.map((w, i) => (
              <div key={i} className="flex items-start gap-3">
                <Check size={12} className="shrink-0 mt-0.5 text-signal-ink" />
                <span className="label text-sm text-muted">{w}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Honest limits */}
        <div className="cell px-6 md:px-14 py-8 bg-paper-2 border-t border-line" data-boot>
          <p className="label text-muted mb-4">What it does not do yet</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {WHAT_NOT_YET.map((w, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="label text-muted text-[11px] shrink-0 mt-0.5">—</span>
                <span className="label text-sm text-muted">{w}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CTA row */}
        <div className="cell px-6 md:px-14 py-8 flex flex-wrap gap-3 border-t border-line">
          <Link to="/"
            className="press cell px-6 py-3 bg-signal text-on-signal border border-ink label font-bold flex items-center gap-2 hover:bg-signal-hover">
            Home <ArrowRight size={12} />
          </Link>
          <Link to="/break"
            className="press cell px-6 py-3 border border-line text-ink label hover:bg-paper-2 flex items-center gap-2">
            Try to break it <ArrowRight size={12} />
          </Link>
          <Link to="/new"
            className="press cell px-6 py-3 border border-line text-ink label hover:bg-paper-2 flex items-center gap-2">
            Start a Kameti <ArrowRight size={12} />
          </Link>
        </div>

      </div>
    </div>
  )
}
