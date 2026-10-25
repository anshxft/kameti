import { useRef, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, useReadContract, useSwitchChain, usePublicClient } from 'wagmi'
import { ArrowRight } from 'lucide-react'
import NumberFlow from '@number-flow/react'
import { useBoot } from '@/motion'
import { KAMETI_ADDRESS, KAMETI_ABI, CHAIN_ID, formatUsdc, formatCountdown } from '@/lib/contract'
import { ConnectKitButton } from 'connectkit'
import type { KametiCircle, MemberInfo } from '@/lib/types'
import { scoreTier } from '@/lib/types'

const STATUS_LABELS = ['OPEN', 'ACTIVE', 'COMPLETED'] as const

function ScoreBanner({ addr }: { addr: string }) {
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const [score, setScore] = useState<number | null>(null)

  useEffect(() => {
    if (!publicClient || !addr) return
    let cancelled = false
    publicClient.readContract({
      address: KAMETI_ADDRESS, abi: KAMETI_ABI as never,
      functionName: 'scoreOf', args: [addr],
    }).then((s) => {
      if (!cancelled) setScore(Number(s))
    }).catch(() => { if (!cancelled) setScore(600) })
    return () => { cancelled = true }
  }, [publicClient, addr])

  if (score === null) return null
  const { label } = scoreTier(score)
  const cls = score >= 650 ? 'bg-ink text-paper' : score >= 550 ? 'border border-line text-muted' : 'border border-signal text-signal'

  return (
    <Link to={`/score/${addr}`} className="press cell px-4 py-3 flex items-center gap-4 hover:bg-paper-2">
      <div>
        <p className="label text-muted text-[10px]">MY KAMETI SCORE</p>
        <p className="font-display text-2xl font-bold"><NumberFlow value={score} /></p>
      </div>
      <span className={`label px-2 py-1 ${cls}`}>{label}</span>
      <span className="label text-muted ml-auto text-xs">View →</span>
    </Link>
  )
}

function CircleCard({ circleId, myAddress }: { circleId: bigint; myAddress: string }) {
  const { data: rawCircle } = useReadContract({
    address: KAMETI_ADDRESS, abi: KAMETI_ABI,
    functionName: 'getCircle', args: [circleId], chainId: CHAIN_ID,
  })
  const { data: rawMembers } = useReadContract({
    address: KAMETI_ADDRESS, abi: KAMETI_ABI,
    functionName: 'getMembers', args: [circleId], chainId: CHAIN_ID,
  })
  const { data: myClaimableRaw } = useReadContract({
    address: KAMETI_ADDRESS, abi: KAMETI_ABI,
    functionName: 'claimable', args: [myAddress as `0x${string}`], chainId: CHAIN_ID,
  })

  const circle = rawCircle as [KametiCircle['params'], number, number, bigint, bigint, string, bigint] | undefined
  const members = (rawMembers ?? []) as MemberInfo[]

  if (!circle) return (
    <div className="cell p-6">
      <div className="h-4 bg-line w-2/3 mb-2" />
      <div className="h-8 bg-line w-1/2" />
    </div>
  )

  const params       = circle[0]
  const status       = circle[1]
  const currentRound = circle[2]
  const roundEnd     = Number(circle[3])
  const maxMembers   = Number(params.maxMembers)
  const contribution = params.contribution
  const roundDuration= Number(params.roundDuration)
  const myIdx        = members.findIndex(m => m.addr.toLowerCase() === myAddress.toLowerCase())
  const me           = myIdx >= 0 ? members[myIdx] : undefined
  const pot          = contribution * BigInt(members.length || 1)
  const isMyTurn     = status === 1 && myIdx === currentRound - 1
  const myClaimable  = (myClaimableRaw ?? 0n) as bigint

  const statusLabel  = STATUS_LABELS[status] ?? 'UNKNOWN'

  return (
    <Link to={`/k/${circleId}`} className="cell p-5 hover:bg-paper-2 press block">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <p className="font-display text-xl font-bold truncate">{params.name}</p>
          <p className="label text-muted mt-0.5">
            #{circleId.toString()} · {members.length}/{maxMembers}
          </p>
        </div>
        <span className={`label px-2 py-0.5 shrink-0 ml-2 ${status === 0 ? 'border border-line text-muted' : status === 1 ? 'bg-signal text-on-signal' : 'bg-ink text-paper'}`}>
          {status === 1 ? `R${currentRound}/${maxMembers}` : statusLabel}
        </span>
      </div>

      {/* Stats row */}
      <div className="frame grid grid-cols-3 mb-3">
        <div className="cell p-2">
          <p className="label text-[9px] text-muted">Pot</p>
          <p className="font-display text-sm font-bold leading-tight">{formatUsdc(pot)}</p>
        </div>
        <div className="cell p-2">
          <p className="label text-[9px] text-muted">My Seat</p>
          <p className="font-display text-sm font-bold leading-tight">{myIdx >= 0 ? `#${myIdx + 1}` : '—'}</p>
          {isMyTurn && <p className="label text-signal font-bold text-[9px]">NOW</p>}
        </div>
        <div className="cell p-2 min-w-0">
          <p className="label text-[9px] text-muted">{status === 1 ? 'Round ends' : 'Duration'}</p>
          <p className="font-display text-sm font-bold leading-tight truncate">
            {status === 1 ? formatCountdown(roundEnd) : `${Math.round(roundDuration / 86400)}d`}
          </p>
        </div>
      </div>

      {/* My position detail */}
      {me && (
        <div className="frame grid grid-cols-2 md:grid-cols-4 mb-3">
          <div className="cell p-2">
            <p className="label text-[9px] text-muted">Deposit Left</p>
            <p className="label font-bold text-[11px]">{formatUsdc(me.depositLeft)}</p>
          </div>
          <div className="cell p-2">
            <p className="label text-[9px] text-muted">Claimable</p>
            <p className={`label font-bold text-[11px] ${myClaimable > 0n ? 'text-signal' : ''}`}>
              {formatUsdc(myClaimable)}
            </p>
          </div>
          <div className="cell p-2">
            <p className="label text-[9px] text-muted">Won</p>
            <p className="label font-bold text-[11px]">{me.won ? `R${me.wonRound}` : '—'}</p>
          </div>
          <div className="cell p-2">
            <p className="label text-[9px] text-muted">Paid</p>
            <p className={`label font-bold text-[11px] ${me.paidThisRound ? 'text-ink' : 'text-muted'}`}>
              {me.paidThisRound ? 'YES' : 'NO'}
            </p>
          </div>
        </div>
      )}

      {isMyTurn && (
        <div className="cell px-4 py-2 bg-signal text-on-signal label font-bold flex items-center justify-between">
          Your turn to claim <ArrowRight size={14} />
        </div>
      )}
      {status === 1 && !isMyTurn && me && !me.paidThisRound && (
        <div className="cell px-4 py-2 border border-line label text-muted flex items-center justify-between">
          Owe {formatUsdc(contribution)} USDC this round <ArrowRight size={14} />
        </div>
      )}
      {status === 0 && (
        <div className="cell px-4 py-2 border border-line label text-muted">Waiting for members</div>
      )}
    </Link>
  )
}

export default function MyCircles() {
  const pageRef = useRef<HTMLDivElement>(null)
  useBoot(pageRef)

  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const isWrongChain = address && chainId !== CHAIN_ID

  const { data: circleIds } = useReadContract({
    address: KAMETI_ADDRESS, abi: KAMETI_ABI,
    functionName: 'circlesOf', args: [address ?? '0x0'], chainId: CHAIN_ID,
    query: { enabled: !!address },
  })

  const ids = (circleIds ?? []) as bigint[]

  return (
    <div ref={pageRef} className="pt-12 min-h-screen overflow-x-hidden">
      <div className="frame">

        <div className="cell px-6 md:px-12 py-10" data-boot>
          <p className="label text-muted mb-2">My Circles</p>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <h1 className="font-display text-4xl md:text-5xl font-bold">Your Kametis</h1>
            <Link to="/new"
              className="press cell px-6 py-3 bg-signal text-on-signal label font-bold flex items-center gap-2 shrink-0">
              New <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        {/* Score banner */}
        {address && <ScoreBanner addr={address} />}

        {!address && (
          <div className="cell p-10 flex flex-col items-center gap-4 text-center" data-boot>
            <p className="font-display text-2xl font-bold">Connect to see your circles</p>
            <ConnectKitButton label="Connect Wallet" />
          </div>
        )}

        {address && isWrongChain && (
          <div className="cell p-6" data-boot>
            <button onClick={() => switchChain({ chainId: CHAIN_ID })}
              className="press cell py-3 px-8 bg-signal text-on-signal label font-bold">
              Switch to Arc Testnet
            </button>
          </div>
        )}

        {address && !isWrongChain && ids.length === 0 && (
          <div className="cell p-10 text-center" data-boot>
            <p className="font-display text-2xl font-bold mb-4">No circles yet</p>
            <p className="text-muted mb-6">Create a Kameti or ask a friend for their invite link.</p>
            <Link to="/new"
              className="press cell px-8 py-4 bg-signal text-on-signal label font-bold inline-flex items-center gap-2">
              Start a Circle <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {address && !isWrongChain && ids.length > 0 && (
          <div className="frame grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" data-boot>
            {ids.map((cid) => (
              <CircleCard key={cid.toString()} circleId={cid} myAddress={address} />
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
