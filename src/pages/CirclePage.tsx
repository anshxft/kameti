import { useParams } from 'react-router-dom'
import { useRef, useState, useEffect, useCallback } from 'react'
import {
  useAccount, useReadContract, useWriteContract,
  useWaitForTransactionReceipt, useSwitchChain, usePublicClient,
} from 'wagmi'
import { parseAbiItem, type Hex } from 'viem'
import { toast } from 'sonner'
import { Copy, ExternalLink, ChevronUp, Loader2, Zap, ZapOff, Play } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import NumberFlow from '@number-flow/react'
import { useBoot } from '@/motion'
import {
  KAMETI_ADDRESS, KAMETI_ABI, CHAIN_ID,
  formatAddress, formatUsdc, formatCountdown, explorerTx, explorerAddr,
} from '@/lib/contract'
import { friendlyError } from '@/lib/errors'
import { buildShareLink } from '@/lib/share'
import { useEip3009Sign } from '@/hooks/useEip3009'
import { useInrRate } from '@/hooks/useLiveData'
import type { KametiCircle, MemberInfo, RoundRecord } from '@/lib/types'

// ─── helpers ─────────────────────────────────────────────────────────────────
const STATUS_LABELS = ['OPEN', 'ACTIVE', 'COMPLETED'] as const
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

function ScoreBadge({ score }: { score: number }) {
  const tier = score >= 750 ? 'EXCELLENT' : score >= 650 ? 'GOOD' : score >= 550 ? 'FAIR' : 'POOR'
  const bg   = score >= 650 ? 'bg-ink text-paper' : score >= 550 ? 'border border-line text-muted' : 'border border-signal-ink/50 text-signal-ink'
  return <span className={`label px-1.5 py-0.5 text-[9px] shrink-0 ${bg}`}>{score} {tier}</span>
}

// ─── Deposit + lock bar ───────────────────────────────────────────────────────
function ProtBar({ depositLeft, lockLeft, depositTotal, contribution, postWinLockBps }: {
  depositLeft: bigint; lockLeft: bigint; depositTotal: number
  contribution: bigint; postWinLockBps: number
}) {
  const dep  = Number(depositLeft) / 1e6
  const lock = Number(lockLeft) / 1e6
  const pct  = depositTotal > 0 ? Math.round((dep / depositTotal) * 100) : 0
  const lockTotal = Number(contribution) / 1e6 * postWinLockBps / 10000

  return (
    <div className="mt-2 space-y-1.5">
      <div>
        <div className="flex justify-between mb-0.5">
          <span className="label text-[9px] text-muted">DEPOSIT</span>
          <span className="label text-[9px] text-muted">{pct}%</span>
        </div>
        <div className="h-0.5 bg-line w-full">
          <div className="h-full bg-signal transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {lock > 0 && lockTotal > 0 && (
        <div>
          <div className="flex justify-between mb-0.5">
            <span className="label text-[9px] text-muted">POST-WIN LOCK</span>
            <span className="label text-[9px] text-muted">{Math.round((lock / lockTotal) * 100)}%</span>
          </div>
          <div className="h-0.5 bg-line w-full">
            <div className="h-full bg-signal-ink transition-all" style={{ width: `${Math.min(100, Math.round((lock / lockTotal) * 100))}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Member cell ──────────────────────────────────────────────────────────────
function MemberCell({
  m, isYou, depositTotal, score, contribution, postWinLockBps,
}: {
  m: MemberInfo; isYou: boolean; depositTotal: number; score: number | undefined
  contribution: bigint; postWinLockBps: number
}) {
  const statusBlock = () => {
    if (m.defaulted) return <span className="label px-2 py-0.5 border border-line text-muted line-through">DEFAULTED{m.debt > 0n ? ` -${formatUsdc(m.debt)}` : ''}</span>
    if (m.won)       return <span className="label px-2 py-0.5 bg-ink text-paper">WON R{m.wonRound}</span>
    if (m.paidThisRound) return <span className="label px-2 py-0.5 bg-signal text-on-signal">PAID</span>
    return <span className="label px-2 py-0.5 border border-line text-muted">PENDING</span>
  }

  return (
    <div className={`cell p-4 flex flex-col gap-2 ${isYou ? 'bg-paper-2' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="font-display text-3xl font-bold">{m.seat}</span>
        <div className="flex items-center gap-1">
          {m.hasStoredAuth && <span className="label px-1.5 py-0.5 bg-signal text-on-signal text-[9px]">AUTO</span>}
          {m.won && m.lockLeft > 0n && <span className="label px-1.5 py-0.5 bg-signal-ink text-paper text-[9px]">LOCKED</span>}
        </div>
      </div>
      <span className="label font-bold truncate">{isYou ? 'YOU' : formatAddress(m.addr)}</span>
      {score !== undefined && <ScoreBadge score={score} />}
      {statusBlock()}
      <ProtBar
        depositLeft={m.depositLeft}
        lockLeft={m.lockLeft ?? 0n}
        depositTotal={depositTotal}
        contribution={contribution}
        postWinLockBps={postWinLockBps}
      />
    </div>
  )
}

// ─── Bid feed ─────────────────────────────────────────────────────────────────
interface BidEntry { bidder: string; discount: bigint; block: bigint }

function DiscountChart({ history }: { history: RoundRecord[] }) {
  if (history.length === 0) return null
  const max = Math.max(...history.map(r => Number(r.discount))) || 1
  return (
    <div className="flex items-end gap-1 h-12">
      {history.map((r, i) => {
        const h = max > 0 ? Math.max(4, Math.round((Number(r.discount) / max) * 48)) : 4
        return (
          <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <div className="bg-signal transition-all w-full" style={{ height: `${h}px` }} />
            <span className="label text-[8px] text-muted truncate w-full text-center">{i + 1}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── AutoPay section ──────────────────────────────────────────────────────────
function AutoPaySection({
  circleId, isMember, me, maxMembers, currentRound, contribution, isPending, tx,
  onStore,
}: {
  circleId: bigint; isMember: boolean; me: MemberInfo | undefined
  maxMembers: number; currentRound: number; contribution: bigint
  isPending: boolean; tx: (fn: string, args: unknown[], label: string) => void
  onStore: () => void
}) {
  const hasAuth = me?.hasStoredAuth ?? false
  const roundsLeft = maxMembers - currentRound + 1

  return (
    <div className="flex flex-col gap-2">
      <p className="label text-muted mb-1">AutoPay</p>
      {isMember && !hasAuth && (
        <div className="cell p-4 border border-signal-ink/20">
          <p className="label text-sm mb-2">Pre-sign your remaining payments once. No gas each round.</p>
          <p className="label text-muted text-[10px] mb-3">
            Sign {roundsLeft} payment{roundsLeft !== 1 ? 's' : ''} — one signature each ({formatUsdc(contribution)} USDC each round).
            Then one transaction to store them onchain.
          </p>
          <button
            onClick={onStore}
            disabled={isPending}
            className="press cell py-2 px-4 bg-signal text-on-signal border border-ink label font-bold flex items-center gap-2 disabled:opacity-40 hover:bg-signal-hover"
          >
            <Zap size={12} />
            {isPending ? <><Loader2 size={12} className="animate-spin" /> Storing…</> : `Turn on AutoPay (sign ${roundsLeft})`}
          </button>
        </div>
      )}
      {isMember && hasAuth && (
        <div className="cell p-4 border border-signal/30 bg-signal/5">
          <div className="flex items-center gap-2 mb-2">
            <span className="label px-2 py-0.5 bg-signal text-on-signal text-[9px]">AUTO ON</span>
            <span className="label text-muted text-[10px]">Payments pre-signed</span>
          </div>
          <button
            onClick={() => tx('revokeAutoPay', [circleId], 'AutoPay off')}
            disabled={isPending}
            className="press cell py-2 px-4 border border-line label text-muted flex items-center gap-2 disabled:opacity-40"
          >
            <ZapOff size={12} /> Turn off AutoPay
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CirclePage() {
  const { id } = useParams<{ id: string }>()
  const pageRef = useRef<HTMLDivElement>(null)
  useBoot(pageRef)

  const circleId = BigInt(id ?? '0')
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { signRoundAuth, signDepositAuth } = useEip3009Sign()
  const inrRate = useInrRate()

  const [shareUrl, setShareUrl]         = useState('')
  const [bidAmount, setBidAmount]       = useState('')
  const [bidFeed, setBidFeed]           = useState<BidEntry[]>([])
  const [memberScores, setMemberScores] = useState<Record<string, number>>({})
  const [myClaimable, setMyClaimable]   = useState<bigint>(0n)
  const [isSigning, setIsSigning]       = useState(false)

  useEffect(() => { void buildShareLink(`/k/${id}`).then(setShareUrl) }, [id])

  // ── Contract reads ────────────────────────────────────────────────────────
  const { data: rawCircle, refetch: refetchCircle } = useReadContract({
    address: KAMETI_ADDRESS, abi: KAMETI_ABI,
    functionName: 'getCircle', args: [circleId], chainId: CHAIN_ID,
  })
  const { data: rawMembers, refetch: refetchMembers } = useReadContract({
    address: KAMETI_ADDRESS, abi: KAMETI_ABI,
    functionName: 'getMembers', args: [circleId], chainId: CHAIN_ID,
  })
  const { data: rawHistory } = useReadContract({
    address: KAMETI_ADDRESS, abi: KAMETI_ABI,
    functionName: 'getRoundHistory', args: [circleId], chainId: CHAIN_ID,
  })

  const circle  = rawCircle as [KametiCircle['params'], number, number, bigint, bigint, string, bigint] | undefined
  const members = (rawMembers ?? []) as MemberInfo[]
  const memberAddrs = members.map(m => m.addr).join(',')
  const n       = members.length
  const history = (rawHistory ?? []) as RoundRecord[]

  const params         = circle?.[0]
  const status         = circle?.[1] ?? 0
  const currentRound   = circle?.[2] ?? 0
  const roundEnd       = Number(circle?.[3] ?? 0n)
  const highestBidder  = circle?.[5] ?? ''
  const highestDiscount = circle?.[6] ?? 0n

  const maxMembers     = Number(params?.maxMembers ?? 0)
  const contribution   = params?.contribution ?? 0n
  const maxDiscountBps = Number(params?.maxDiscountBps ?? 0)
  const depositMul     = Number(params?.depositMultiplier ?? 1)
  const postWinLockBps = Number(params?.postWinLockBps ?? 0)
  const keeperTipBps   = Number(params?.keeperTipBps ?? 0)

  const pot  = contribution * BigInt(n || 1)
  const depositTotal = Number(contribution) / 1e6 * depositMul

  const myIdx      = address ? members.findIndex(m => m.addr.toLowerCase() === address.toLowerCase()) : -1
  const isMember   = myIdx >= 0
  const me         = isMember ? members[myIdx] : undefined
  const alreadyPaid = me?.paidThisRound ?? false

  const minNextBid = Number(highestDiscount) + Math.max(1, Number(pot) / 100)
  const maxBid     = Number(pot) * maxDiscountBps / 10000
  const canBid     = isMember && !!me && alreadyPaid && !me.won && !me.defaulted

  const eligibleCount = members.filter(m => !m.won && !m.defaulted).length
  const bidReason = !isMember ? 'not a member' :
    !alreadyPaid ? 'pay first to bid' :
    me?.won ? 'you already won' :
    me?.defaulted ? 'defaulted — not eligible' :
    eligibleCount <= 1 ? 'last eligible — takes pot at 0' : null

  const [nowSec, setNowSec] = useState(() => Math.floor(performance.timeOrigin / 1000 + performance.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(performance.timeOrigin / 1000 + performance.now() / 1000)), 5000)
    return () => clearInterval(t)
  }, [])
  const roundActive = status === 1
  const payPhase    = roundActive && nowSec < roundEnd
  const bidPhase    = roundActive && nowSec < roundEnd
  const settlePhase = roundActive && nowSec >= roundEnd

  // Keeper tip amount
  const keeperTip = keeperTipBps > 0 ? Number(pot) * keeperTipBps / 10000 / 1e6 : 0

  // ── Fetch bid events ──────────────────────────────────────────────────────
  const fetchBids = useCallback(async () => {
    if (!publicClient || !roundActive) return
    try {
      const logs = await publicClient.getLogs({
        address: KAMETI_ADDRESS,
        event: parseAbiItem('event BidPlaced(uint256 indexed id, uint8 round, address indexed bidder, uint256 discount)'),
        args: { id: circleId },
        fromBlock: 'earliest', toBlock: 'latest',
      })
      setBidFeed(
        logs.filter(l => l.args.round === currentRound)
            .map(l => ({ bidder: l.args.bidder ?? '', discount: l.args.discount ?? 0n, block: l.blockNumber ?? 0n }))
            .reverse().slice(0, 10)
      )
    } catch { /* ignore */ }
  }, [publicClient, circleId, currentRound, roundActive])

  // ── Fetch member scores + claimable ──────────────────────────────────────
  const fetchScores = useCallback(async () => {
    if (!publicClient || !memberAddrs) return
    const addrs = memberAddrs.split(',').filter(Boolean)
    const scores: Record<string, number> = {}
    await Promise.all(addrs.map(async (addr) => {
      try {
        const s = await publicClient.readContract({
          address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
          functionName: 'scoreOf', args: [addr],
        }) as number
        scores[addr.toLowerCase()] = Number(s)
      } catch { /* ignore */ }
    }))
    setMemberScores(scores)
  }, [publicClient, memberAddrs])

  const fetchClaimable = useCallback(async () => {
    if (!publicClient || !address) return
    try {
      const c = await publicClient.readContract({
        address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
        functionName: 'claimable', args: [address],
      }) as bigint
      setMyClaimable(c)
    } catch { /* ignore */ }
  }, [publicClient, address])

  useEffect(() => {
    let alive = true
    fetchBids().then(() => { if (!alive) return }).catch(() => null)
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchBids])
  useEffect(() => {
    let alive = true
    fetchScores().then(() => { if (!alive) return }).catch(() => null)
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchScores])
  useEffect(() => {
    let alive = true
    fetchClaimable().then(() => { if (!alive) return }).catch(() => null)
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchClaimable])

  // ── Transactions ──────────────────────────────────────────────────────────
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash })

  useEffect(() => {
    if (!txSuccess) return
    refetchCircle().catch(() => null)
    refetchMembers().catch(() => null)
    fetchBids().catch(() => null)
    fetchClaimable().catch(() => null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txSuccess])

  const isWrongChain = address && chainId !== CHAIN_ID

  const tx = (fn: string, args: unknown[], label: string) => {
    if (!address) { toast.error('Connect your wallet'); return }
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    writeContract(
      { address: KAMETI_ADDRESS, abi: KAMETI_ABI, functionName: fn, args, chainId: CHAIN_ID },
      {
        onSuccess: (h) => toast.success(`${label} confirmed!`, {
          description: <a href={explorerTx(h)} target="_blank" rel="noopener" className="underline label">View tx →</a>,
        }),
        onError: (e) => toast.error(friendlyError(e)),
      }
    )
  }

  // ── Join with EIP-3009 deposit authorization ──────────────────────────────
  const handleJoin = async () => {
    if (!address) { toast.error('Connect your wallet'); return }
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    if (!publicClient) { toast.error('Client not ready'); return }
    const depositRaw = contribution * BigInt(depositMul)
    setIsSigning(true)
    try {
      toast.info('Sign the deposit authorization in your wallet…')
      const sig = await signDepositAuth(circleId, depositRaw)
      toast.info('Submitting join transaction…')
      writeContract(
        {
          address: KAMETI_ADDRESS, abi: KAMETI_ABI,
          functionName: 'joinWithAuthorization',
          args: [circleId, depositRaw, 0n, sig.validBefore, sig.nonce, sig.v, sig.r, sig.s],
          chainId: CHAIN_ID,
        },
        {
          onSuccess: (h) => toast.success('Joined!', {
            description: <a href={explorerTx(h)} target="_blank" rel="noopener" className="underline label">View tx →</a>,
          }),
          onError: (e) => toast.error(friendlyError(e)),
        }
      )
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setIsSigning(false)
    }
  }

  // ── Pay this round with EIP-3009 ──────────────────────────────────────────
  const handlePay = async () => {
    if (!address) { toast.error('Connect your wallet'); return }
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    setIsSigning(true)
    try {
      toast.info('Sign the round payment in your wallet…')
      const sig = await signRoundAuth(circleId, currentRound, contribution)
      toast.info('Submitting payment…')
      writeContract(
        {
          address: KAMETI_ADDRESS, abi: KAMETI_ABI,
          functionName: 'payWithAuthorization',
          args: [circleId, 0n, sig.validBefore, sig.nonce, sig.v, sig.r, sig.s],
          chainId: CHAIN_ID,
        },
        {
          onSuccess: (h) => toast.success('Paid!', {
            description: <a href={explorerTx(h)} target="_blank" rel="noopener" className="underline label">View tx →</a>,
          }),
          onError: (_e) => {
            // Fallback: plain pay()
            toast.warning('EIP-3009 rejected — trying plain pay()…')
            tx('pay', [circleId], 'Paid')
          },
        }
      )
    } catch {
      toast.warning('Signing failed — trying plain pay()…')
      tx('pay', [circleId], 'Paid')
    } finally {
      setIsSigning(false)
    }
  }

  // ── Store AutoPay authorizations ──────────────────────────────────────────
  const handleStoreAutoPay = async () => {
    if (!address) { toast.error('Connect your wallet'); return }
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    setIsSigning(true)
    try {
      const roundsLeft = maxMembers - currentRound + 1
      const sigs: { validBefore: bigint; nonce: Hex; v: number; r: Hex; s: Hex }[] = []
      for (let r = currentRound; r <= maxMembers; r++) {
        toast.info(`Sign payment ${r - currentRound + 1} of ${roundsLeft}…`)
        const sig = await signRoundAuth(circleId, r, contribution)
        sigs.push({ validBefore: sig.validBefore, nonce: sig.nonce, v: sig.v, r: sig.r, s: sig.s })
      }
      toast.info('Storing authorizations onchain…')
      writeContract(
        {
          address: KAMETI_ADDRESS, abi: KAMETI_ABI,
          functionName: 'storeAuthorizations',
          args: [
            circleId,
            sigs.map(s => s.validBefore),
            sigs.map(s => s.nonce),
            sigs.map(s => s.v),
            sigs.map(s => s.r),
            sigs.map(s => s.s),
          ],
          chainId: CHAIN_ID,
        },
        {
          onSuccess: (h) => toast.success('AutoPay active!', {
            description: <a href={explorerTx(h)} target="_blank" rel="noopener" className="underline label">View tx →</a>,
          }),
          onError: (e) => toast.error(friendlyError(e)),
        }
      )
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setIsSigning(false)
    }
  }

  if (!circle) {
    return (
      <div className="pt-12 min-h-screen flex items-center justify-center">
        <span className="label text-muted">Loading circle…</span>
      </div>
    )
  }

  const roundProgress = status === 1 && maxMembers > 0 ? ((currentRound - 1) / maxMembers) * 100 : 0
  const circleName    = params?.name ?? `Circle #${id}`
  const inrPot        = inrRate > 0 ? Number(pot) / 1e6 * inrRate : null

  return (
    <div ref={pageRef} className="pt-12 min-h-screen overflow-x-hidden">
      <div className="frame">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="cell p-6 md:p-10 grid grid-cols-1 md:grid-cols-2 gap-6 items-start" data-boot>
          <div>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className={`label px-2 py-0.5 shrink-0 ${status === 0 ? 'border border-line text-muted' : status === 1 ? 'bg-signal text-on-signal border border-ink' : 'bg-ink text-paper'}`}>
                {status === 1 ? `ROUND ${currentRound} OF ${maxMembers}` : STATUS_LABELS[status] ?? 'UNKNOWN'}
              </span>
              <span className="label text-muted">#{id}</span>
              {params?.minScore ? <span className="label text-muted">Score ≥{params.minScore}</span> : null}
              {keeperTipBps > 0 && <span className="label text-muted">Keeper {keeperTipBps / 100}%</span>}
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-bold">{circleName}</h1>
            <p className="label text-muted mt-2">{n}/{maxMembers} members · {depositMul}× deposit · {postWinLockBps / 100}% post-win lock</p>
          </div>
          <div className="flex flex-col items-start md:items-end gap-2">
            <p className="label text-muted">Pot this round</p>
            <p className="font-display text-5xl md:text-6xl font-bold">
              <NumberFlow value={Number(pot) / 1e6} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
            </p>
            <p className="label text-muted">
              USDC{inrPot ? ` · ≈ ₹${inrPot.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : ''}
            </p>
          </div>
        </div>

        {/* ── Phase strip + progress ────────────────────────────────────── */}
        {status === 1 && (
          <div className="cell px-6 py-4" data-boot>
            <div className="flex items-center gap-0 mb-4">
              {(['PAY', 'BID', 'SETTLE'] as const).map((phase, i) => {
                const active = (phase === 'PAY' && payPhase) || (phase === 'BID' && bidPhase) || (phase === 'SETTLE' && settlePhase)
                return (
                  <div key={phase} className={`cell px-4 py-2 label flex-1 text-center ${active ? 'bg-signal text-on-signal border-r border-ink' : 'text-muted'}`}>
                    {i + 1}. {phase}
                  </div>
                )
              })}
              <div className="cell px-4 py-2 label text-muted text-right shrink-0">
                {formatCountdown(roundEnd)}
              </div>
            </div>
            <div className="h-0.5 bg-line w-full relative">
              <div className="absolute left-0 top-0 h-full bg-signal transition-all duration-700"
                style={{ width: `${roundProgress}%` }} />
            </div>
          </div>
        )}

        {/* ── Auction panel ─────────────────────────────────────────────── */}
        {status === 1 && (
          <div className="cell p-6 md:p-10" data-boot>
            <p className="label text-muted mb-4">Auction · Round {currentRound}</p>
            <div className="frame grid grid-cols-1 md:grid-cols-2 gap-0">
              <div className="cell p-6 flex flex-col gap-3">
                {highestBidder && highestBidder !== ZERO_ADDR ? (
                  <>
                    <div>
                      <p className="label text-muted mb-1">Highest Bid</p>
                      <p className="font-display text-4xl font-bold text-signal-ink">
                        <NumberFlow value={Number(highestDiscount) / 1e6} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} /> USDC
                      </p>
                      <p className="label text-muted mt-1">
                        by {address && highestBidder.toLowerCase() === address.toLowerCase() ? 'YOU' : formatAddress(highestBidder)}
                      </p>
                    </div>
                    <div className="border-t border-line pt-3 space-y-1">
                      <div className="flex justify-between">
                        <span className="label text-muted">Winner receives</span>
                        <span className="label font-bold">
                          <NumberFlow value={(Number(pot) - Number(highestDiscount)) / 1e6}
                            format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} /> USDC
                        </span>
                      </div>
                      {n > 1 && (
                        <div className="flex justify-between">
                          <span className="label text-muted">Each other earns</span>
                          <span className="label text-signal-ink font-bold">
                            +<NumberFlow value={Number(highestDiscount) / 1e6 / (n - 1)}
                              format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} /> USDC
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div>
                    <p className="label text-muted mb-2">No bids yet</p>
                    <p className="label text-muted">Lowest seat wins at 0% discount unless someone bids.</p>
                  </div>
                )}
              </div>

              <div className="cell p-6 flex flex-col gap-4">
                {eligibleCount <= 1 ? (
                  <p className="label text-muted">Only one eligible winner — no auction this round.</p>
                ) : canBid && !settlePhase ? (
                  <>
                    <div>
                      <p className="label text-muted mb-2">Your Bid (USDC discount)</p>
                      <div className="flex gap-0">
                        <input
                          type="number" value={bidAmount}
                          onChange={e => setBidAmount(e.target.value)}
                          placeholder={(minNextBid / 1e6).toFixed(2)}
                          min={0} step={0.01}
                          className="flex-1 bg-transparent border border-line px-4 py-3 font-display text-2xl font-bold focus:border-ink outline-none"
                        />
                        <div className="cell px-3 flex items-center label text-muted">USDC</div>
                      </div>
                      <p className="label text-muted mt-1 text-[10px]">
                        Min next: {(minNextBid / 1e6).toFixed(2)} · Cap: {(maxBid / 1e6).toFixed(2)}
                      </p>
                    </div>
                    <div className="flex gap-0">
                      {[1, 5].map(pct => (
                        <button key={pct}
                          onClick={() => setBidAmount(((minNextBid + Number(pot) * pct / 100) / 1e6).toFixed(2))}
                          className="press cell px-4 py-2 label text-muted hover:bg-paper-2">+{pct}%</button>
                      ))}
                      <button
                        onClick={() => setBidAmount((maxBid / 1e6).toFixed(2))}
                        className="press cell px-4 py-2 label text-muted hover:bg-paper-2">MAX</button>
                    </div>
                    <button
                      onClick={() => {
                        const d = Math.round(parseFloat(bidAmount) * 1e6)
                        if (!d || isNaN(d)) { toast.error('Enter a bid amount'); return }
                        tx('placeBid', [circleId, BigInt(d)], 'Bid')
                      }}
                      disabled={isPending}
                      className="press cell py-3 px-6 bg-ink text-paper label font-bold flex items-center justify-center gap-2 disabled:opacity-40">
                      <ChevronUp size={14} /> {isPending ? 'Confirm…' : 'Place Bid'}
                    </button>
                  </>
                ) : (
                  <p className="label text-muted">
                    {bidReason ? `Can't bid: ${bidReason}.` : settlePhase ? 'Bidding closed — settle the round.' : ''}
                  </p>
                )}

                {bidFeed.length > 0 && (
                  <div className="border-t border-line pt-3">
                    <p className="label text-muted mb-2 text-[10px]">Recent Bids</p>
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {bidFeed.map((b, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="label text-muted text-[10px] flex-1 truncate">
                            {address && b.bidder.toLowerCase() === address.toLowerCase() ? 'YOU' : formatAddress(b.bidder)}
                          </span>
                          <span className="label font-bold text-[11px]">{formatUsdc(b.discount)} USDC</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Member grid ──────────────────────────────────────────────────── */}
        <div className="cell p-4">
          <p className="label text-muted mb-3 px-2">Members</p>
          <div className="frame grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: maxMembers }, (_, i) => {
              const m = members[i]
              if (!m) {
                return (
                  <div key={i} className="cell p-4 flex flex-col gap-1">
                    <span className="font-display text-3xl font-bold text-muted">{i + 1}</span>
                    <span className="label text-muted mt-1">OPEN SEAT</span>
                  </div>
                )
              }
              return (
                <MemberCell key={i} m={m}
                  isYou={!!address && m.addr.toLowerCase() === address.toLowerCase()}
                  depositTotal={depositTotal}
                  score={memberScores[m.addr.toLowerCase()]}
                  contribution={contribution}
                  postWinLockBps={postWinLockBps}
                />
              )
            })}
          </div>
        </div>

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        <div className="cell p-6 md:p-10 grid grid-cols-1 md:grid-cols-3 gap-8" data-boot>

          <div className="flex flex-col gap-3 md:col-span-2">
            <p className="label text-muted mb-1">Actions</p>
            {!address && <p className="label text-muted">Connect your wallet to interact.</p>}
            {isWrongChain && (
              <button onClick={() => switchChain({ chainId: CHAIN_ID })}
                className="press cell py-3 px-6 bg-signal text-on-signal border border-ink label">Switch to Arc Testnet</button>
            )}

            {/* Join */}
            {address && status === 0 && !isMember && (
              <button
                onClick={() => { void handleJoin() }}
                disabled={isPending || isSigning}
                className="press cell py-3 px-6 bg-signal text-on-signal border border-ink label font-bold flex items-center justify-center gap-2 hover:bg-signal-hover disabled:opacity-40">
                {isSigning ? <><Loader2 size={14} className="animate-spin" /> Sign deposit…</> :
                 isPending ? 'Confirm…' :
                 `Join — sign ${formatUsdc(contribution * BigInt(depositMul))} USDC deposit`}
              </button>
            )}
            {address && status === 0 && isMember && (
              <>
                <p className="label text-muted">You're in. Waiting for {maxMembers - n} more member{maxMembers - n !== 1 ? 's' : ''}.</p>
                <button onClick={() => tx('leave', [circleId], 'Left')}
                  disabled={isPending}
                  className="press cell py-3 px-6 border border-line label text-muted disabled:opacity-40">
                  {isPending ? 'Confirm…' : 'Leave & Reclaim Deposit'}
                </button>
              </>
            )}

            {/* Pay this round */}
            {address && status === 1 && isMember && !alreadyPaid && !me?.defaulted && (
              <button
                onClick={() => { void handlePay() }}
                disabled={isPending || isSigning}
                className="press cell py-3 px-6 bg-signal text-on-signal border border-ink label font-bold flex items-center justify-center gap-2 hover:bg-signal-hover disabled:opacity-40">
                {isSigning ? <><Loader2 size={14} className="animate-spin" /> Sign payment…</> :
                 isPending ? 'Confirm…' :
                 `Pay ${formatUsdc(contribution)} USDC this round`}
              </button>
            )}
            {address && status === 1 && isMember && alreadyPaid && !me?.won && (
              <p className="label px-2 py-1 border border-signal/40 bg-signal/5 text-muted">
                Paid this round — waiting for others or auction end.
              </p>
            )}

            {/* Settle — anyone can call, shows keeper tip */}
            {address && status === 1 && (
              <button onClick={() => tx('settleRound', [circleId], 'Round settled')}
                disabled={isPending}
                className="press cell py-3 px-6 border border-ink label flex items-center gap-2 disabled:opacity-40">
                <Play size={12} />
                {isPending ? 'Confirm…' : `Settle Round${keeperTip > 0 ? ` (earn ${keeperTip.toFixed(4)} USDC tip)` : ' (anyone can call after deadline)'}`}
              </button>
            )}

            {/* Run AutoPay for everyone */}
            {address && status === 1 && (
              <button onClick={() => tx('executeAutoPay', [circleId], 'AutoPay executed')}
                disabled={isPending}
                className="press cell py-3 px-6 border border-line label text-muted flex items-center gap-2 disabled:opacity-40">
                <Zap size={12} />
                {isPending ? 'Confirm…' : 'Run AutoPay for Everyone (execute stored auths)'}
              </button>
            )}
          </div>

          {/* My balance + AutoPay + withdraw */}
          <div className="flex flex-col gap-4">
            <p className="label text-muted mb-1">My Balance</p>
            <div className="cell p-5">
              <p className="label text-muted mb-1">Claimable</p>
              <p className="font-display text-3xl font-bold">
                <NumberFlow value={Number(myClaimable) / 1e6} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
              </p>
              <p className="label text-muted">
                USDC{inrRate > 0 && myClaimable > 0n ? ` · ≈ ₹${(Number(myClaimable) / 1e6 * inrRate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : ''}
              </p>
            </div>
            {myClaimable > 0n && (
              <button onClick={() => tx('withdraw', [], 'Withdrawn')}
                disabled={isPending}
                className="press cell py-3 px-6 bg-signal text-on-signal border border-ink label font-bold disabled:opacity-40 hover:bg-signal-hover">
                {isPending ? 'Confirm…' : `Withdraw ${formatUsdc(myClaimable)} USDC`}
              </button>
            )}

            {/* Protection summary for won members */}
            {me?.won && (me.lockLeft ?? 0n) > 0n && (
              <div className="cell p-4 border border-signal-ink/20">
                <p className="label text-muted mb-1 text-[10px]">POST-WIN LOCK ACTIVE</p>
                <p className="label text-ink font-bold">{formatUsdc(me.lockLeft ?? 0n)} USDC</p>
                <p className="label text-muted text-[10px] mt-0.5">released when you pay each future round on time</p>
              </div>
            )}

            {/* AutoPay section */}
            {isMember && status === 1 && (
              <AutoPaySection
                circleId={circleId} isMember={isMember} me={me}
                maxMembers={maxMembers} currentRound={currentRound} contribution={contribution}
                isPending={isPending || isSigning} tx={tx}
                onStore={() => { void handleStoreAutoPay() }}
              />
            )}
          </div>
        </div>

        {/* ── Round history ─────────────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="cell p-6 md:p-10" data-boot>
            <p className="label text-muted mb-4">Round History</p>
            <div className="frame overflow-x-auto">
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="border-b border-line">
                    {['Round', 'Winner', 'Pot', 'Discount', 'Dividend each'].map(h => (
                      <th key={h} className="label text-muted text-left px-3 py-2 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((r, i) => (
                    <tr key={i} className="border-b border-line hover:bg-paper-2">
                      <td className="label px-3 py-3">{i + 1}</td>
                      <td className="label px-3 py-3 truncate max-w-[100px]">
                        <a href={explorerAddr(r.winner)} target="_blank" rel="noopener"
                          className="link-line text-muted">{formatAddress(r.winner)}</a>
                      </td>
                      <td className="label px-3 py-3">{formatUsdc(r.pot)}</td>
                      <td className="label px-3 py-3 text-signal-ink">{formatUsdc(r.discount)}</td>
                      <td className="label px-3 py-3">+{formatUsdc(r.dividendPerMember)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6">
              <p className="label text-muted mb-2 text-[10px]">Discount per round</p>
              <DiscountChart history={history} />
            </div>
          </div>
        )}

        {/* ── Invite ───────────────────────────────────────────────────────── */}
        <div className="cell p-6 md:p-10 grid grid-cols-1 md:grid-cols-2 gap-8" data-boot>
          <div>
            <p className="label text-muted mb-3">Invite Members</p>
            {shareUrl && (
              <div className="flex flex-col gap-3">
                <div className="flex">
                  <div className="flex-1 cell px-3 py-2 label text-muted overflow-hidden text-ellipsis whitespace-nowrap text-xs min-w-0">
                    {shareUrl}
                  </div>
                  <button onClick={() => { void navigator.clipboard.writeText(shareUrl); toast.success('Copied!') }}
                    className="press cell px-4 hover:bg-paper-2 shrink-0">
                    <Copy size={14} />
                  </button>
                </div>
                <QRCodeSVG value={shareUrl} size={100} className="border border-line p-2" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 justify-end">
            <a href={explorerAddr(KAMETI_ADDRESS)} target="_blank" rel="noopener"
              className="label link-line text-muted flex items-center gap-2">
              Contract <ExternalLink size={11} />
            </a>
          </div>
        </div>

      </div>
    </div>
  )
}


