/**
 * Shown on write-action pages when VITE_NETWORK=mainnet but
 * VITE_KAMETI_MAINNET has not been set yet.
 * Replaces the page body so no contract call is ever attempted
 * against a wrong (or empty) address.
 */
import { AlertTriangle } from 'lucide-react'
import { DISPLAY_NAME } from '@/config/network'

export default function NotDeployedBanner() {
  return (
    <div className="pt-12 min-h-screen flex items-center justify-center">
      <div className="frame max-w-lg mx-auto w-full">
        <div className="cell p-8 flex flex-col gap-4" data-boot>
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-signal-ink shrink-0" />
            <p className="label font-bold text-signal-ink text-sm">MAINNET CONTRACT NOT DEPLOYED YET</p>
          </div>
          <p className="font-sans text-muted text-sm">
            The Kameti contract has not been deployed on {DISPLAY_NAME}.
            Set <code className="font-mono text-xs bg-paper-2 px-1">VITE_KAMETI_MAINNET</code> to
            the deployed contract address and rebuild.
          </p>
          <p className="font-sans text-muted text-sm">
            The testnet deployment is always available at{' '}
            <a
              href="https://explorer.testnet.arc.io/address/0x34f31472c5d16e0562668fbea1e700b19b2ea5a7"
              target="_blank" rel="noopener"
              className="link-line font-mono text-xs text-ink"
            >
              0x34f3…a5a7
            </a>.
          </p>
        </div>
      </div>
    </div>
  )
}
