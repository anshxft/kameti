// Map Kameti v2 custom error names to user-friendly messages
const ERROR_MAP: Record<string, string> = {
  InvalidParams:          'Invalid parameters — check your inputs.',
  CircleNotOpen:          'This circle is no longer open.',
  CircleNotActive:        'This circle hasn\'t started yet.',
  AlreadyMember:          'You\'re already in this circle.',
  NotMember:              'You\'re not a member of this circle.',
  ScoreTooLow:            'Your Kameti Score is too low to join.',
  CircleFull:             'This circle is already full.',
  AlreadyPaid:            'You\'ve already paid this round.',
  BidTooLow:              'Bid too low — must beat the current bid by ≥1% of pot.',
  BidAboveCap:            'Bid exceeds the maximum discount allowed.',
  BidAfterDeadline:       'Bidding closed — round deadline passed.',
  BidIneligible:          'You\'re not eligible to bid (pay first, or you\'ve already won / defaulted).',
  OnlyOneMemberEligible:  'Only one eligible winner left — no auction needed.',
  RoundNotSettleable:     'Round can\'t be settled yet — deadline not passed and not all paid.',
  AlreadySettled:         'This round was already settled.',
  NothingToWithdraw:      'No USDC to withdraw.',
  AutoPayNotEnabled:      'AutoPay is not enabled for this member.',
  CannotLeaveActiveCircle:'Cannot leave once the circle has started.',
  RoundEnded:             'This round has ended — settle it first before paying.',
}

export function friendlyError(err: unknown): string {
  if (!err) return 'Transaction failed.'
  const typed = err as { message?: string; shortMessage?: string }
  const msg = typed.message ?? typed.shortMessage ?? JSON.stringify(err)
  if (msg.includes('user rejected') || msg.includes('User rejected')) return 'Transaction cancelled.'

  for (const [key, friendly] of Object.entries(ERROR_MAP)) {
    if (msg.includes(key)) return friendly
  }

  // Trim long raw messages
  const trimmed = msg.replace(/\n/g, ' ').slice(0, 120)
  return trimmed || 'Transaction failed.'
}
