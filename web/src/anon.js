// Every chain read goes through Anon-RPC (a mixnet by default), so the RPC
// never sees this device's IP next to the family's wallets.
import { AnonRpcWorker } from '@anon-rpc/browser-harness'

// Specifier contracts from ethereum.github.io/anon-rpc/adopters.
export const NETWORKS = {
  nox: {
    label: 'Nox mixnet',
    about: 'Sphinx packets through entry, mix and exit nodes. TLS to the RPC runs inside the worker, so the exit node cannot read the request.',
    address: '0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A',
    specifierChain: 'sepolia',
    config: undefined,
  },
  tor: {
    label: 'Tor',
    about: 'A Tor client compiled to WebAssembly builds circuits in the browser, through a demonstration gateway.',
    address: '0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e',
    specifierChain: 'mainnet',
    config: { gateways: ['152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ'] },
  },
  nym: {
    label: 'Nym mixnet',
    about: 'A Nym client compiled to WebAssembly; requests leave at a Nym IP Packet Router. About 18 MB to load.',
    address: '0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0',
    specifierChain: 'mainnet',
    config: undefined,
  },
  direct: { label: 'Direct (not private)', about: 'Reads go straight to the public RPC, which sees your IP address.' },
}

// Used once, only to read the specifier contract (anon-rpc §4).
const BOOTSTRAP = {
  sepolia: 'https://ethereum-sepolia-rpc.publicnode.com',
  mainnet: 'https://ethereum-rpc.publicnode.com',
}

export const stats = {
  network: null,
  state: 'idle', // idle | starting | ready | failed
  error: null,
  startedAt: null,
  readyAt: null,
  anon: 0, // requests sent through Anon-RPC
  direct: 0, // requests sent directly (the one bootstrap read, or direct mode)
  failed: 0,
  totalMs: 0,
  lastMs: null,
}
// Running totals across page loads, so the share reflects the whole visit.
export const totals = (() => {
  try {
    return { anon: 0, direct: 0, ...JSON.parse(sessionStorage.getItem('zf.anonTotals') ?? '{}') }
  } catch {
    return { anon: 0, direct: 0 }
  }
})()
const listeners = new Set()
export const onStats = (fn) => (listeners.add(fn), () => listeners.delete(fn))
const emit = () => {
  try {
    sessionStorage.setItem('zf.anonTotals', JSON.stringify(totals))
  } catch {}
  listeners.forEach((fn) => fn({ ...stats, totals: { ...totals } }))
}

async function directRpc(url, method, params) {
  stats.direct++
  totals.direct++
  emit()
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const json = await res.json()
  if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code, data: json.error.data })
  return json.result
}

let worker = null
let current = null

export function chosenNetwork() {
  try {
    const n = localStorage.getItem('zf.anon')
    if (n && NETWORKS[n]) return n
  } catch {}
  return 'nox'
}

export function setNetwork(n) {
  try {
    localStorage.setItem('zf.anon', n)
  } catch {}
  start(n)
}

export function start(network = chosenNetwork()) {
  worker?.close()
  worker = null
  current = network
  Object.assign(stats, { network, state: network === 'direct' ? 'ready' : 'starting', error: null, startedAt: Date.now(), readyAt: network === 'direct' ? Date.now() : null })
  emit()
  if (network === 'direct') return
  const n = NETWORKS[network]
  const bootstrap = BOOTSTRAP[n.specifierChain]
  const w = new AnonRpcWorker({
    address: n.address,
    config: n.config,
    preExisting: { rpcProvider: { request: ({ method, params }) => directRpc(bootstrap, method, params) } },
  })
  worker = w
  w.ready.then(
    () => {
      if (worker !== w) return
      stats.state = 'ready'
      stats.readyAt = Date.now()
      emit()
    },
    (e) => {
      if (worker !== w) return
      stats.state = 'failed'
      stats.error = e?.message ?? String(e)
      emit()
    },
  )
}

/// An EIP-1193 provider for viem's `custom` transport.
export function provider(rpcUrl) {
  return {
    async request({ method, params }) {
      if (!current) start()
      if (current === 'direct') return directRpc(rpcUrl, method, params)
      const t0 = performance.now()
      try {
        const res = await worker.fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        })
        const json = await res.json()
        stats.anon++
        totals.anon++
        stats.lastMs = Math.round(performance.now() - t0)
        stats.totalMs += stats.lastMs
        emit()
        if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code, data: json.error.data })
        return json.result
      } catch (e) {
        if (e?.code === undefined) {
          stats.failed++
          emit()
        }
        throw e
      }
    },
  }
}
