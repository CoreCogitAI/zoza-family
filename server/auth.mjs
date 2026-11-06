// Inboxes and family lists hold names and relationships, which the chain does
// not show. Only a browser that proved it holds an address may read them: it
// signs readMessage once, and sends the signature in the x-zoza-auth header.
import { isAddress, verifyMessage } from 'viem'
import { readMessage } from '../shared/invites.mjs'

const MAX_DAYS = 8
const ok = new Map() // signature -> expiry, so a token is checked once

/// The addresses this request may read, lowercase.
export async function readers(req) {
  const out = new Set()
  const raw = req.headers['x-zoza-auth']
  if (!raw) return out
  let list
  try {
    list = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))
  } catch {
    return out
  }
  const now = Math.floor(Date.now() / 1000)
  for (const t of Array.isArray(list) ? list.slice(0, 10) : []) {
    if (!isAddress(t?.address ?? '') || !(t.expiry > now && t.expiry < now + MAX_DAYS * 86400)) continue
    const known = ok.get(t.signature)
    const valid = known === t.expiry || (await verifyMessage({ address: t.address, message: readMessage(t.address, t.expiry), signature: t.signature }).catch(() => false))
    if (valid) {
      ok.set(t.signature, t.expiry)
      out.add(t.address.toLowerCase())
    }
  }
  return out
}
