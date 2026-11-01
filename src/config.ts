/**
 * wagmi configuration — driven by VITE_NETWORK (default: testnet).
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { ARC_VIEM_CHAIN } from '@/config/network'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(ARC_VIEM_CHAIN.id, ARC_VIEM_CHAIN.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [ARC_VIEM_CHAIN, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [ARC_VIEM_CHAIN.id]: http(ARC_VIEM_CHAIN.rpcUrls.default.http[0]),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
