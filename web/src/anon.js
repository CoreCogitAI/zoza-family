// Every chain read and every call to the Zoza Family server goes through
// Anon-RPC (a mixnet by default), so neither sees this device's IP next to
// the family's wallets.
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
  anon: 0, // data reads through Anon-RPC
  direct: 0, // data reads sent directly (direct mode only)
  server: 0, // calls to the Zoza Family server through Anon-RPC
  serverDirect: 0, // calls to the server sent directly (direct mode, or this computer)
  bootstrap: 0, // specifier reads Anon-RPC needs before it starts; no family data
  failed: 0,
  totalMs: 0,
  lastMs: null,
}
const ZERO = { anon: 0, direct: 0, server: 0, serverDirect: 0, bootstrap: 0 }
// Running totals across page loads, so the share reflects the whole visit.
export const totals = (() => {
  try {
    return { ...ZERO, ...JSON.parse(sessionStorage.getItem('zf.anonTotals') ?? '{}') }
  } catch {
    return { ...ZERO }
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

const count = (kind) => {
  stats[kind]++
  totals[kind]++
  emit()
}

async function directRpc(url, method, params, kind = 'direct') {
  count(kind)
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
  // chosenAt survives a restart of the same network, so a slow start stays visible.
  const chosenAt = network === stats.network && stats.chosenAt ? stats.chosenAt : Date.now()
  Object.assign(stats, { network, state: network === 'direct' ? 'ready' : 'starting', error: null, startedAt: Date.now(), chosenAt, readyAt: network === 'direct' ? Date.now() : null })
  emit()
  if (network === 'direct') return
  const n = NETWORKS[network]
  const bootstrap = BOOTSTRAP[n.specifierChain]
  const w = new AnonRpcWorker({
    address: n.address,
    config: n.config,
    preExisting: { rpcProvider: { request: ({ method, params }) => directRpc(bootstrap, method, params, 'bootstrap') } },
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

// Nox at times has no exit node, or no tunnel opens. A read is safe to repeat;
// a server call is repeated only when it never left this browser.
const NO_EXIT = /NoTunnelExit|No exit|TunnelOpenTimeout/
const WAITS = [1500, 3000, 5000, 8000, 12000]
async function retry(send, anyError) {
  for (let i = 0; ; i++) {
    try {
      return await send()
    } catch (e) {
      if (i === WAITS.length || !(anyError || NO_EXIT.test(String(e?.message ?? e)))) throw e
      await new Promise((r) => setTimeout(r, WAITS[i]))
    }
  }
}

/// An EIP-1193 provider for viem's `custom` transport.
export function provider(rpcUrl) {
  return {
    async request({ method, params }) {
      if (!current) start()
      if (current === 'direct') return directRpc(rpcUrl, method, params)
      const t0 = performance.now()
      try {
        const json = await retry(async () => {
          const res = await inTime(worker.fetch(rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          }))
          return res.json()
        }, true)
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

// An exit node cannot reach a server on this computer.
export const LOCAL = /^(localhost|127(\.\d+){3}|\[::1\])$|\.localhost$/.test(location.hostname)

/// fetch() for the Zoza Family server, through the same network as the reads.
/// The server still sees what is asked, but not from which IP. `who` asks the
/// network not to link one person's calls with another's (anon-rpc §9.3).
// An answer that never comes back must not leave the page waiting forever.
const ANSWER_MS = 25_000
let late = 0
function inTime(p) {
  return Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('NoAnswer')), ANSWER_MS))]).then(
    (r) => ((late = 0), r),
    (e) => {
      // Twice without an answer from a worker that was working: start a fresh
      // one. Never while one is still starting: Nym needs minutes to load.
      if (e.message === 'NoAnswer' && stats.state === 'ready' && ++late >= 2) (late = 0), start(current)
      throw e
    },
  )
}

export async function serverFetch(path, init = {}, who) {
  if (!current) start()
  const safe = !init.method || init.method === 'GET'
  if (current === 'direct' || LOCAL) {
    count('serverDirect')
    return fetch(path, init)
  }
  const anonOptions = who ? { isolationKey: who.toLowerCase() } : undefined
  try {
    // A read is safe to repeat on any error; a write only when it never left.
    const res = await retry(() => inTime(worker.fetch(new URL(path, location.origin).href, { ...init, ...(anonOptions && { anonOptions }) })), safe)
    count('server')
    return res
  } catch (e) {
    stats.failed++
    emit()
    window.dispatchEvent(new CustomEvent('zf-diag', { detail: `serverFetch ${init.method ?? 'GET'} ${path.split('?')[0]}: ${e?.message ?? e}` }))
    if (NO_EXIT.test(String(e?.message ?? e))) throw new Error('The Nox mixnet could not connect, so nothing was sent. Try again in a minute, or choose another network on the Privacy page.')
    if (e?.message === 'NoAnswer') throw new Error(safe ? 'No answer through the Nox mixnet. Try again in a minute, or choose another network on the Privacy page.' : 'No answer through the Nox mixnet in 25 s. It may still have reached the server, so reload and check before trying again.')
    throw e
  }
}
