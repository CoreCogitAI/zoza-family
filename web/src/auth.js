// Proof that this browser holds an address, so the server shows its inbox and
// family list. Each person signs once for 7 days. Keys made in this browser
// sign silently; a connected wallet is asked only when `ask` is set.
import { readMessage } from '../../shared/invites.mjs'

const KEY = 'zf.auth'
const DAYS = 7

function saved() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export async function tokenFor(person, ask = false) {
  if (!person?.signer?.signMessage) return null
  const a = person.address.toLowerCase()
  const all = saved()
  const now = Math.floor(Date.now() / 1000)
  if (all[a]?.expiry > now + 3600) return all[a]
  if (person.signer.injected && !ask) return null
  const expiry = now + DAYS * 86400
  const signature = await person.signer.signMessage({ message: readMessage(a, expiry) })
  all[a] = { address: a, expiry, signature }
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {}
  return all[a]
}

/// Whether the server will show this person's family list and inbox without a
/// new signature. A key made in this browser signs the pass silently.
export function hasPass(person) {
  if (!person?.signer?.signMessage) return false
  if (!person.signer.injected) return true
  return saved()[person.address.toLowerCase()]?.expiry > Math.floor(Date.now() / 1000) + 3600
}

export async function authHeader(people) {
  const tokens = []
  for (const p of people) {
    const t = await tokenFor(p).catch(() => null)
    if (t) tokens.push(t)
  }
  if (!tokens.length) return {}
  const b64 = btoa(JSON.stringify(tokens)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return { 'x-zoza-auth': b64 }
}
