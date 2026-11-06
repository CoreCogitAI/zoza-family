// The demo family. Each person has a wallet whose key is made on this device
// and kept in this browser only. These are test wallets: in the Zoza app the
// key lives in the phone's secure hardware instead.
import { createWalletClient, custom, getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const PEOPLE = [
  { id: 'priya', name: 'Priya', role: 'Parent', about: 'Saves for her children and keeps her will', tone: 'teal' },
  { id: 'meera', name: 'Meera', role: 'Daughter, 6', about: 'Her studies and wedding plans', tone: 'rose' },
  { id: 'arjun', name: 'Arjun', role: 'Son, 24', about: 'Named in his mother\'s will', tone: 'indigo' },
  { id: 'ravi', name: 'Ravi', role: 'Uncle, nominee', about: 'Guards the children\'s plans', tone: 'amber' },
  { id: 'dada', name: 'Dada', role: 'Grandfather', about: 'Sends gifts for birthdays', tone: 'green' },
]
const KEY = 'zf.family.v1'

// Someone who joined a family from their own device: a wallet they connected,
// or a key made in this browser. Stored as { kind, address, key?, name, inviter }.
const SELF = 'zf.self'
const TONES = ['indigo', 'amber', 'green', 'rose', 'teal']
const toneOf = (a) => TONES[parseInt(a.slice(2, 4), 16) % TONES.length]

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (saved && PEOPLE.every((p) => saved[p.id])) return saved
  } catch {}
  const keys = Object.fromEntries(PEOPLE.map((p) => [p.id, generatePrivateKey()]))
  try {
    localStorage.setItem(KEY, JSON.stringify(keys))
  } catch {}
  return keys
}

let keys = load()
let members = []
export let family = build()

function build() {
  const people = PEOPLE.map((p) => {
    const signer = privateKeyToAccount(keys[p.id])
    return { ...p, address: signer.address, signer, persona: true }
  })
  const me = self()
  const all = [...people, ...(me ? [me] : []), ...members]
  return all.filter((p, i) => all.findIndex((q) => q.address.toLowerCase() === p.address.toLowerCase()) === i)
}

export function loadSelf() {
  try {
    return JSON.parse(localStorage.getItem(SELF) ?? 'null')
  } catch {
    return null
  }
}

function self() {
  const s = loadSelf()
  if (!s) return null
  const signer = s.kind === 'local' ? privateKeyToAccount(s.key) : injectedSigner(s.address)
  return { id: 'self', name: s.name, role: `${s.inviter.name}'s ${s.role}`, about: s.kind === 'local' ? 'A wallet made in this browser' : 'Your own wallet', tone: toneOf(s.address), address: getAddress(s.address), signer, injected: s.kind !== 'local' }
}

export function saveSelf(s) {
  try {
    localStorage.setItem(SELF, JSON.stringify(s))
  } catch {}
  family = build()
}

/// A browser wallet (MetaMask and others). It signs typed data and messages;
/// it cannot sign a 7702 upgrade for us, so its own actions pay their own gas.
export function injectedSigner(address) {
  const wallet = createWalletClient({ account: getAddress(address), chain: sepolia, transport: custom(window.ethereum) })
  return {
    address: getAddress(address),
    injected: true,
    wallet,
    signTypedData: (args) => wallet.signTypedData(args),
    signMessage: ({ message }) => wallet.signMessage({ message }),
  }
}

/// People this family invited who accepted, so plans and wills can name them.
export async function loadMembers() {
  const s = loadSelf()
  const from = [...PEOPLE.map((p) => privateKeyToAccount(keys[p.id]).address), ...(s ? [s.address] : [])]
  try {
    const list = await fetch(`/api/invites?from=${from.join(',')}`).then((r) => r.json())
    members = list
      .filter((i) => i.acceptedBy)
      .map((i) => ({ id: `m-${i.acceptedBy.toLowerCase()}`, name: i.name, role: `${i.fromName}'s ${i.role === 'family' ? 'family' : i.role}`, about: 'Joined with their own wallet', tone: toneOf(i.acceptedBy), address: i.acceptedBy, signer: null }))
    if (s) members.push({ id: `m-${s.inviter.address.toLowerCase()}`, name: s.inviter.name, role: 'Invited you', about: 'Invited you to their family', tone: toneOf(s.inviter.address), address: s.inviter.address, signer: null })
  } catch {}
  family = build()
  return family
}

export const person = (id) => family.find((p) => p.id === id && p.signer) ?? family[0]
export const byAddress = (a) => family.find((p) => p.address.toLowerCase() === a?.toLowerCase())
export const nameOf = (a) => byAddress(a)?.name ?? `${a.slice(0, 6)}…${a.slice(-4)}`

export function current() {
  try {
    return person(localStorage.getItem('zf.me') ?? 'priya')
  } catch {
    return family[0]
  }
}

export function choose(id) {
  try {
    localStorage.setItem('zf.me', id)
  } catch {}
}

/// New keys for everyone: a fresh family on chain.
export function resetFamily() {
  keys = Object.fromEntries(PEOPLE.map((p) => [p.id, generatePrivateKey()]))
  try {
    localStorage.setItem(KEY, JSON.stringify(keys))
    localStorage.removeItem('zf.cache')
  } catch {}
  family = build()
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
