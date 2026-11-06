// Who is using this browser. A visitor starts signed out and chooses:
//   wallet  their own wallet (MetaMask and others), or a key made here
//   demo    the demo family, five test wallets made and kept in this browser
// In the Zoza app the key lives in the phone's secure hardware instead.
import { createWalletClient, custom, getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { removeMessage } from '../../shared/invites.mjs'
import { serverFetch } from './anon.js'
import { authHeader, tokenFor } from './auth.js'
import { providerFor } from './wallets.js'

export const PEOPLE = [
  { id: 'priya', name: 'Priya', role: 'Parent', about: 'Saves for her children and keeps her will', tone: 'teal' },
  { id: 'meera', name: 'Meera', role: 'Daughter, 6', about: 'Her studies and wedding plans', tone: 'rose' },
  { id: 'arjun', name: 'Arjun', role: 'Son, 24', about: 'Named in his mother\'s will', tone: 'indigo' },
  { id: 'ravi', name: 'Ravi', role: 'Uncle, nominee', about: 'Guards the children\'s plans', tone: 'amber' },
  { id: 'dada', name: 'Dada', role: 'Grandfather', about: 'Sends gifts for birthdays', tone: 'green' },
]
const KEY = 'zf.family.v1'
const SELF = 'zf.self' // { kind: 'injected' | 'local', address, key?, wallet?, name, role, inviter }
const MODE = 'zf.mode'
const TONES = ['indigo', 'amber', 'green', 'rose', 'teal']
const toneOf = (a) => TONES[parseInt(a.slice(2, 4), 16) % TONES.length]

const get = (k) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const set = (k, v) => {
  try {
    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v)
  } catch {}
}

export function mode() {
  const m = get(MODE)
  if (m) return m
  // Earlier visits: someone who picked a person or joined keeps their session.
  if (get(SELF)) return 'wallet'
  if (get('zf.me') && get(KEY)) return 'demo'
  return null
}

function demoKeys() {
  try {
    const saved = JSON.parse(get(KEY) ?? 'null')
    if (saved && PEOPLE.every((p) => saved[p.id])) return saved
  } catch {}
  return null
}

// Last known members of each person's family, so names show at once while a
// fresh list loads privately.
const membersKey = () => `zf.members.${(loadSelf()?.address ?? mode() ?? '').toLowerCase()}`
function readMembers() {
  try {
    return JSON.parse(get(membersKey()) ?? '[]')
  } catch {
    return []
  }
}
let members = readMembers()

// One wallet can hold several accounts (a father and a son, say). Each keeps its
// own name, role and inviter, so switching accounts does not wipe them.
const PROFILES = 'zf.profiles'
function profiles() {
  try {
    return JSON.parse(get(PROFILES) ?? '{}')
  } catch {
    return {}
  }
}
export const profileOf = (address) => profiles()[address.toLowerCase()] ?? { name: 'You', role: 'family', inviter: null }
export let family = build()

function build() {
  if (mode() === 'demo' && !demoKeys()) set(KEY, JSON.stringify(Object.fromEntries(PEOPLE.map((p) => [p.id, generatePrivateKey()]))))
  const keys = mode() === 'demo' ? demoKeys() : null
  const people = keys ? PEOPLE.map((p) => ({ ...p, address: privateKeyToAccount(keys[p.id]).address, signer: privateKeyToAccount(keys[p.id]), persona: true })) : []
  const me = self()
  const all = [...people, ...(me ? [me] : []), ...members]
  return all.filter((p, i) => all.findIndex((q) => q.address.toLowerCase() === p.address.toLowerCase()) === i)
}

export function loadSelf() {
  try {
    return JSON.parse(get(SELF) ?? 'null')
  } catch {
    return null
  }
}

function self() {
  const s = loadSelf()
  if (!s) return null
  const signer = s.kind === 'local' ? privateKeyToAccount(s.key) : injectedSigner(s.address, s.wallet)
  const role = s.inviter ? `${s.inviter.name}'s ${s.role}` : s.kind === 'local' ? 'Wallet made here' : 'Your wallet'
  return { id: 'self', name: s.name, role, about: s.kind === 'local' ? 'A wallet made in this browser' : 'Your own wallet', tone: toneOf(s.address), address: getAddress(s.address), signer, injected: s.kind !== 'local' }
}

export function saveSelf(s) {
  const before = loadSelf()?.address?.toLowerCase()
  set(SELF, JSON.stringify(s))
  if (s?.address) set(PROFILES, JSON.stringify({ ...profiles(), [s.address.toLowerCase()]: { name: s.name, role: s.role, inviter: s.inviter ?? null } }))
  if (s?.address?.toLowerCase() !== before) members = readMembers()
  if (mode() !== 'demo') set(MODE, 'wallet')
  family = build()
}

/// Use a browser wallet (one from wallets()) as "you".
/// `step` names what the wallet is asking, since its prompt may sit in a side panel.
export async function connectWallet(w, step = () => {}) {
  const client = createWalletClient({ chain: sepolia, transport: custom(w.provider) })
  step(`Approve the connection in ${w.name}.`)
  const [address] = await client.requestAddresses()
  step(`Allow ${w.name} to switch to the Sepolia test network.`)
  // A wallet that never answers the switch must not hold up signing in.
  await Promise.race([client.switchChain({ id: sepolia.id }).catch(() => {}), new Promise((ok) => setTimeout(ok, 15_000))])
  set(MODE, 'wallet')
  saveSelf({ kind: 'injected', wallet: w.id, address: getAddress(address), ...profileOf(address) })
  choose('self')
  // One signature, so the inbox and family list can be read for a week. Not
  // awaited: the page opens now, and the invite card asks again if it is skipped.
  tokenFor(self(), true)
    .then(() => loadMembers())
    .catch(() => null)
}

/// A key made in this browser, for someone without a wallet.
export function makeWallet(name) {
  const key = generatePrivateKey()
  set(MODE, 'wallet')
  saveSelf({ kind: 'local', key, address: privateKeyToAccount(key).address, name: name || 'You', role: 'family', inviter: null })
  choose('self')
}

/// The demo family: five test wallets made once and kept in this browser.
export function startDemo() {
  if (!demoKeys()) set(KEY, JSON.stringify(Object.fromEntries(PEOPLE.map((p) => [p.id, generatePrivateKey()]))))
  set(MODE, 'demo')
  family = build()
  choose('priya')
}

export function signOut() {
  set(membersKey(), null)
  set(SELF, null)
  set(MODE, null)
  set('zf.me', null)
  members = []
  family = build()
}

/// A browser wallet signs typed data and messages; it cannot sign a 7702
/// upgrade for us, so its own actions send their own transactions.
export function injectedSigner(address, walletId) {
  const provider = () => providerFor(walletId)
  const client = () => createWalletClient({ account: getAddress(address), chain: sepolia, transport: custom(provider()) })
  return {
    address: getAddress(address),
    injected: true,
    get wallet() {
      return client()
    },
    signTypedData: (args) => client().signTypedData(args),
    signMessage: ({ message }) => client().signMessage({ message }),
  }
}

/// Follow the wallet: a different account becomes "you".
export function watchWallet(onChange) {
  const s = loadSelf()
  if (s?.kind !== 'injected') return () => {}
  const p = providerFor(s.wallet)
  if (!p?.on) return () => {}
  const handler = (accounts) => {
    const now = loadSelf()
    if (!now || now.kind !== 'injected') return
    // No accounts also means the wallet locked itself; keep the session, since
    // reads need no wallet and a write asks it to unlock. Sign out is in the menu.
    if (!accounts?.length) return
    if (getAddress(accounts[0]) === getAddress(now.address)) return
    saveSelf({ ...now, address: getAddress(accounts[0]), ...profileOf(accounts[0]) })
    onChange()
    // A new account signs its own read pass, then its family list loads.
    tokenFor(self(), true)
      .then(() => loadMembers())
      .then(() => onChange())
      .catch(() => null)
  }
  p.on('accountsChanged', handler)
  return () => p.removeListener?.('accountsChanged', handler)
}

/// Cancel or remove an invite you sent, or leave a family you joined. Plans and
/// wills already naming the wallet are not changed; this only edits the list.
export async function removeInvite(person, invite) {
  const signature = await person.signer.signMessage({ message: removeMessage(invite) })
  const res = await serverFetch(`/api/invites/${invite.code}/remove`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: person.address, signature }) }, person.address)
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error ?? `error ${res.status}`)
  const s = loadSelf()
  if (s?.inviter && s.inviter.address.toLowerCase() === invite.from.toLowerCase() && person.id === 'self') saveSelf({ ...s, inviter: null })
  members = members.filter((m) => m.invite?.code !== invite.code)
  return loadMembers()
}

/// People this browser's people invited who accepted, so plans and wills can name them.
export async function loadMembers() {
  const s = loadSelf()
  const readers = build().filter((p) => p.signer)
  try {
    const headers = await authHeader(readers)
    const res = readers.length ? await serverFetch(`/api/invites?from=${readers.map((p) => p.address).join(',')}`, { headers }) : null
    // A failed or locked read keeps the last known list.
    if (res && !res.ok) return family
    const list = res ? await res.json() : []
    const mine = new Set(readers.map((p) => p.address.toLowerCase()))
    // A browser that lost this person's name or inviter gets them back from the invites.
    if (s) {
      const me = s.address.toLowerCase()
      const sentByMe = list.filter((i) => i.from.toLowerCase() === me && i.fromName && i.fromName !== 'You').sort((a, b) => b.at - a.at)[0]
      const joined = list.find((i) => i.acceptedBy?.toLowerCase() === me)
      const fix = {}
      if ((!s.name || s.name === 'You') && (sentByMe || joined)) fix.name = sentByMe?.fromName ?? joined.name
      if (!s.inviter && joined) Object.assign(fix, { inviter: { address: joined.from, name: joined.fromName }, role: joined.role })
      if (Object.keys(fix).length) saveSelf({ ...s, ...fix })
    }
    // Invites these people accepted: the inviter is family too.
    const inviters = list
      .filter((i) => mine.has(i.acceptedBy?.toLowerCase()) && !mine.has(i.from.toLowerCase()))
      .map((i) => ({ id: `m-${i.from.toLowerCase()}`, name: i.fromName, role: 'Invited you', about: 'Invited you to their family', tone: toneOf(i.from), address: i.from, signer: null, invite: i }))
    members = list
      .filter((i) => i.acceptedBy && mine.has(i.from.toLowerCase()))
      .map((i) => ({ id: `m-${i.acceptedBy.toLowerCase()}`, name: i.name, role: `${i.fromName}'s ${i.role === 'family' ? 'family' : i.role}`, about: 'Joined with their own wallet', tone: toneOf(i.acceptedBy), address: i.acceptedBy, signer: null, invite: i }))
    members.push(...inviters)
    if (s?.inviter) members.push({ id: `m-${s.inviter.address.toLowerCase()}`, name: s.inviter.name, role: 'Invited you', about: 'Invited you to their family', tone: toneOf(s.inviter.address), address: s.inviter.address, signer: null })
    set(membersKey(), JSON.stringify(members))
  } catch {}
  family = build()
  return family
}

export const person = (id) => family.find((p) => p.id === id && p.signer) ?? family.find((p) => p.signer) ?? null
export const byAddress = (a) => family.find((p) => p.address.toLowerCase() === a?.toLowerCase())
export const nameOf = (a) => byAddress(a)?.name ?? `${a.slice(0, 6)}…${a.slice(-4)}`

export function current() {
  const m = mode()
  if (!m) return null
  return person(get('zf.me') ?? (m === 'wallet' ? 'self' : 'priya'))
}

export function choose(id) {
  set('zf.me', id)
}

// Demo timing: a month passes in a minute, so a plan can mature on stage.
export function demoTime() {
  try {
    return localStorage.getItem('zf.demoTime') !== 'off'
  } catch {
    return true
  }
}
export function setDemoTime(on) {
  try {
    localStorage.setItem('zf.demoTime', on ? 'on' : 'off')
  } catch {}
}
export const MONTH = () => (demoTime() ? 60 : 30 * 86400)
export const DAY = () => (demoTime() ? 2 : 86400)
