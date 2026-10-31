// ─── Kameti v3.1 contract return types ──────────────────────────────────────

export interface KametiParams {
  name: string
  contribution: bigint
  maxMembers: number
  roundDuration: bigint
  depositMultiplier: number
  maxDiscountBps: number
  minScore: number
  postWinLockBps: number
  keeperTipBps: number
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
  lockLeft: bigint          // v3.1: post-win lock remaining
  paidThisRound: boolean
  won: boolean
  wonRound: number
  defaulted: boolean
  debt: bigint
  hasStoredAuth: boolean    // v3.1: has pre-signed EIP-3009 auths stored
}

// protectionOf returns ProtectionInfo
export interface ProtectionInfo {
  depositCovered: bigint
  lockCovered: bigint
  lockRoundsLeft: number
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
  return { label: 'POOR', color: 'text-signal-ink' }
}
