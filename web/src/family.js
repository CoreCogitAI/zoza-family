// Who is using this browser. A visitor starts signed out and chooses:
//   wallet  their own wallet (MetaMask and others), or a key made here
//   demo    the demo family, five test wallets made and kept in this browser
// In the Zoza app the key lives in the phone's secure hardware instead.
import { createWalletClient, custom, getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
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

// Last known members, so names show at once while a fresh list loads privately.
const MEMBERS = 'zf.members'
let members = (() => {
  try {
    return JSON.parse(get(MEMBERS) ?? '[]')
  } catch {
    return []
  }
})()
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
  set(SELF, JSON.stringify(s))
  if (mode() !== 'demo') set(MODE, 'wallet')
  family = build()
}

/// Use a browser wallet (one from wallets()) as "you".
export async function connectWallet(w) {
  const client = createWalletClient({ chain: sepolia, transport: custom(w.provider) })
  const [address] = await client.requestAddresses()
  await client.switchChain({ id: sepolia.id }).catch(() => {})
  set(MODE, 'wallet')
  saveSelf({ kind: 'injected', wallet: w.id, address: getAddress(address), name: loadSelf()?.name ?? 'You', role: 'family', inviter: null })
  // One signature now, so the inbox and family list can be read for a week.
  await tokenFor(self(), true).catch(() => null)
  choose('self')
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
  set(SELF, null)
  set(MODE, null)
  set('zf.me', null)
  set(MEMBERS, null)
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

/// Follow the wallet: a different account becomes "you"; none signs out.
export function watchWallet(onChange) {
  const s = loadSelf()
  if (s?.kind !== 'injected') return () => {}
  const p = providerFor(s.wallet)
  if (!p?.on) return () => {}
  const handler = (accounts) => {
    const now = loadSelf()
    if (!now || now.kind !== 'injected') return
    if (!accounts?.length) signOut()
    else if (getAddress(accounts[0]) !== getAddress(now.address)) saveSelf({ ...now, address: getAddress(accounts[0]), name: 'You', inviter: null })
    else return
    onChange()
  }
  p.on('accountsChanged', handler)
  return () => p.removeListener?.('accountsChanged', handler)
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
    members = list
      .filter((i) => i.acceptedBy)
      .map((i) => ({ id: `m-${i.acceptedBy.toLowerCase()}`, name: i.name, role: `${i.fromName}'s ${i.role === 'family' ? 'family' : i.role}`, about: 'Joined with their own wallet', tone: toneOf(i.acceptedBy), address: i.acceptedBy, signer: null }))
    if (s?.inviter) members.push({ id: `m-${s.inviter.address.toLowerCase()}`, name: s.inviter.name, role: 'Invited you', about: 'Invited you to their family', tone: toneOf(s.inviter.address), address: s.inviter.address, signer: null })
    set(MEMBERS, JSON.stringify(members))
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
