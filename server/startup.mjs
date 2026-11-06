import { getAddress, isAddress } from 'viem'

export class StartupError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`

export function getPolicy(db, owner) {
  if (!isAddress(owner)) throw new StartupError('invalid founder address')
  return db.startupPolicies[getAddress(owner).toLowerCase()] ?? null
}

export function savePolicy(db, save, owner, body) {
  owner = getAddress(owner)
  const keyAddress = body.keyAddress && isAddress(body.keyAddress) ? getAddress(body.keyAddress) : owner
  const approvers = [...new Set((body.approvers ?? []).filter(isAddress).map(getAddress).map((a) => a.toLowerCase()))]
  const requiredApprovers = Math.max(1, Math.min(approvers.length || 1, Number(body.requiredApprovers ?? 1)))
  const policy = {
    owner,
    name: String(body.name ?? 'Startup wallet').slice(0, 80),
    keyAddress,
    dailyLimit: String(body.dailyLimit ?? '').trim(),
    singleLimit: String(body.singleLimit ?? '').trim(),
    allowedTokens: [...new Set((body.allowedTokens ?? []).filter(isAddress).map(getAddress))],
    allowedRecipients: [...new Set((body.allowedRecipients ?? []).filter(isAddress).map(getAddress))],
    approvers: approvers.map((a) => getAddress(a)),
    requiredApprovers,
    active: body.active !== false,
    updatedAt: Date.now(),
  }
  db.startupPolicies[owner.toLowerCase()] = policy
  db.startupAudit.unshift({ id: uid(), at: Date.now(), owner, actor: owner, action: 'policy.updated', reason: policy.name })
  db.startupAudit.length = Math.min(db.startupAudit.length, 1000)
  save()
  return policy
}

function unsignedAmount(value) {
  if (!/^\d+(\.\d{1,6})?$/.test(String(value ?? '').trim())) throw new StartupError('amount must be a positive USDC decimal with at most 6 decimal places')
  const [whole = '0', fraction = ''] = String(value).split('.')
  const minor = BigInt(whole) * (10n ** 6n) + BigInt(fraction.padEnd(6, '0'))
  if (minor <= 0n) throw new StartupError('amount must be greater than zero')
  return minor
}

function decimalAmount(value) {
  if (!String(value ?? '').trim()) return null
  return unsignedAmount(value)
}

export function createProposal(db, save, owner, body, proposer) {
  const policy = getPolicy(db, owner)
  if (!policy?.active) throw new StartupError('startup policy is not active', 404)
  const recipient = body.recipient && isAddress(body.recipient) ? getAddress(body.recipient) : null
  if (!recipient) throw new StartupError('recipient is required')
  if (policy.allowedRecipients.length && !policy.allowedRecipients.includes(recipient)) throw new StartupError('recipient is not allowlisted')
  if (body.token && isAddress(body.token) && policy.allowedTokens.length && !policy.allowedTokens.includes(getAddress(body.token))) throw new StartupError('token is not allowlisted')
  const amount = unsignedAmount(body.amount)
  const singleLimit = decimalAmount(policy.singleLimit)
  if (singleLimit && amount > singleLimit) throw new StartupError('amount exceeds the single-payment limit')
  const now = Date.now()
  const dayStart = now - 86400000
  const approvedToday = db.startupProposals
    .filter((p) => p.owner.toLowerCase() === owner.toLowerCase() && p.status === 'approved' && p.updatedAt >= dayStart)
    .reduce((sum, p) => {
      try { return sum + unsignedAmount(p.amount) } catch { return sum }
    }, 0n)
  const dailyLimit = decimalAmount(policy.dailyLimit)
  if (dailyLimit && approvedToday + amount > dailyLimit) throw new StartupError('amount would exceed the daily limit')
  const proposal = {
    id: uid(), owner: getAddress(owner), keyAddress: policy.keyAddress, proposer: getAddress(proposer),
    recipient, token: body.token && isAddress(body.token) ? getAddress(body.token) : null,
    amount: String(body.amount), reason: String(body.reason ?? '').slice(0, 200),
    status: 'pending', approvals: [], requiredApprovers: policy.requiredApprovers,
    createdAt: now, updatedAt: now,
  }
  db.startupProposals.unshift(proposal)
  db.startupAudit.unshift({ id: uid(), at: now, owner: proposal.owner, actor: proposal.proposer, action: 'proposal.created', proposal: proposal.id, reason: proposal.reason })
  db.startupAudit.length = Math.min(db.startupAudit.length, 1000)
  save()
  return proposal
}

export function decideProposal(db, save, owner, id, actor, decision) {
  const policy = getPolicy(db, owner)
  if (!policy?.active) throw new StartupError('startup policy is not active', 404)
  const proposal = db.startupProposals.find((p) => p.id === id && p.owner.toLowerCase() === owner.toLowerCase())
  if (!proposal) throw new StartupError('proposal not found', 404)
  if (proposal.status !== 'pending') throw new StartupError('proposal is already decided')
  const approver = getAddress(actor).toLowerCase()
  if (!policy.approvers.some((a) => a.toLowerCase() === approver)) throw new StartupError('actor is not an approver', 403)
  if (proposal.proposer.toLowerCase() === approver) throw new StartupError('the proposal creator cannot approve their own request', 403)
  if (decision === 'approved') {
    if (!proposal.approvals.includes(actor)) proposal.approvals.push(getAddress(actor))
    proposal.updatedAt = Date.now()
    if (proposal.approvals.length >= proposal.requiredApprovers) proposal.status = 'approved'
  } else if (decision === 'rejected') {
    proposal.status = 'rejected'
    proposal.updatedAt = Date.now()
  } else throw new StartupError('decision must be approved or rejected')
  db.startupAudit.unshift({ id: uid(), at: Date.now(), owner: proposal.owner, actor: getAddress(actor), action: `proposal.${proposal.status}`, proposal: proposal.id, reason: decision })
  db.startupAudit.length = Math.min(db.startupAudit.length, 1000)
  save()
  return proposal
}

export function listProposals(db, owner) {
  return db.startupProposals.filter((p) => p.owner.toLowerCase() === owner.toLowerCase())
}

export function auditCsv(db, owner) {
  const rows = [['id', 'at', 'owner', 'actor', 'action', 'proposal', 'reason'], ...db.startupAudit
    .filter((a) => a.owner.toLowerCase() === owner.toLowerCase())
    .map((a) => [a.id, new Date(a.at).toISOString(), a.owner, a.actor, a.action, a.proposal ?? '', a.reason ?? ''])]
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}
