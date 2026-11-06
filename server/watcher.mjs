// Calls collect, openClaim and release when due, and turns chain changes into
// messages. All three are permissionless. With WATCHER=cre, Chainlink CRE
// does the calls and this only writes messages.
import { formatUnits, getAddress } from 'viem'
import { abi, client, deployment, fees, keeper } from './config.mjs'
import { db, notify, save } from './store.mjs'

const MODE = process.env.WATCHER ?? 'server'
const EVERY_MS = Number(process.env.WATCH_EVERY_MS ?? 10_000)
const CHUNK = BigInt(process.env.LOG_CHUNK ?? 5_000)
const WILL_MADE = abi.will.find((x) => x.name === 'WillMade' && x.type === 'event')
const STATES = ['None', 'Alive', 'Silent', 'Claim', 'Released']
const KINDS = ['Instalment', 'TopUp', 'Gift', 'Missed']
const usd = (v) => `${Number(formatUnits(BigInt(v), 6)).toFixed(2)} USDC`

const read = (address, a, functionName, args = []) => client.readContract({ address, abi: a, functionName, args })
const will = (fn, args) => read(deployment.will, abi.will, fn, args)
const savings = (fn, args) => read(deployment.savings, abi.savings, fn, args)

export const status = { mode: MODE, lastTick: null, lastError: null, actions: [] }

async function act(functionName, address, a, args, label) {
  if (MODE !== 'server' || !keeper) return null
  const req = { account: keeper.account, address, abi: a, functionName, args }
  // Exact estimates can run out of gas on Sepolia; add the same margin as the relayer.
  let gas
  try {
    gas = await client.estimateContractGas(req)
  } catch {
    return null // not due on this node yet; the next tick tries again
  }
  const hash = await keeper.writeContract({ ...req, gas: (gas * 13n) / 10n, ...(await fees()) })
  const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 })
  status.actions.unshift({ at: Date.now(), label, hash, ok: r.status === 'success' })
  status.actions.length = Math.min(status.actions.length, 30)
  return r.status === 'success' ? hash : null
}

/// Owners with a will, from WillMade logs (and owners the relayer has seen).
async function discoverOwners() {
  const head = await client.getBlockNumber()
  let from = BigInt(db.scannedTo ?? deployment.block)
  while (from <= head) {
    const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head
    const logs = await client.getLogs({ address: deployment.will, event: WILL_MADE, fromBlock: from, toBlock: to })
    for (const l of logs) {
      const o = getAddress(l.args.owner)
      if (!db.owners.includes(o)) db.owners.push(o)
    }
    from = to + 1n
    db.scannedTo = Number(from)
  }
  save()
}

export function rememberOwner(address) {
  const o = getAddress(address)
  if (!db.owners.includes(o)) {
    db.owners.push(o)
    save()
  }
}

async function watchWills(now) {
  for (const owner of db.owners) {
    const w = await will('willOf', [owner])
    let state = STATES[await will('stateOf', [owner])]
    if (state === 'Silent') {
      const hash = await act('openClaim', deployment.will, abi.will, [owner], `Opened a claim on ${owner.slice(0, 8)}'s will`)
      if (hash) state = 'Claim'
    }
    const prev = db.seen.wills[owner]
    if (prev?.state === state && prev?.version === Number(w.version)) continue
    db.seen.wills[owner] = { state, version: Number(w.version) }
    if (!prev) continue // first sight: no message
    const heirs = [...w.heirs]
    const releaseAt = Number(w.claimOpenedAt) + Number(w.window)
    if (state === 'Claim') {
      notify(heirs, { kind: 'will', owner, title: 'A claim has opened', body: `The owner of ${short(owner)} has not checked in for a while. If they do not respond, your share unlocks ${when(releaseAt, now)}.` })
      notify([owner], { kind: 'will', owner, title: 'Are you there?', body: `You have not checked in, so your family has been told. Open Zoza and tap "I'm here" before ${when(releaseAt, now)} to cancel.` })
    } else if (state === 'Alive' && prev.state === 'Claim') {
      notify(heirs, { kind: 'will', owner, title: 'All is well', body: `${short(owner)} checked in. The claim is cancelled.` })
    } else if (state === 'Released') {
      notify(heirs, { kind: 'will', owner, title: 'Your share is ready', body: `You can now receive your share from ${short(owner)}'s wallet.` })
    }
  }
  save()
}

async function watchPlans(now) {
  const count = Number(await savings('planCount'))
  for (let id = 0; id < count; id++) {
    let p = await savings('planOf', [BigInt(id)])
    if (!p.closed && now >= Number(p.maturity)) {
      await act('release', deployment.savings, abi.savings, [BigInt(id)], `Released plan #${id} to the child`)
    } else if (!p.closed && p.mandateOn && now >= Number(p.nextDue)) {
      await act('collect', deployment.savings, abi.savings, [BigInt(id)], `Collected plan #${id}'s instalment`)
    }
    p = await savings('planOf', [BigInt(id)])
    const book = await savings('passbookOf', [BigInt(id)])
    const prev = db.seen.plans[id] ?? { entries: book.length, closed: p.closed, fresh: true }
    for (const e of book.slice(prev.fresh ? book.length : prev.entries)) {
      const kind = KINDS[e.kind]
      if (kind === 'Missed') notify([p.parent], { kind: 'plan', plan: id, title: `${p.name}: instalment missed`, body: `We could not collect ${usd(e.amount)}. No penalty. Add money and it will be collected next time, or top up now.` })
      else if (kind === 'Gift') notify([p.parent, p.child], { kind: 'plan', plan: id, title: `${p.name}: a gift arrived`, body: `${short(e.from)} added ${usd(e.amount)}.` })
      else if (kind === 'Instalment') notify([p.parent], { kind: 'plan', plan: id, title: `${p.name}: ${usd(e.amount)} saved`, body: `Instalment ${p.paidCount} collected.` })
    }
    if (p.closed && !prev.closed) {
      notify([p.child, p.parent, p.nominee], { kind: 'plan', plan: id, title: `${p.name} has matured`, body: `The savings, with any interest, went to ${short(p.child)}.` })
    }
    db.seen.plans[id] = { entries: book.length, closed: p.closed }
  }
  save()
}

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
function when(at, now) {
  const s = at - now
  if (s <= 0) return 'now'
  if (s < 120) return `in ${s} seconds`
  if (s < 7200) return `in ${Math.round(s / 60)} minutes`
  if (s < 172800) return `in ${Math.round(s / 3600)} hours`
  return `in ${Math.round(s / 86400)} days`
}

export async function tick() {
  const now = Number((await client.getBlock()).timestamp)
  await discoverOwners()
  await watchWills(now)
  await watchPlans(now)
  status.lastTick = Date.now()
  status.lastError = null
}

export function start() {
  let running = false
  const loop = async () => {
    if (running) return
    running = true
    try {
      await tick()
    } catch (e) {
      status.lastError = e?.shortMessage ?? e?.message ?? String(e)
      console.error('watcher:', status.lastError)
    } finally {
      running = false
    }
  }
  loop()
  return setInterval(loop, EVERY_MS)
}
