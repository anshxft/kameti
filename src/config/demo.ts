/**
 * Committed defaults for the seeded testnet demo.
 * VITE_DEMO_CIRCLE_ID and VITE_ATTACK_LAB_ID override these when set in .env,
 * so the deployed Vercel/Netlify build works without environment variables.
 */

export const DEMO_CIRCLE_ID: bigint = BigInt(
  String(import.meta.env.VITE_DEMO_CIRCLE_ID ?? '2')
)

export const ATTACK_LAB_ID: bigint = BigInt(
  String(import.meta.env.VITE_ATTACK_LAB_ID ?? '7')
)
