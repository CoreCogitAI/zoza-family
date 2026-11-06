// The demo family. Each person has a wallet whose key is made on this device
// and kept in this browser only. These are test wallets: in the Zoza app the
// key lives in the phone's secure hardware instead.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const PEOPLE = [
  { id: 'priya', name: 'Priya', role: 'Parent', about: 'Saves for her children and keeps her will', tone: 'teal' },
  { id: 'meera', name: 'Meera', role: 'Daughter, 6', about: 'Her studies and wedding plans', tone: 'rose' },
  { id: 'arjun', name: 'Arjun', role: 'Son, 24', about: 'Named in his mother\'s will', tone: 'indigo' },
  { id: 'ravi', name: 'Ravi', role: 'Uncle, nominee', about: 'Guards the children\'s plans', tone: 'amber' },
  { id: 'dada', name: 'Dada', role: 'Grandfather', about: 'Sends gifts for birthdays', tone: 'green' },
]
const KEY = 'zf.family.v1'

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
export let family = build()

function build() {
  return PEOPLE.map((p) => {
    const signer = privateKeyToAccount(keys[p.id])
    return { ...p, address: signer.address, signer }
  })
}

export const person = (id) => family.find((p) => p.id === id) ?? family[0]
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
