import { useCallback, useEffect, useState } from 'react'
import { authHeader } from '../auth.js'
import { useApp } from '../main.jsx'
import { Callout, Empty, Icon } from '../ui.jsx'

export default function Startup() {
  const { me } = useApp()
  const [policy, setPolicy] = useState(null)
  const [proposals, setProposals] = useState([])
  const [name, setName] = useState('Startup wallet')
  const [keyAddress, setKeyAddress] = useState(me.address)
  const [singleLimit, setSingleLimit] = useState('500')
  const [dailyLimit, setDailyLimit] = useState('2000')
  const [approvers, setApprovers] = useState(me.address)
  const [requiredApprovers, setRequiredApprovers] = useState(1)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('100')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const headers = useCallback(async () => ({ 'content-type': 'application/json', ...(await authHeader([me])) }), [me])
  const refresh = useCallback(async () => {
    const h = await headers()
    const [p, q] = await Promise.all([
      fetch(`/api/startup/policy?owner=${me.address}`, { headers: h }),
      fetch(`/api/startup/proposals?owner=${me.address}`, { headers: h }),
    ])
    const pj = await p.json().catch(() => ({}))
    const qj = await q.json().catch(() => ({ proposals: [] }))
    setPolicy(pj.policy ?? null)
    setProposals(qj.proposals ?? [])
    if (pj.policy) {
      setName(pj.policy.name ?? 'Startup wallet')
      setKeyAddress(pj.policy.keyAddress ?? me.address)
      setSingleLimit(pj.policy.singleLimit ?? '')
      setDailyLimit(pj.policy.dailyLimit ?? '')
      setApprovers((pj.policy.approvers ?? []).join('\n'))
      setRequiredApprovers(pj.policy.requiredApprovers ?? 1)
    }
  }, [headers, me.address])
  useEffect(() => { refresh() }, [refresh])

  const save = async () => {
    setBusy(true); setError(null)
    try {
      const h = await headers()
      const list = approvers.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)
      const res = await fetch(`/api/startup/policy?owner=${me.address}`, { method: 'PUT', headers: h, body: JSON.stringify({ name, keyAddress, singleLimit, dailyLimit, approvers: list, requiredApprovers: Number(requiredApprovers), active: true }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not save policy')
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const create = async () => {
    setBusy(true); setError(null)
    try {
      const h = await headers()
      const res = await fetch('/api/startup/proposals', { method: 'POST', headers: h, body: JSON.stringify({ owner: me.address, actor: me.address, recipient, amount, reason }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not create proposal')
      setRecipient(''); setAmount('100'); setReason('')
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const decide = async (id, decision) => {
    setBusy(true); setError(null)
    try {
      const h = await headers()
      const res = await fetch('/api/startup/proposals/decide', { method: 'POST', headers: h, body: JSON.stringify({ owner: me.address, actor: me.address, id, decision }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not review proposal')
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const download = async () => {
    const h = await authHeader([me])
    const res = await fetch(`/api/startup/audit.csv?owner=${me.address}`, { headers: h })
    if (!res.ok) return
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url; a.download = 'startup-audit.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Small startup controls</div><h1>Startup wallet policy</h1><p className="lede">Set payment limits and approvals for employees or agents, then export the audit trail.</p></div><button className="btn small" onClick={download}><Icon name="download" /> Export audit CSV</button></div>
      {error && <Callout tone="bad">{error}</Callout>}
      <div className="split">
        <div className="card">
          <div className="card-title"><h3>Payment policy</h3>{policy?.active && <span className="badge ok">Active</span>}</div>
          <div className="stack-sm">
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
            <label>Managed key address<input className="mono" value={keyAddress} onChange={(e) => setKeyAddress(e.target.value)} /></label>
            <div className="g2"><label>Single payment limit (USDC)<input inputMode="decimal" value={singleLimit} onChange={(e) => setSingleLimit(e.target.value)} /></label><label>Daily limit (USDC)<input inputMode="decimal" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} /></label></div>
            <label>Approver addresses, one per line<textarea rows={3} value={approvers} onChange={(e) => setApprovers(e.target.value)} /></label>
            <label>Approvals required<input type="number" min="1" value={requiredApprovers} onChange={(e) => setRequiredApprovers(e.target.value)} /></label>
            <button className="btn primary" disabled={busy} onClick={save}>{busy ? <span className="spinner" /> : <Icon name="save" />} Save policy</button>
          </div>
        </div>
        <div className="card">
          <h3>New payment proposal</h3>
          <p className="tiny muted" style={{ marginBottom: 12 }}>Create an employee or agent payment request for approvers to review.</p>
          <div className="stack-sm">
            <input className="mono" placeholder="Recipient 0x…" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            <input inputMode="decimal" placeholder="Amount in USDC" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input placeholder="Reason or invoice reference" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
            <button className="btn" disabled={busy || !recipient || !amount} onClick={create}><Icon name="plus" /> Create proposal</button>
          </div>
        </div>
      </div>
      <div className="section">
        <div className="section-head"><h2>Proposals</h2><p>Only configured approvers can approve or reject a request.</p></div>
        {!proposals.length ? <Empty icon="wallet" title="No proposals" text="Create the first payment request above." /> : <div className="stack-sm">{proposals.map((p) => <div className="card tight" key={p.id}><div className="between"><div><b>{p.amount} USDC</b><span className="muted small"> · {p.reason || 'No reason'}</span><div className="tiny muted mono">To {p.recipient}</div></div><span className={`badge ${p.status === 'approved' ? 'ok' : p.status === 'rejected' ? 'bad' : 'warn'}`}>{p.status} · {p.approvals.length}/{p.requiredApprovers}</span></div>{p.status === 'pending' && <div className="row" style={{ marginTop: 12 }}><button className="btn small primary" disabled={busy} onClick={() => decide(p.id, 'approved')}>Approve</button><button className="btn small" disabled={busy} onClick={() => decide(p.id, 'rejected')}>Reject</button></div>}</div>)}</div>}
      </div>
    </>
  )
}
