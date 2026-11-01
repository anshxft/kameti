/**
 * friendlyError — turns raw wallet/contract errors into one-line user messages.
 *
 * Priority:
 *  1. User rejected (wallet cancelled)
 *  2. Decoded custom error from Kameti ABI (ContractFunctionRevertedError)
 *  3. USDC FiatTokenV2 string errors
 *  4. Known error-name substrings in the message
 *  5. Trimmed raw message fallback
 */
import { decodeErrorResult } from 'viem'
import { KAMETI_ABI } from '@/lib/contract'

// Map every Kameti custom error name to a plain sentence
const ERROR_MAP: Record<string, string> = {
  InvalidParams:           'Invalid parameters — check your inputs.',
  CircleNotOpen:           'This circle is no longer open.',
  CircleNotActive:         'This circle hasn\'t started yet.',
  AlreadyMember:           'You\'re already in this circle.',
  NotMember:               'You\'re not a member of this circle.',
  ScoreTooLow:             'Your Kameti Score is too low to join.',
  CircleFull:              'This circle is already full.',
  AlreadyPaid:             'You\'ve already paid this round.',
  BidTooLow:               'Bid too low — must beat the current bid by ≥1% of pot.',
  BidAboveCap:             'Bid exceeds the maximum discount allowed.',
  BidAfterDeadline:        'Bidding closed — round deadline passed.',
  BidIneligible:           'You\'re not eligible to bid (pay first, or you\'ve already won / defaulted).',
  OnlyOneMemberEligible:   'Only one eligible winner left — no auction needed.',
  RoundNotSettleable:      'Round can\'t be settled yet — deadline not passed and not all paid.',
  AlreadySettled:          'This round was already settled.',
  NothingToWithdraw:       'No USDC to withdraw.',
  AutoPayNotEnabled:       'AutoPay is not enabled for this member.',
  CannotLeaveActiveCircle: 'Cannot leave once the circle has started.',
  RoundEnded:              'This round has ended — settle it first before paying.',
  PqGuardNotEnabled:       'Post-quantum guard is not enabled for this wallet.',
  PqInvalidSignature:      'Post-quantum signature verification failed.',
  InsufficientDeposit:     'Insufficient deposit — make sure you\'ve approved the full amount.',
  CircleCompleted:         'This circle has already completed.',
  NotWinner:               'Only the round winner can withdraw post-win locked funds.',
}

// USDC FiatTokenV2 revert reason strings
const USDC_ERRORS: Array<[string, string]> = [
  ['authorization is expired',     'USDC authorization expired — please sign a new payment.'],
  ['authorization is used',        'USDC authorization already used — this payment was already submitted.'],
  ['authorization is canceled',    'USDC authorization was cancelled.'],
  ['invalid signature',            'USDC signature invalid — wrong round or authorization mismatch.'],
  ['caller must be the payee',     'USDC error: caller must be the payee.'],
  ['FiatTokenV2',                  'USDC rejected the transfer — check the authorization details.'],
]

/**
 * Try to decode a ContractFunctionRevertedError using the Kameti ABI.
 * Returns the friendly message if the error name is in ERROR_MAP, or
 * the raw error name if not, or null if decoding fails.
 */
function decodeKametiError(err: unknown): string | null {
  try {
    // viem wraps revert data in err.cause?.data or err.data
    const typed = err as {
      cause?: { data?: `0x${string}`; errorName?: string }
      data?: `0x${string}`
      errorName?: string
    }
    // Fast path: viem already decoded it
    const eName = typed.errorName ?? typed.cause?.errorName
    if (eName && ERROR_MAP[eName]) return ERROR_MAP[eName]
    if (eName) return `Contract error: ${eName}`

    // Slow path: raw hex data
    const rawData = typed.data ?? typed.cause?.data
    if (!rawData || rawData === '0x') return null
    const decoded = decodeErrorResult({ abi: KAMETI_ABI as never, data: rawData })
    if (decoded?.errorName && ERROR_MAP[decoded.errorName]) return ERROR_MAP[decoded.errorName]
    if (decoded?.errorName) return `Contract error: ${decoded.errorName}`
  } catch { /* ignore */ }
  return null
}

export function friendlyError(err: unknown): string {
  if (!err) return 'Transaction failed.'
  const typed = err as { message?: string; shortMessage?: string }
  const msg = typed.message ?? typed.shortMessage ?? JSON.stringify(err)

  if (msg.includes('user rejected') || msg.includes('User rejected')) return 'Transaction cancelled.'

  // 1. Try ABI decode
  const decoded = decodeKametiError(err)
  if (decoded) return decoded

  // 2. USDC string errors
  const msgLower = msg.toLowerCase()
  for (const [key, friendly] of USDC_ERRORS) {
    if (msgLower.includes(key.toLowerCase())) return friendly
  }

  // 3. Known error name substrings
  for (const [key, friendly] of Object.entries(ERROR_MAP)) {
    if (msg.includes(key)) return friendly
  }

  // 4. Trim and return raw
  const trimmed = msg.replace(/\n/g, ' ').slice(0, 140)
  return trimmed || 'Transaction failed.'
}
