import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, defineChain, fallback, http, nonceManager } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import abi from '../shared/abi.json' with { type: 'json' }

export const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export { abi }

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11155111)
// Several public nodes: free ones rate-limit, so viem moves to the next.
export const RPC_URLS = (process.env.RPC_URLS ?? 'https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.gateway.tenderly.co,https://1rpc.io/sepolia').split(',')
export const RPC_URL = RPC_URLS[0]
// What the browser calls through Anon-RPC. A public node, so no key is shared.
export const PUBLIC_RPC_URL = process.env.PUBLIC_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
export const EXPLORER = process.env.EXPLORER_URL ?? 'https://sepolia.etherscan.io'
export const PORT = Number(process.env.PORT ?? 8790)
// Uniswap's Universal Router on Sepolia, where Uniswap API swaps go.
export const UNIVERSAL_ROUTER = process.env.UNIVERSAL_ROUTER ?? '0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3'

export const deployment = JSON.parse(readFileSync(join(root, 'deployments', `${CHAIN_ID}.json`), 'utf8'))

export const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 11155111 ? 'Sepolia' : `Chain ${CHAIN_ID}`,
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: RPC_URLS } },
  blockExplorers: { default: { name: 'Etherscan', url: EXPLORER } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
})

const transport = () => fallback(RPC_URLS.map((u) => http(u, { retryCount: 1, timeout: 20_000 })), { rank: false, retryCount: 2 })

export const client = createPublicClient({ chain, transport: transport(), batch: { multicall: { wait: 20 } } })

function wallet(envKey) {
  const key = process.env[envKey]
  if (!key) return null
  // viem's nonce manager counts pending transactions itself, so a lagging
  // public node cannot hand out a nonce that is already in use.
  return createWalletClient({ chain, transport: transport(), account: privateKeyToAccount(key, { nonceManager }) })
}

// The relayer pays gas for families. The keeper runs the watcher when Chainlink
// CRE is not doing it. The treasury hands out test money.
export const relayer = wallet('RELAYER_KEY')
export const keeper = wallet('KEEPER_KEY')
export const treasury = wallet('DEPLOYER_KEY')

/// Sepolia's base fee is tiny; a small tip is enough to be included.
export async function fees() {
  const block = await client.getBlock()
  const tip = BigInt(process.env.TIP_WEI ?? 2_000_000) // 0.002 gwei
  return { maxPriorityFeePerGas: tip, maxFeePerGas: (block.baseFeePerGas ?? 0n) * 2n + tip }
}
