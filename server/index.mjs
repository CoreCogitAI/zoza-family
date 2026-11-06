// Zoza Family server: relayer, watcher, Uniswap API quotes, inbox, and the
// website. It holds no family keys and cannot move family money.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { getAddress, isAddress } from 'viem'
import { CALIBUR } from '../shared/calibur.mjs'
import { rates } from './fx.mjs'
import { CHAIN_ID, deployment, EXPLORER, keeper, PORT, PUBLIC_RPC_URL, relayer, root, treasury, UNIVERSAL_ROUTER } from './config.mjs'
import { faucet, FaucetError } from './faucet.mjs'
import { relay, RelayError, short } from './relay.mjs'
import { db, notify, save } from './store.mjs'
import { giftQuote, QuoteError } from './uniswap.mjs'
import { StartupError, auditCsv, createProposal, decideProposal, getPolicy, listProposals, savePolicy } from './startup.mjs'
import * as invites from './invites.mjs'
import { readers } from './auth.mjs'
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
  diag: process.env.LOG_API === '1',
})

async function api(req, res, url) {
  const path = url.pathname
  if (req.method === 'GET' && path === '/api/config') return send(res, 200, config())
  // LOG_API=1 only: a browser reports its state and errors, so a problem seen in
  // one browser shows in the log. Short text, addresses already cut by the page.
  if (req.method === 'POST' && path === '/api/diag' && process.env.LOG_API === '1') {
    const { line } = await readJson(req)
    console.log(`${new Date().toISOString().slice(11, 19)} DIAG ${String(line ?? '').replace(/0x([0-9a-fA-F]{4})[0-9a-fA-F]{36}/g, '0x$1…').replace(/[\r\n]+/g, ' ').slice(0, 300)}`)
    return send(res, 200, {})
  }
  if (req.method === 'GET' && path === '/api/watcher') return send(res, 200, status)
  if (req.method === 'GET' && path === '/api/fx') return send(res, 200, await rates())
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

  // Family invites: a code to sign, create, read, accept, and the list a family sent.
  if (req.method === 'GET' && path === '/api/invites/code') return send(res, 200, { code: invites.newCode() })
  if (req.method === 'POST' && path === '/api/invites') return send(res, 200, await invites.create(await readJson(req)))
  if (req.method === 'GET' && path === '/api/invites') {
    const may = await readers(req)
    const from = (url.searchParams.get('from') ?? '').split(',').filter((a) => isAddress(a) && may.has(a.toLowerCase()))
    if (!from.length) return send(res, 401, { error: 'sign in to read this family list' })
    return send(res, 200, invites.sentBy(from))
  }
  const inv = path.match(/^\/api\/invites\/([A-Za-z0-9_-]{12})(\/accept|\/remove)?$/)
  if (inv && req.method === 'GET' && !inv[2]) return send(res, 200, invites.get(inv[1]))
  if (inv && req.method === 'POST' && inv[2] === '/accept') return send(res, 200, await invites.accept(inv[1], await readJson(req)))
  if (inv && req.method === 'POST' && inv[2] === '/remove') return send(res, 200, await invites.remove(inv[1], await readJson(req)))

  const inbox = path.match(/^\/api\/inbox\/(0x[0-9a-fA-F]{40})$/)
  if (req.method === 'GET' && inbox) {
    if (!(await readers(req)).has(inbox[1].toLowerCase())) return send(res, 401, { error: 'sign in to read these messages' })
    return send(res, 200, db.inbox[inbox[1].toLowerCase()] ?? [])
  }

  // Messages from the Chainlink CRE workflow (or any trusted job).
  if (req.method === 'POST' && path === '/api/notify') {
    if (NOTIFY_TOKEN && req.headers.authorization !== `Bearer ${NOTIFY_TOKEN}`) return send(res, 401, { error: 'unauthorized' })
    const b = await readJson(req)
    const to = (b.to ?? []).filter((a) => isAddress(a)).map((a) => getAddress(a))
    if (!to.length || !b.title) return send(res, 400, { error: 'to and title required' })
    notify(to, { kind: b.kind ?? 'watcher', title: String(b.title).slice(0, 120), body: String(b.body ?? '').slice(0, 500), via: 'cre' })
    return send(res, 200, { ok: true, to: to.length })
  }

  const startupOwner = url.searchParams.get('owner')
  if (startupOwner && isAddress(startupOwner)) {
    const may = await readers(req)
    if (!may.has(startupOwner.toLowerCase())) return send(res, 401, { error: 'sign in to manage this startup wallet' })
    const ownerKey = getAddress(startupOwner)
    if (req.method === 'GET' && path === '/api/startup/policy') return send(res, 200, { policy: getPolicy(db, ownerKey) })
    if (req.method === 'PUT' && path === '/api/startup/policy') return send(res, 200, { policy: savePolicy(db, save, ownerKey, await readJson(req)) })
    if (req.method === 'GET' && path === '/api/startup/proposals') return send(res, 200, { proposals: listProposals(db, ownerKey) })
    if (req.method === 'GET' && path === '/api/startup/audit.csv') {
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="startup-audit-${ownerKey.slice(2, 8)}.csv"`, 'cache-control': 'no-store' })
      res.end(auditCsv(db, ownerKey))
      return
    }
  }
  if (req.method === 'POST' && path === '/api/startup/proposals') {
    const b = await readJson(req)
    const may = await readers(req)
    if (!b.owner || !isAddress(b.owner) || !may.has(b.owner.toLowerCase())) return send(res, 401, { error: 'sign in to create a proposal' })
    if (!b.actor || !isAddress(b.actor) || !may.has(b.actor.toLowerCase())) return send(res, 401, { error: 'authenticated actor required' })
    return send(res, 200, { proposal: createProposal(db, save, b.owner, b, b.actor) })
  }
  if (req.method === 'POST' && path === '/api/startup/proposals/decide') {
    const b = await readJson(req)
    const may = await readers(req)
    if (!b.owner || !isAddress(b.owner) || !may.has(b.owner.toLowerCase())) return send(res, 401, { error: 'sign in to review a proposal' })
    if (!b.actor || !isAddress(b.actor) || !may.has(b.actor.toLowerCase())) return send(res, 401, { error: 'authenticated actor required' })
    return send(res, 200, { proposal: decideProposal(db, save, b.owner, b.id, b.actor, b.decision) })
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
  // LOG_API=1 prints one line per API call: no IPs, no query, addresses cut short.
  if (process.env.LOG_API === '1') {
    const t = Date.now()
    res.on('finish', () => console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${url.pathname.replace(/0x([0-9a-fA-F]{4})[0-9a-fA-F]{36}/, '0x$1…')} ${res.statusCode} ${Date.now() - t}ms${req.headers['x-zoza-auth'] ? ' pass' : ''}${url.searchParams.get('from') ? ' from ' + url.searchParams.get('from').split(',').map((a) => a.slice(0, 6)).join(',') : ''}`))
  }
  try {
    await api(req, res, url)
  } catch (e) {
    const status = e instanceof RelayError ? e.status : e instanceof StartupError || e instanceof FaucetError || e instanceof QuoteError || e instanceof invites.InviteError ? e.status ?? 400 : 500
    if (status === 500) console.error(e)
    send(res, status, { error: status === 500 ? short(e) : e.message })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Zoza Family on http://127.0.0.1:${PORT}  chain ${CHAIN_ID}  watcher ${status.mode}`)
  if (process.env.WATCHER !== 'off') start()
})
