// Zoza Family server: relayer, watcher, Uniswap API quotes, inbox, and the
// website. It holds no family keys and cannot move family money.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { getAddress, isAddress } from 'viem'
import { CALIBUR } from '../shared/calibur.mjs'
import { CHAIN_ID, deployment, EXPLORER, keeper, PORT, PUBLIC_RPC_URL, relayer, root, treasury, UNIVERSAL_ROUTER } from './config.mjs'
import { faucet, FaucetError } from './faucet.mjs'
import { relay, RelayError, short } from './relay.mjs'
import { db, notify } from './store.mjs'
import { giftQuote, QuoteError } from './uniswap.mjs'
import { rememberOwner, start, status } from './watcher.mjs'

const WEB = process.env.WEB_DIST ?? join(root, 'web', 'dist')
const NOTIFY_TOKEN = process.env.NOTIFY_TOKEN ?? null
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 256_000) throw new RelayError('body too large', 413)
  }
  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw new RelayError('bad JSON')
  }
}

const config = () => ({
  chainId: CHAIN_ID,
  chainName: 'Ethereum Sepolia',
  rpc: PUBLIC_RPC_URL,
  explorer: EXPLORER,
  calibur: CALIBUR,
  universalRouter: UNIVERSAL_ROUTER,
  ...deployment,
  relayer: relayer?.account.address ?? null,
  automation: { mode: status.mode, keeper: keeper?.account.address ?? null },
  faucet: !!treasury,
})

async function api(req, res, url) {
  const path = url.pathname
  if (req.method === 'GET' && path === '/api/config') return send(res, 200, config())
  if (req.method === 'GET' && path === '/api/watcher') return send(res, 200, status)
  // Owners with a will, for the Chainlink CRE workflow to check.
  if (req.method === 'GET' && path === '/api/owners') return send(res, 200, db.owners)

  if (req.method === 'POST' && path === '/api/relay') {
    const body = await readJson(req)
    const out = await relay(body)
    if (body.signedBatchedCall?.batchedCall?.calls?.some((c) => c.to?.toLowerCase() === deployment.will.toLowerCase())) rememberOwner(body.account)
    return send(res, 200, out)
  }
  if (req.method === 'POST' && path === '/api/faucet') return send(res, 200, await faucet(await readJson(req)))
  if (req.method === 'GET' && path === '/api/gift-quote') {
    return send(res, 200, await giftQuote({ eth: url.searchParams.get('eth'), swapper: url.searchParams.get('swapper') }))
  }

  const inbox = path.match(/^\/api\/inbox\/(0x[0-9a-fA-F]{40})$/)
  if (req.method === 'GET' && inbox) return send(res, 200, db.inbox[inbox[1].toLowerCase()] ?? [])

  // Messages from the Chainlink CRE workflow (or any trusted job).
  if (req.method === 'POST' && path === '/api/notify') {
    if (NOTIFY_TOKEN && req.headers.authorization !== `Bearer ${NOTIFY_TOKEN}`) return send(res, 401, { error: 'unauthorized' })
    const b = await readJson(req)
    const to = (b.to ?? []).filter((a) => isAddress(a)).map((a) => getAddress(a))
    if (!to.length || !b.title) return send(res, 400, { error: 'to and title required' })
    notify(to, { kind: b.kind ?? 'watcher', title: String(b.title).slice(0, 120), body: String(b.body ?? '').slice(0, 500), via: 'cre' })
    return send(res, 200, { ok: true, to: to.length })
  }
  return send(res, 404, { error: 'not found' })
}

function serveStatic(res, pathname) {
  let file = normalize(join(WEB, pathname === '/' ? 'index.html' : pathname))
  if (!file.startsWith(WEB)) file = join(WEB, 'index.html')
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(WEB, 'index.html')
  if (!existsSync(file)) {
    res.writeHead(404).end('Build the website first: cd web && npm run build')
    return
  }
  const immutable = file.includes('/assets/')
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })
  createReadStream(file).pipe(res)
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname)
  try {
    await api(req, res, url)
  } catch (e) {
    const status = e instanceof RelayError ? e.status : e instanceof FaucetError || e instanceof QuoteError ? 400 : 500
    if (status === 500) console.error(e)
    send(res, status, { error: status === 500 ? short(e) : e.message })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Zoza Family on http://127.0.0.1:${PORT}  chain ${CHAIN_ID}  watcher ${status.mode}`)
  if (process.env.WATCHER !== 'off') start()
})
