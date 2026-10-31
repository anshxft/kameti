import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, usePublicClient } from 'wagmi'
import { toast } from 'sonner'
import NumberFlow from '@number-flow/react'
import { KAMETI_ADDRESS, KAMETI_ABI, CHAIN_ID, explorerTx } from '@/lib/contract'
import { friendlyError } from '@/lib/errors'
import { useBoot } from '@/motion'
import { useEip3009Sign } from '@/hooks/useEip3009'
import { useInrRate } from '@/hooks/useLiveData'
import { ArrowRight, Info, Loader2 } from 'lucide-react'

const ROUND_PRESETS = [
  { label: '10 Min', seconds: 600 },
  { label: '1 Day', seconds: 86400 },
  { label: '3 Days', seconds: 259200 },
  { label: '7 Days', seconds: 604800 },
  { label: '14 Days', seconds: 1209600 },
  { label: '30 Days', seconds: 2592000 },
]

const SCORE_OPTIONS = [
  { label: 'None', value: 0 },
  { label: '600', value: 600 },
  { label: '650', value: 650 },
  { label: '700', value: 700 },
]

const POST_WIN_LOCK_OPTIONS = [
  { label: '0%', value: 0 },
  { label: '25%', value: 2500 },
  { label: '50%', value: 5000, default: true },
  { label: '75%', value: 7500 },
]

const KEEPER_TIP_OPTIONS = [
  { label: '0%', value: 0 },
  { label: '0.1%', value: 10 },
  { label: '0.25%', value: 25 },
  { label: '0.5%', value: 50 },
]

function Tip({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 mt-2 text-muted">
      <Info size={12} className="shrink-0 mt-0.5" />
      <span className="label text-[10px]">{text}</span>
    </div>
  )
}

export default function NewCircle() {
  const pageRef = useRef<HTMLDivElement>(null)
  useBoot(pageRef)

  const navigate = useNavigate()
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { signDepositAuth } = useEip3009Sign()
  const inrRate = useInrRate()

  const [name, setName]                   = useState('')
  const [contribution, setContribution]   = useState('10')
  const [members, setMembers]             = useState(5)
  const [roundSeconds, setRoundSeconds]   = useState(604800)
  const [depositMul, setDepositMul]       = useState(2)
  const [maxDiscountBps, setMaxDiscountBps] = useState(2000)
  const [minScore, setMinScore]           = useState(0)
  const [postWinLockBps, setPostWinLockBps] = useState(5000)
  const [keeperTipBps, setKeeperTipBps]   = useState(10)

  const [isSigning, setIsSigning]         = useState(false)

  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const contrib = parseFloat(contribution || '0')
  const pot     = contrib * members
  const deposit = contrib * depositMul
  const roundDays = roundSeconds / 86400

  const inrPot     = inrRate > 0 ? pot * inrRate : null
  const inrDeposit = inrRate > 0 ? deposit * inrRate : null

  const exampleDiscount = pot * 0.10
  const exampleWinner   = pot - exampleDiscount
  const exampleDividend = members > 1 ? exampleDiscount / (members - 1) : 0

  const isWrongChain = address && chainId !== CHAIN_ID

  const handleCreate = async () => {
    if (!address) { toast.error('Connect your wallet first'); return }
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    if (!name.trim()) { toast.error('Enter a circle name'); return }
    if (!contrib || contrib <= 0) { toast.error('Enter a valid contribution amount'); return }
    if (!publicClient) { toast.error('Public client not ready'); return }

    const contributionRaw = BigInt(Math.round(contrib * 1_000_000))
    const depositRaw      = contributionRaw * BigInt(depositMul)

    // We need the circleId that will be assigned = totalCircles (before create)
    // so we can build the depositNonce.
    let nextId: bigint
    try {
      nextId = await publicClient.readContract({
        address: KAMETI_ADDRESS,
        abi: KAMETI_ABI as never,
        functionName: 'totalCircles',
      })
    } catch {
      toast.error('Could not read totalCircles — try plain create instead')
      // Fallback: plain createCircle (no EIP-3009 deposit)
      writeContract(
        {
          address: KAMETI_ADDRESS, abi: KAMETI_ABI,
          functionName: 'createCircle',
          args: [name, contributionRaw, members, BigInt(roundSeconds), depositMul, maxDiscountBps, minScore, postWinLockBps, keeperTipBps],
          chainId: CHAIN_ID,
        },
        {
          onSuccess: (txHash) => toast.success('Circle created!', {
            description: <a href={explorerTx(txHash)} target="_blank" rel="noopener" className="underline label">View on explorer →</a>,
          }),
          onError: (e) => toast.error(friendlyError(e)),
        }
      )
      return
    }

    setIsSigning(true)
    try {
      toast.info('Sign the deposit authorization in your wallet…')
      const sig = await signDepositAuth(nextId, depositRaw)
      toast.info('Submitting…')
      writeContract(
        {
          address: KAMETI_ADDRESS, abi: KAMETI_ABI,
          functionName: 'createCircleWithAuthorization',
          args: [
            name, contributionRaw, members, BigInt(roundSeconds), depositMul, maxDiscountBps, minScore, postWinLockBps, keeperTipBps,
            depositRaw, 0n, sig.validBefore, sig.nonce, sig.v, sig.r, sig.s,
          ],
          chainId: CHAIN_ID,
        },
        {
          onSuccess: (txHash) => toast.success('Circle created!', {
            description: <a href={explorerTx(txHash)} target="_blank" rel="noopener" className="underline label">View on explorer →</a>,
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

  if (isSuccess) {
    setTimeout(() => { void navigate('/me') }, 1200)
  }

  const busy = isPending || isConfirming || isSigning

  return (
    <div ref={pageRef} className="pt-12 min-h-screen overflow-x-hidden">
      <div className="frame grid grid-cols-1 lg:grid-cols-2 min-h-[calc(100vh-3rem)]">

        {/* ── Form ──────────────────────────────────────────────────────────── */}
        <div className="cell p-6 md:p-12">
          <div data-boot>
            <p className="label text-muted mb-2">New Circle</p>
            <h1 className="font-display text-4xl md:text-5xl font-bold mb-10">Create a Kameti</h1>
          </div>

          <div className="space-y-8" data-boot>

            {/* Name */}
            <div>
              <label className="label text-muted block mb-2">Circle Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Family Savings, Friends Fund…"
                maxLength={40}
                className="w-full bg-transparent border border-line px-4 py-3 font-sans text-ink placeholder:text-muted focus:border-ink outline-none transition-colors"
              />
            </div>

            {/* Contribution */}
            <div>
              <label className="label text-muted block mb-2">Contribution per Round (USDC)</label>
              <div className="flex border border-line focus-within:border-ink transition-colors">
                <input
                  type="number"
                  value={contribution}
                  onChange={e => setContribution(e.target.value)}
                  placeholder="10"
                  min="0.01"
                  step="0.01"
                  className="flex-1 min-w-0 bg-transparent px-4 py-3 font-display text-2xl font-bold text-ink placeholder:text-muted outline-none"
                />
                <div className="shrink-0 px-4 flex items-center label text-muted border-l border-line bg-paper-2 whitespace-nowrap">USDC</div>
              </div>
              {inrRate > 0 && contrib > 0 && (
                <p className="label text-muted mt-1 text-[10px]">≈ ₹{(contrib * inrRate).toLocaleString('en-IN', { maximumFractionDigits: 0 })} per round</p>
              )}
            </div>

            {/* Members */}
            <div>
              <label className="label text-muted block mb-3">Members (3–10): {members}</label>
              <div className="frame grid grid-cols-4 sm:grid-cols-8">
                {[3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <button key={n}
                    onClick={() => setMembers(n)}
                    className={`press cell py-3 label text-center ${n === members ? 'bg-ink text-paper' : 'hover:bg-paper-2 text-muted'}`}
                  >{n}</button>
                ))}
              </div>
            </div>

            {/* Round duration */}
            <div>
              <label className="label text-muted block mb-3">Round Duration</label>
              <div className="frame grid grid-cols-3 sm:grid-cols-6">
                {ROUND_PRESETS.map(p => (
                  <button key={p.seconds}
                    onClick={() => setRoundSeconds(p.seconds)}
                    className={`press cell py-3 label text-center ${p.seconds === roundSeconds ? 'bg-ink text-paper' : 'hover:bg-paper-2 text-muted'}`}
                  >{p.label}</button>
                ))}
              </div>
            </div>

            {/* Deposit Multiplier */}
            <div>
              <label className="label text-muted block mb-3">Security Deposit</label>
              <div className="frame grid grid-cols-3">
                {[1, 2, 3].map(m => (
                  <button key={m}
                    onClick={() => setDepositMul(m)}
                    className={`press cell py-4 flex flex-col items-center gap-1 ${m === depositMul ? 'bg-ink text-paper' : 'hover:bg-paper-2 text-muted'}`}
                  >
                    <span className="font-display text-xl font-bold">{m}×</span>
                    <span className="label text-[10px]">{m === 1 ? 'BASIC' : m === 2 ? 'STANDARD' : 'HIGH TRUST'}</span>
                  </button>
                ))}
              </div>
              {contrib > 0 && (
                <p className="label text-muted mt-2">
                  Each member locks <span className="text-ink font-bold">{(contrib * depositMul).toFixed(2)} USDC</span>
                  {inrDeposit ? <span className="text-muted"> (≈ ₹{inrDeposit.toLocaleString('en-IN', { maximumFractionDigits: 0 })})</span> : ''} on join
                </p>
              )}
            </div>

            {/* Max Discount */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label text-muted">Max Auction Discount</label>
                <span className="label font-bold text-ink">{(maxDiscountBps / 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min={500} max={4000} step={100}
                value={maxDiscountBps}
                onChange={e => setMaxDiscountBps(Number(e.target.value))}
                className="w-full accent-signal-ink"
              />
              <div className="flex justify-between label text-muted text-[10px] mt-1">
                <span>5%</span><span>40%</span>
              </div>
            </div>

            {/* Post-win lock */}
            <div>
              <label className="label text-muted block mb-3">Post-win Lock</label>
              <div className="frame grid grid-cols-4">
                {POST_WIN_LOCK_OPTIONS.map(o => (
                  <button key={o.value}
                    onClick={() => setPostWinLockBps(o.value)}
                    className={`press cell py-3 label text-center ${o.value === postWinLockBps ? 'bg-signal text-on-signal border border-ink' : 'hover:bg-paper-2 text-muted'}`}
                  >{o.label}</button>
                ))}
              </div>
              <Tip text="After winning, a portion of the deposit stays locked until all future rounds are paid on time. Higher = more protection for remaining members." />
            </div>

            {/* Keeper tip */}
            <div>
              <label className="label text-muted block mb-3">Keeper Tip (for settling rounds)</label>
              <div className="frame grid grid-cols-4">
                {KEEPER_TIP_OPTIONS.map(o => (
                  <button key={o.value}
                    onClick={() => setKeeperTipBps(o.value)}
                    className={`press cell py-3 label text-center ${o.value === keeperTipBps ? 'bg-signal text-on-signal border border-ink' : 'hover:bg-paper-2 text-muted'}`}
                  >{o.label}</button>
                ))}
              </div>
              <Tip text="A small % of the pot goes to whoever calls settleRound. Incentivises timely settlement, especially useful for automated keeper bots." />
            </div>

            {/* Min Score */}
            <div>
              <label className="label text-muted block mb-3">Minimum Kameti Score</label>
              <div className="frame grid grid-cols-4">
                {SCORE_OPTIONS.map(o => (
                  <button key={o.value}
                    onClick={() => setMinScore(o.value)}
                    className={`press cell py-3 label text-center ${o.value === minScore ? 'bg-ink text-paper' : 'hover:bg-paper-2 text-muted'}`}
                  >{o.label}</button>
                ))}
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={() => { void handleCreate() }}
              disabled={busy || !address}
              className="press w-full cell py-4 bg-signal text-on-signal border border-ink label font-bold flex items-center justify-center gap-2 hover:bg-signal-hover disabled:opacity-40"
            >
              {isSigning ? <><Loader2 size={14} className="animate-spin" /> Sign deposit in wallet…</> :
               isPending ? 'Confirm in wallet…' :
               isConfirming ? 'Creating circle…' :
               isSuccess ? 'Done!' :
               isWrongChain ? 'Switch to Arc Testnet' :
               !address ? 'Connect wallet first' :
               <><>Create Circle</> <ArrowRight size={14} /></>}
            </button>
            <p className="label text-muted text-[10px] -mt-4">
              One signature for the deposit — no approve transaction needed.
            </p>
          </div>
        </div>

        {/* ── Live preview ──────────────────────────────────────────────────── */}
        <div className="cell p-6 md:p-12 bg-paper-2 flex flex-col gap-6" data-boot>
          <div>
            <p className="label text-muted mb-2">Preview</p>
            <h2 className="font-display text-2xl font-bold">{name || 'Your Circle'}</h2>
          </div>

          <div className="frame grid grid-cols-2">
            <div className="cell p-5">
              <p className="label text-muted mb-1">Pot per Round</p>
              <p className="font-display text-3xl font-bold">
                <NumberFlow value={pot} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
              </p>
              <p className="label text-muted mt-0.5">USDC{inrPot ? ` · ≈ ₹${inrPot.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : ''}</p>
            </div>
            <div className="cell p-5">
              <p className="label text-muted mb-1">Your Deposit</p>
              <p className="font-display text-3xl font-bold">
                <NumberFlow value={deposit} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
              </p>
              <p className="label text-muted mt-0.5">USDC locked</p>
            </div>
            <div className="cell p-5">
              <p className="label text-muted mb-1">Members</p>
              <p className="font-display text-3xl font-bold">{members}</p>
            </div>
            <div className="cell p-5">
              <p className="label text-muted mb-1">Total Duration</p>
              <p className="font-display text-3xl font-bold">
                {roundSeconds < 3600
                  ? `${members * Math.round(roundSeconds / 60)}m`
                  : roundSeconds < 86400
                    ? `${members * Math.round(roundSeconds / 3600)}h`
                    : `${Math.round(members * roundDays)}d`}
              </p>
            </div>
            <div className="cell p-5">
              <p className="label text-muted mb-1">Post-win Lock</p>
              <p className="font-display text-xl font-bold">{postWinLockBps / 100}%</p>
              <p className="label text-muted mt-0.5">of deposit stays locked</p>
            </div>
            <div className="cell p-5">
              <p className="label text-muted mb-1">Keeper Tip</p>
              <p className="font-display text-xl font-bold">{keeperTipBps / 100}%</p>
              <p className="label text-muted mt-0.5">of pot per settle</p>
            </div>
          </div>

          {/* Payout schedule */}
          <div>
            <p className="label text-muted mb-3">Payout Schedule</p>
            <div className="frame max-h-52 overflow-y-auto">
              {Array.from({ length: members }, (_, i) => {
                const round = i + 1
                return (
                  <div key={round} className="cell flex items-center gap-2 px-3 py-3">
                    <span className="font-display text-xl font-bold w-7 shrink-0 text-muted">{round}</span>
                    <div className="flex-1 min-w-0">
                      <span className="label">Pot </span>
                      <span className="label font-bold">
                        <NumberFlow value={pot} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
                      </span>
                      <span className="label text-muted"> USDC · </span>
                      {round === members
                        ? <span className="label text-muted">last member, no auction</span>
                        : <span className="label text-signal-ink">auction</span>
                      }
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Worked example */}
          {contrib > 0 && members > 1 && (
            <div className="cell p-5 border border-signal-ink/20 bg-paper">
              <p className="label text-muted mb-3">Worked Example — 10% bid in Round 1</p>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="label text-muted">Winner receives</span>
                  <span className="label font-bold text-ink">
                    <NumberFlow value={exampleWinner} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} /> USDC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="label text-muted">Each other member earns</span>
                  <span className="label font-bold text-signal-ink">
                    +<NumberFlow value={exampleDividend} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} /> USDC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="label text-muted">Discount given</span>
                  <span className="label text-muted">
                    <NumberFlow value={exampleDiscount} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} /> USDC (10%)
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
