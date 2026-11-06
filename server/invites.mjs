// Family invites. A person invites someone by name and role; the invitee
// accepts by signing with their own wallet, so a plan or a will only ever names
// an address its owner has proven. The family list lives here, off chain.
import { randomBytes } from 'node:crypto'
import { getAddress, isAddress, verifyMessage } from 'viem'
import { acceptMessage, inviteMessage, removeMessage, ROLES } from '../shared/invites.mjs'
import { db, notify, save } from './store.mjs'

const MAX_OPEN = 30

export class InviteError extends Error {}

// A malformed signature is a wrong signature, not a server error.
const signedBy = (address, message, signature) => verifyMessage({ address, message, signature }).catch(() => false)
const clean = (s, n) => String(s ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, n)
const view = (i) => ({ code: i.code, from: i.from, fromName: i.fromName, name: i.name, role: i.role, at: i.at, acceptedBy: i.acceptedBy ?? null, acceptedAt: i.acceptedAt ?? null })

/// Step 1: the inviter asks for a code, signs inviteMessage, then calls create.
export function newCode() {
  return randomBytes(9).toString('base64url')
}

export async function create({ code, from, fromName, name, role, signature }) {
  if (!/^[A-Za-z0-9_-]{12}$/.test(code ?? '') || db.invites[code]) throw new InviteError('bad code')
  if (!isAddress(from ?? '')) throw new InviteError('bad address')
  if (!ROLES[role]) throw new InviteError('bad role')
  const i = { code, from: getAddress(from), fromName: clean(fromName, 40), name: clean(name, 40), role, at: Date.now() }
  if (!i.fromName || !i.name) throw new InviteError('names required')
  if (Object.values(db.invites).filter((x) => x.from === i.from && !x.acceptedBy).length >= MAX_OPEN) throw new InviteError('too many open invites')
  if (!(await signedBy(i.from, inviteMessage(i), signature))) throw new InviteError('signature does not match the inviter')
  db.invites[code] = i
  save()
  return view(i)
}

export function get(code) {
  const i = db.invites[code]
  if (!i) throw new InviteError('no such invite')
  return view(i)
}

export async function accept(code, { address, signature }) {
  const i = db.invites[code]
  if (!i) throw new InviteError('no such invite')
  if (i.acceptedBy) throw new InviteError('this invite was already accepted')
  if (!isAddress(address ?? '')) throw new InviteError('bad address')
  const who = getAddress(address)
  if (who === i.from) throw new InviteError('you cannot accept your own invite')
  if (!(await signedBy(who, acceptMessage(i), signature))) throw new InviteError('signature does not match this wallet')
  i.acceptedBy = who
  i.acceptedAt = Date.now()
  save()
  notify([i.from], { kind: 'family', title: `${i.name} joined your family`, body: `${i.name} accepted your invite as your ${ROLES[i.role]}, with wallet ${who}.` })
  return view(i)
}

/// The inviter cancels or removes an invite, or the person who accepted it
/// leaves. Either one signs removeMessage; the other is told.
export async function remove(code, { address, signature }) {
  const i = db.invites[code]
  if (!i) throw new InviteError('no such invite')
  if (!isAddress(address ?? '')) throw new InviteError('bad address')
  const who = getAddress(address)
  if (who !== i.from && who !== i.acceptedBy) throw new InviteError('only the inviter or the person who joined can remove this')
  if (!(await signedBy(who, removeMessage(i), signature))) throw new InviteError('signature does not match this wallet')
  delete db.invites[code]
  save()
  if (i.acceptedBy) {
    const other = who === i.from ? i.acceptedBy : i.from
    notify([other], { kind: 'family', title: who === i.from ? `${i.fromName} removed you from their family` : `${i.name} left your family`, body: `The invite for ${i.name} as ${i.fromName}'s ${ROLES[i.role]} was removed. Plans or a will that name this wallet are not changed.` })
  }
  return { removed: code }
}

/// Everyone the given people invited, pending and accepted, and the invites
/// they accepted themselves, so "who invited me" survives a new browser.
export const sentBy = (owners) => {
  const set = new Set(owners.map((a) => a.toLowerCase()))
  return Object.values(db.invites).filter((i) => set.has(i.from.toLowerCase()) || set.has(i.acceptedBy?.toLowerCase())).map(view)
}
