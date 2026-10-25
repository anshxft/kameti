// ─── Kameti v2 contract return types ────────────────────────────────────────

export interface KametiParams {
  name: string
  contribution: bigint
  maxMembers: number
  roundDuration: bigint
  depositMultiplier: number
  maxDiscountBps: number
  minScore: number
}

// getCircle returns a tuple: (params, status, currentRound, roundEnd, potAccumulated, highestBidder, highestDiscount)
export interface KametiCircle {
  params: KametiParams
  status: number
  currentRound: number
  roundEnd: bigint
  potAccumulated: bigint
  highestBidder: string
  highestDiscount: bigint
}

// getMembers returns MemberInfo[]
export interface MemberInfo {
  addr: string
  seat: number
  depositLeft: bigint
  paidThisRound: boolean
  won: boolean
  wonRound: number
  defaulted: boolean
  debt: bigint
  autoPay: boolean
}

// getRoundHistory returns RoundRecord[]
export interface RoundRecord {
  winner: string
  pot: bigint
  discount: bigint
  dividendPerMember: bigint
}

// statsOf returns ScoreStats
export interface ScoreStats {
  onTimePayments: number
  strikes: number
  defaults: number
  circlesCompleted: number
  totalContributed: bigint
}

// Score tier
export function scoreTier(score: number): { label: string; color: string } {
  if (score >= 750) return { label: 'EXCELLENT', color: 'text-ink' }
  if (score >= 650) return { label: 'GOOD', color: 'text-ink' }
  if (score >= 550) return { label: 'FAIR', color: 'text-muted' }
  return { label: 'POOR', color: 'text-signal' }
}
