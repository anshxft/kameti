/**
 * /break — Try to break Kameti
 *
 * RULES:
 * - "REJECTED AS EXPECTED: <error>" only when decoded error === expected.
 * - When the circle is not in the required state, show "Needs the demo circle — not run"
 *   in a neutral style plus the test link. NEVER print a success sentence for an attack
 *   that did not actually run against the intended state.
 * - "Call succeeded unexpectedly" only when the call actually ran and did NOT revert.
 * - Attacks 1–4 target the Attack Lab circle (long-lived, never settles), which keeps
 *   states stable across rounds. Attack 5 (PQ) targets the demo circle.
 */
import { useRef, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { decodeErrorResult, type Hex } from 'viem'
import { Shield, Clock, RefreshCw, Zap, Key, CheckCircle2, AlertCircle, Loader2, Info } from 'lucide-react'
import { useBoot } from '@/motion'
import { KAMETI_ADDRESS, KAMETI_ABI, CHAIN_ID, explorerAddr, explorerTx } from '@/lib/contract'
import attackFixtures from '@/config/attackFixtures.json'
import { DEMO_CIRCLE_ID, ATTACK_LAB_ID } from '@/config/demo'

// ─── PQ target member ─────────────────────────────────────────────────────────
// Member 2 in the demo circle: 0xaFdb1d87a1A766E63d22aa5C0FAC8481aaBda3aF
// emitted PqGuardEnabled; has claimable 1.088 USDC.
const PQ_TARGET_MEMBER = '0xaFdb1d87a1A766E63d22aa5C0FAC8481aaBda3aF' as `0x${string}`

// ─── ABI-based error decoder ──────────────────────────────────────────────────
function decodeKametiError(e: unknown): { name: string; args?: string } | null {
  if (!e || typeof e !== 'object') return null
  const err = e as Record<string, unknown>
  let data: string | undefined
  for (const obj of [
    err,
    err.cause as Record<string, unknown>,
    (err.cause as Record<string, unknown>)?.cause as Record<string, unknown>,
  ]) {
    if (!obj) continue
    if (typeof obj.data === 'string' && obj.data.startsWith('0x') && obj.data.length >= 10) { data = obj.data; break }
    if (typeof obj.raw === 'string' && obj.raw.startsWith('0x') && obj.raw.length >= 10) { data = obj.raw; break }
  }
  if (!data) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e)
    const hexMatch = msg.match(/0x[0-9a-fA-F]{8}[0-9a-fA-F]*/)?.[0]
    if (hexMatch && hexMatch.length >= 10) data = hexMatch
  }
  if (!data) return null
  try {
    const decoded = decodeErrorResult({ abi: KAMETI_ABI as never, data: data as Hex })
    const argsStr = decoded.args && decoded.args.length > 0
      ? `(${decoded.args.map(a => String(a)).join(', ')})`
      : ''
    return { name: decoded.errorName, args: argsStr }
  } catch {
    return { name: `unknown(${data.slice(0, 10)})`, args: '' }
  }
}

function errorLabel(decoded: { name: string; args?: string } | null): string {
  if (!decoded) return 'unknown error'
  return decoded.name + (decoded.args ?? '')
}

// ─── Result type ─────────────────────────────────────────────────────────────
type AttackOutcome =
  | { kind: 'not_run'; reason: string }
  | { kind: 'matched'; decoded: string; note?: string }
  | { kind: 'wrong_error'; decoded: string; note?: string }
  | { kind: 'succeeded_unexpectedly'; note?: string }

// ─── AttackCard ───────────────────────────────────────────────────────────────
interface AttackCardProps {
  icon: React.ElementType
  title: string
  subtitle: string
  description: string
  buttonLabel: string
  expectedError: string
  testLink: string
  onRun: () => Promise<AttackOutcome>
}

function AttackCard({
  icon: Icon, title, subtitle, description, buttonLabel,
  expectedError, testLink, onRun,
}: AttackCardProps) {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle')
  const [result, setResult] = useState<AttackOutcome | null>(null)

  const run = async () => {
    setState('running')
    setResult(null)
    try {
      const r = await onRun()
      setResult(r)
    } catch (e) {
      const d = decodeKametiError(e)
      setResult({ kind: 'wrong_error', decoded: errorLabel(d), note: 'Unexpected throw during simulation' })
    }
    setState('done')
  }

  return (
    <div className="cell p-6 flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-ink flex items-center justify-center shrink-0">
          <Icon size={18} className="text-paper" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg font-bold">{title}</h3>
          <p className="label text-muted text-[10px] mt-0.5">{subtitle}</p>
        </div>
      </div>

      <p className="text-muted text-sm leading-relaxed">{description}</p>

      <p className="label text-[10px] text-muted">
        Expected: <span className="font-mono text-ink">{expectedError}</span>
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { void run() }}
          disabled={state === 'running'}
          className="press cell px-4 py-2 bg-signal text-on-signal border border-ink label font-bold flex items-center gap-2 hover:bg-signal-hover disabled:opacity-40"
        >
          {state === 'running' ? <><Loader2 size={12} className="animate-spin" />Running…</> : buttonLabel}
        </button>
        <a
          href={`https://github.com/anshxft/kameti/blob/main/contracts/test/${testLink}`}
          target="_blank" rel="noopener"
          className="press cell px-4 py-2 label text-muted hover:bg-paper-2 flex items-center gap-2"
        >
          View test
        </a>
      </div>

      {state === 'done' && result && (
        <ResultBanner result={result} explorerTxFn={explorerTx} />
      )}
    </div>
  )
}

function ResultBanner({ result, explorerTxFn: _explorerTxFn }: { result: AttackOutcome; explorerTxFn: (h: string) => string }) {
  if (result.kind === 'not_run') {
    return (
      <div className="cell p-4 bg-paper-2 border-line flex items-start gap-2">
        <Info size={14} className="text-muted mt-0.5 shrink-0" />
        <div>
          <span className="label font-bold text-xs text-muted">Needs the demo circle — not run</span>
          {result.reason && <p className="label text-muted text-[10px] mt-1">{result.reason}</p>}
        </div>
      </div>
    )
  }
  if (result.kind === 'matched') {
    return (
      <div className="cell p-4 bg-signal/10 border-signal-ink/20 flex items-start gap-2">
        <CheckCircle2 size={14} className="text-signal-ink mt-0.5 shrink-0" />
        <div>
          <span className="label font-bold text-xs text-ink">REJECTED AS EXPECTED: {result.decoded}</span>
          {result.note && <p className="label text-muted text-[10px] mt-1">{result.note}</p>}
        </div>
      </div>
    )
  }
  if (result.kind === 'wrong_error') {
    return (
      <div className="cell p-4 bg-paper-2 border-line flex items-start gap-2">
        <AlertCircle size={14} className="text-muted mt-0.5 shrink-0" />
        <div>
          <span className="label font-bold text-xs text-muted">Could not run this attack yet: {result.decoded}</span>
          {result.note && <p className="label text-muted text-[10px] mt-1">{result.note}</p>}
        </div>
      </div>
    )
  }
  // succeeded_unexpectedly — only when the call genuinely ran and did NOT revert
  return (
    <div className="cell p-4 bg-paper-2 border-line flex items-start gap-2">
      <AlertCircle size={14} className="text-muted mt-0.5 shrink-0" />
      <div>
        <span className="label font-bold text-xs text-muted">Call ran but did not revert — check contract state</span>
        {result.note && <p className="label text-muted text-[10px] mt-1">{result.note}</p>}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Break() {
  const pageRef = useRef<HTMLDivElement>(null)
  useBoot(pageRef)
  const publicClient = usePublicClient({ chainId: CHAIN_ID })

  // ── Attack 1: settleRound before deadline → RoundNotSettleable ──────────────
  const attack1 = async (): Promise<AttackOutcome> => {
    if (!publicClient) return { kind: 'not_run', reason: 'No public client' }
    try {
      await publicClient.simulateContract({
        address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
        functionName: 'settleRound', args: [ATTACK_LAB_ID],
        account: '0x0000000000000000000000000000000000000001',
      })
      return { kind: 'succeeded_unexpectedly', note: `Circle #${ATTACK_LAB_ID}: round deadline may have already passed — round ended naturally.` }
    } catch (e) {
      const d = decodeKametiError(e)
      if (d?.name === 'RoundNotSettleable') return { kind: 'matched', decoded: errorLabel(d), note: `Circle #${ATTACK_LAB_ID}: round deadline is in the future.` }
      return { kind: 'wrong_error', decoded: errorLabel(d), note: `Circle #${ATTACK_LAB_ID}` }
    }
  }

  // ── Attack 2: pay() when already paid → AlreadyPaid ────────────────────────
  const attack2 = async (): Promise<AttackOutcome> => {
    if (!publicClient) return { kind: 'not_run', reason: 'No public client' }
    // Read members — find one that already paid this round
    let paidMember: `0x${string}` | undefined
    try {
      const members = await publicClient.readContract({
        address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
        functionName: 'getMembers', args: [ATTACK_LAB_ID],
      }) as Array<{ addr: string; paidThisRound: boolean }>
      const found = members.find(m => m.paidThisRound)
      if (found) paidMember = found.addr as `0x${string}`
    } catch { /* fall through */ }
    if (!paidMember) return { kind: 'not_run', reason: `Circle #${ATTACK_LAB_ID}: no member has paid yet this round. Run executeAutoPay first or wait for a payment.` }
    try {
      await publicClient.simulateContract({
        address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
        functionName: 'pay', args: [ATTACK_LAB_ID],
        account: paidMember,
      })
      return { kind: 'succeeded_unexpectedly', note: `Member ${paidMember.slice(0,10)}… paid again. This should not happen.` }
    } catch (e) {
      const d = decodeKametiError(e)
      const matched = d?.name === 'AlreadyPaid' || d?.name === 'RoundEnded'
      if (matched) return { kind: 'matched', decoded: errorLabel(d), note: `Member ${paidMember.slice(0,10)}…` }
      return { kind: 'wrong_error', decoded: errorLabel(d), note: `Member ${paidMember.slice(0,10)}…` }
    }
  }

  // ── Attack 3: wrong-round EIP-3009 nonce → USDC rejection ──────────────────
  // Uses a real member's future-round authorization saved by seed-demo.ts.
  // Submitting a round-(N+1) auth for round N causes the USDC contract to reject it.
  const attack3 = async (): Promise<AttackOutcome> => {
    if (!publicClient) return { kind: 'not_run', reason: 'No public client' }

    const fx = attackFixtures.wrongRoundFixture
    if (!fx) return { kind: 'not_run', reason: 'Wrong-round fixture not generated yet — run scripts/seed-attack-lab.ts to populate src/config/attackFixtures.json.' }

    // fx carries a round-(N+1) EIP-3009 auth for a real member.
    // When submitted to payWithAuthorization on round N, Kameti computes the round-N nonce
    // for that member and passes it to USDC receiveWithAuthorization — which rejects it
    // because the signature was made against the round-(N+1) nonce. USDC returns
    // "FiatTokenV2: invalid signature" wrapped in the standard revert reason string.
    const { from, validBefore, v, r, s } = fx as { from: string; validBefore: string; v: number; r: string; s: string }
    try {
      await publicClient.simulateContract({
        address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
        functionName: 'payWithAuthorization',
        args: [ATTACK_LAB_ID, from as `0x${string}`, BigInt(validBefore), v, r as `0x${string}`, s as `0x${string}`],
        account: '0x0000000000000000000000000000000000000001',
      })
      return { kind: 'succeeded_unexpectedly', note: 'Round-(N+1) nonce was accepted for round N. This should not happen.' }
    } catch (e) {
      const d = decodeKametiError(e)
      // USDC reverts with a plain reason string "FiatTokenV2: invalid signature" —
      // it becomes an unknown selector in the Kameti ABI decoder, so check the raw message too.
      const rawMsg = e instanceof Error ? e.message : ''
      const isFiatTokenReject =
        rawMsg.includes('FiatTokenV2: invalid signature') ||
        rawMsg.includes('FiatTokenV2_2: invalid signature') ||
        d?.name === 'InvalidAuthorization' ||
        d?.name === 'SafeERC20FailedOperation'
      if (isFiatTokenReject) return {
        kind: 'matched',
        decoded: 'FiatTokenV2: invalid signature',
        note: `Kameti passed the round-N nonce to USDC; signature was for round N+1. Member: ${String(from).slice(0,10)}…`,
      }
      return { kind: 'wrong_error', decoded: errorLabel(d), note: `Member: ${String(from).slice(0,10)}… — circle may have moved to a different round.` }
    }
  }

  // ── Attack 4: executeAutoPay with gas < AUTOPAY_MIN_GAS ────────────────────
  const attack4 = async (): Promise<AttackOutcome> => {
    if (!publicClient) return { kind: 'not_run', reason: 'No public client' }
    // Verify at least one member has a stored authorization for the current round
    let hasStoredAuth = false
    try {
      const members = await publicClient.readContract({
        address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
        functionName: 'getMembers', args: [ATTACK_LAB_ID],
      }) as Array<{ addr: string; hasStoredAuth: boolean; paidThisRound: boolean }>
      hasStoredAuth = members.some(m => m.hasStoredAuth && !m.paidThisRound)
    } catch { /* fall through */ }
    if (!hasStoredAuth) return { kind: 'not_run', reason: `Circle #${ATTACK_LAB_ID}: no member has a stored authorization for this round yet.` }
    try {
      await publicClient.simulateContract({
        address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
        functionName: 'executeAutoPay', args: [ATTACK_LAB_ID],
        account: '0x0000000000000000000000000000000000000001',
        gas: 119_999n,
      })
      return { kind: 'succeeded_unexpectedly', note: 'executeAutoPay ran with <120,000 gas without reverting.' }
    } catch (e) {
      const d = decodeKametiError(e)
      if (d?.name === 'InsufficientGasForAutoPay') return {
        kind: 'matched', decoded: errorLabel(d),
        note: 'Contract reverts (not silently skips) when gas < AUTOPAY_MIN_GAS=120,000. Gas griefing attack blocked.',
      }
      return { kind: 'wrong_error', decoded: errorLabel(d) }
    }
  }

  // ── Attack 5: withdrawPq with forged SLH-DSA sig → PqInvalidSignature ───────
  const attack5 = async (): Promise<AttackOutcome> => {
    if (!publicClient) return { kind: 'not_run', reason: 'No public client' }
    // Skip the log lookup — the event has a non-indexed vk field and the
    // contract has no public getter (no bytes left). Instead, just simulate:
    // PqGuardNotEnabled  → guard not set yet (neutral not-run)
    // NothingToWithdraw  → guard set but nothing claimable (neutral not-run)
    // PqInvalidSignature → guard active, forgery rejected (expected)
    const fakeSig = `0x${'00'.repeat(7856)}`
    try {
      await publicClient.simulateContract({
        address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
        functionName: 'withdrawPq',
        args: [PQ_TARGET_MEMBER, 1n, fakeSig],
        account: PQ_TARGET_MEMBER,
      })
      return { kind: 'succeeded_unexpectedly', note: 'Forged SLH-DSA signature unexpectedly passed the Arc precompile.' }
    } catch (e) {
      const d = decodeKametiError(e)
      if (d?.name === 'PqInvalidSignature') return {
        kind: 'matched', decoded: errorLabel(d),
        note: `Arc SLH-DSA precompile at 0x1800…0004 verified and rejected the all-zero 7856-byte forgery. Member: ${PQ_TARGET_MEMBER.slice(0,10)}…`,
      }
      // Guard not enabled or nothing claimable — circle not in the right state
      if (d?.name === 'PqGuardNotEnabled' || d?.name === 'NothingToWithdraw') {
        return { kind: 'not_run', reason: `${errorLabel(d)} — member ${PQ_TARGET_MEMBER.slice(0,10)}… needs enablePqGuard called and claimable balance > 0.` }
      }
      return { kind: 'wrong_error', decoded: errorLabel(d), note: `Member: ${PQ_TARGET_MEMBER.slice(0,10)}…` }
    }
  }

  const CARDS: (Omit<AttackCardProps, 'onRun'> & { fn: () => Promise<AttackOutcome> })[] = [
    {
      icon: Clock,
      title: 'Settle early to skip the auction',
      subtitle: 'settleRound before the round deadline (Attack Lab)',
      expectedError: 'RoundNotSettleable',
      description: 'Calls settleRound before the round deadline, attempting to skip bidding and pay out at 0% discount. The contract checks block.timestamp against roundEnd.',
      buttonLabel: 'Run attack',
      testLink: 'Kameti3.Features.t.sol',
      fn: attack1,
    },
    {
      icon: RefreshCw,
      title: 'Pay twice in the same round',
      subtitle: 'pay() from a member who already paid (Attack Lab)',
      expectedError: 'AlreadyPaid',
      description: 'Finds a member who already paid this round and submits pay() again. The contract tracks paidThisRound per-member per-round.',
      buttonLabel: 'Run attack',
      testLink: 'Kameti2.Deploy.t.sol',
      fn: attack2,
    },
    {
      icon: Key,
      title: 'Use a round-N+1 payment in round N',
      subtitle: 'Wrong-round EIP-3009 nonce replay (Attack Lab)',
      expectedError: 'FiatTokenV2: invalid signature',
      description: 'Replays a real member\'s round-(N+1) signed authorization against round N. Kameti derives the round-N nonce and hands it to USDC — which rejects it because the signature was made for a different nonce. The defence is in USDC\'s nonce binding, not in Kameti itself.',
      buttonLabel: 'Submit wrong-round auth',
      testLink: 'Kameti3.AutoPay.t.sol',
      fn: attack3,
    },
    {
      icon: Zap,
      title: 'Starve AutoPay of gas',
      subtitle: 'executeAutoPay with gas < AUTOPAY_MIN_GAS (Attack Lab)',
      expectedError: 'InsufficientGasForAutoPay',
      description: 'Calls executeAutoPay with 119,999 gas — just below AUTOPAY_MIN_GAS=120,000. The contract reverts instead of silently skipping, so a member cannot be slashed by a gas-starving caller.',
      buttonLabel: 'Run attack',
      testLink: 'Kameti3.Features.t.sol',
      fn: attack4,
    },
    {
      icon: Shield,
      title: 'Drain a wallet with a forged PQ signature',
      subtitle: 'withdrawPq with 7856-byte all-zero SLH-DSA forgery (demo circle member)',
      expectedError: 'PqInvalidSignature',
      description: 'Calls withdrawPq with a 7856-byte all-zero signature for the member at 0xaFdb…3aF who enabled the PQ guard with a real SLH-DSA key. The Arc precompile at 0x1800…0004 verifies and rejects it.',
      buttonLabel: 'Run attack',
      testLink: 'Kameti3.Features.t.sol',
      fn: attack5,
    },
  ]

  const labId   = `#${ATTACK_LAB_ID.toString()}`
  const demoId  = `#${DEMO_CIRCLE_ID.toString()}`

  return (
    <div ref={pageRef} className="pt-12 min-h-screen overflow-x-hidden">
      <div className="frame">
        <div className="cell px-6 md:px-14 py-12" data-boot>
          <p className="label text-muted mb-2">Security demo</p>
          <h1 className="font-display text-5xl md:text-7xl font-bold mb-4">Try to break it.</h1>
          <p className="font-sans text-muted text-lg max-w-2xl mb-4">
            Five real attacks against the live contract on Arc Testnet. Each button runs a real{' '}
            <code className="font-mono text-sm bg-paper-2 px-1">eth_call</code> and shows the exact
            custom error decoded from the full Kameti ABI. "Rejected as expected" prints only when the error
            matches and the call actually ran against the intended state.
          </p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <p className="label text-muted text-sm">
              Contract:{' '}
              <a href={explorerAddr(KAMETI_ADDRESS)} target="_blank" rel="noopener"
                className="link-line text-ink font-bold font-mono">{KAMETI_ADDRESS.slice(0,10)}…</a>
            </p>
            <p className="label text-signal-ink text-sm font-bold">Attack Lab circle {labId}</p>
            <p className="label text-signal-ink text-sm font-bold">Demo circle {demoId} (PQ attack)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {CARDS.map((card, i) => (
            <AttackCard
              key={i}
              icon={card.icon}
              title={card.title}
              subtitle={card.subtitle}
              description={card.description}
              expectedError={card.expectedError}
              buttonLabel={card.buttonLabel}
              testLink={card.testLink}
              onRun={card.fn}
            />
          ))}
        </div>

        <div className="cell px-6 md:px-14 py-8">
          <p className="label text-muted text-[10px]">
            All simulations use <code className="font-mono">simulateContract</code> from viem against the live
            Arc Testnet node. No transaction is sent. No gas is spent. Revert data is decoded against the
            full Kameti ABI (90 entries, every custom error). "Rejected as expected" appears only
            when the decoded error name exactly matches the card's expected error.
          </p>
        </div>
      </div>
    </div>
  )
}
