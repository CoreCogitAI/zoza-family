import { useCallback, useEffect, useRef, useState } from 'react'
import { api, call, inr, sendBatch, usd } from '../chain.js'
import { usePerson } from '../data.js'
import { inviteMessage, ROLES } from '../../../shared/invites.mjs'
import { serverFetch } from '../anon.js'
import { authHeader } from '../auth.js'
import { byAddress, family, loadMembers, nameOf } from '../family.js'
import { useApp } from '../main.jsx'
import { Addr, Callout, Empty, Face, Icon, rel, Skel, Tip, useNow } from '../ui.jsx'

export function PlanCard({ plan, now, viewer }) {
  const child = byAddress(plan.child)
  const total = Number(plan.maturity) - Number(plan.createdAt)
  const pct = plan.closed ? 100 : Math.min(100, (100 * (now - Number(plan.createdAt))) / Math.max(total, 1))
  const interest = plan.closed || plan.value < plan.paidIn + 100n ? 0n : plan.value - plan.paidIn
  const role = viewer.toLowerCase() === plan.parent.toLowerCase() ? 'You pay in' : viewer.toLowerCase() === plan.child.toLowerCase() ? 'For you' : viewer.toLowerCase() === plan.nominee.toLowerCase() ? 'You are nominee' : null
  return (
    <a className="plan-card" href={`#/plan/${plan.id}`}>
      <div className="between">
        <div className="who-line">
          <Face person={child} />
          <div>
            <h3>{plan.name}</h3>
            <small>For {nameOf(plan.child)} · nominee {nameOf(plan.nominee)}</small>
          </div>
        </div>
        {plan.closed ? <span className="badge ok">Matured</span> : plan.earn ? <span className="badge accent">Earning</span> : <span className="badge neutral">Safe</span>}
      </div>
      <div className="value">
        {usd(plan.closed ? 0n : plan.value)} <small>USDC · {inr(plan.closed ? 0n : plan.value)}</small>
      </div>
      <div className="tiny muted">
        {plan.closed ? 'Paid out to the child' : `Paid in ${usd(plan.paidIn)}${interest > 0n ? ` · interest +${usd(interest, 4)}` : ''}`}
      </div>
      <div className="progress" style={{ marginTop: 14 }} aria-label={`${Math.round(pct)}% of the way to maturity`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="meta">
        <span>{plan.closed ? 'Closed' : `Matures ${rel(plan.maturity, now)}`}</span>
        <span>
          {plan.closed ? '' : plan.mandateOn ? `Next ${usd(plan.instalment)} ${Number(plan.nextDue) <= now ? 'due now' : rel(plan.nextDue, now)}` : 'Mandate paused'}
        </span>
      </div>
      {role && <div className="tiny" style={{ marginTop: 10, color: 'var(--accent)', fontWeight: 600 }}>{role}</div>}
    </a>
  )
}

function WillCard({ me, w, now, onCheckIn }) {
  if (!w)
    return (
      <div className="card">
        <div className="card-title">
          <h3>Your will</h3>
          <span className="badge neutral">Not written</span>
        </div>
        <p className="muted small">Decide who receives your wallet's money if something happens to you. Nothing moves while you are around.</p>
        <a className="btn primary small" href="#/will/edit" style={{ marginTop: 14 }}>
          Write my will
        </a>
      </div>
    )
  const claim = w.state === 'Claim' || w.state === 'Silent'
  return (
    <div className="card" style={claim ? { borderColor: 'var(--warn)' } : undefined}>
      <div className="card-title">
        <h3>Your will</h3>
        <span className={`badge ${w.state === 'Alive' ? 'ok' : w.state === 'Released' ? 'bad' : 'warn'}`}>{{ Alive: 'Active', Silent: 'You seem away', Claim: 'Claim open', Released: 'Released to heirs' }[w.state]}</span>
      </div>
      <div className="alive">
        <div className="row" style={{ gap: 12 }}>
          {w.state === 'Alive' && <span className="pulse" />}
          <div>
            <div className="small">
              Last check-in <b>{rel(w.lastSeen, now)}</b>
            </div>
            <div className="tiny muted">
              {w.state === 'Alive' && `A claim can only open ${rel(w.at, now)} if you stay silent.`}
              {w.state === 'Silent' && 'You have been silent long enough that a claim can open.'}
              {w.state === 'Claim' && `Your family has been told. Shares unlock ${rel(w.at, now)} unless you check in.`}
              {w.state === 'Released' && 'Your heirs can now take their shares.'}
            </div>
          </div>
        </div>
        {w.state !== 'Released' && (
          <button className={`btn ${claim ? 'primary' : ''} small`} onClick={onCheckIn}>
            <Icon name="heart" /> I'm here
          </button>
        )}
      </div>
      <hr className="divider" />
      <div className="share-bar" aria-label="Shares">
        {w.heirs.map((h, i) => (
          <span key={h} style={{ width: `${w.shares[i] / 100}%`, background: `var(--${byAddress(h)?.tone ?? 'teal'})` }} />
        ))}
      </div>
      <div className="row small" style={{ marginTop: 10, gap: 16 }}>
        {w.heirs.map((h, i) => (
          <span key={h} className="row" style={{ gap: 6 }}>
            <Face person={byAddress(h)} size="sm" /> {nameOf(h)} {w.shares[i] / 100}%
          </span>
        ))}
      </div>
      <a href="#/will" className="small" style={{ display: 'inline-block', marginTop: 14 }}>
        Manage will <Icon name="arrow" />
      </a>
    </div>
  )
}

/// Invite someone by name and role. They accept with their own wallet, and
/// then plans and wills can name them.
function InviteCard({ me }) {
  const { rerender } = useApp()
  const [name, setName] = useState('')
  const [role, setRole] = useState('heir')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [sent, setSent] = useState([])
  const [copied, setCopied] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await serverFetch(`/api/invites?from=${me.address}`, { headers: await authHeader([me]) }, me.address)
      const list = res.ok ? await res.json() : []
      setSent(list.sort((a, b) => b.at - a.at))
      if (list.some((i) => i.acceptedBy && !byAddress(i.acceptedBy))) {
        await loadMembers()
        rerender()
      }
    } catch {}
  }, [me.address, rerender])
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  const create = async () => {
    setBusy(true)
    setErr(null)
    try {
      const { code } = await serverFetch('/api/invites/code', {}, me.address).then((r) => r.json())
      const i = { code, from: me.address, fromName: me.name, name: name.trim(), role }
      const signature = await me.signer.signMessage({ message: inviteMessage(i) })
      const res = await serverFetch('/api/invites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...i, signature }) }, me.address)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `error ${res.status}`)
      setName('')
      await load()
    } catch (e) {
      setErr(e.shortMessage ?? e.message)
    } finally {
      setBusy(false)
    }
  }
  const link = (c) => `${location.origin}/#/join/${c}`
  const copy = (c) => navigator.clipboard?.writeText(link(c)).then(() => (setCopied(c), setTimeout(() => setCopied(null), 1500)))

  return (
    <div className="card">
      <h3 style={{ marginBottom: 6 }}>Invite your family</h3>
      <p className="tiny muted" style={{ marginBottom: 10 }}>They open the link and accept with their own wallet (MetaMask works), or make one. Then you can name them in a plan or your will.</p>
      <div className="stack-sm">
        <input placeholder="Their name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name of the person to invite" maxLength={40} />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Their role">
          {Object.entries(ROLES).map(([k, v]) => (
            <option key={k} value={k}>
              As your {v}
            </option>
          ))}
        </select>
        <button className="btn small" onClick={create} disabled={busy || !name.trim()}>
          {busy ? <span className="spinner" /> : <Icon name="link" />} Make an invite link
        </button>
        {err && <div className="tiny bad">{err}</div>}
      </div>
      {sent.length > 0 && (
        <div className="stack-sm" style={{ marginTop: 14 }}>
          {sent.slice(0, 6).map((i) => (
            <div key={i.code} className="between small" style={{ gap: 8 }}>
              <span>
                {i.name} <span className="muted">· {ROLES[i.role]}</span>
              </span>
              {i.acceptedBy ? (
                <span className="badge ok">Joined</span>
              ) : (
                <button className="btn ghost small" onClick={() => copy(i.code)} title={link(i.code)}>
                  <Icon name="copy" /> {copied === i.code ? 'Copied' : 'Copy link'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Family() {
  const { me, send } = useApp()
  const { data, error, refresh } = usePerson(me.address)
  const now = useNow()
  const [faucet, setFaucet] = useState(null)
  const autoChecked = useRef(false)

  const checkIn = () => send({ title: "I'm here", signer: me.signer, calls: [call.will('checkIn')], after: refresh })

  // The app checks in for you when you open it, so silence means silence.
  useEffect(() => {
    const w = data?.will
    if (!w || data.stale || autoChecked.current || w.state !== 'Alive') return
    const silence = Number(w.silence)
    if (now - Number(w.lastSeen) > silence / 3) {
      autoChecked.current = true
      sendBatch({ signer: me.signer, calls: [call.will('checkIn')] }).then(refresh, () => {})
    }
  }, [data, now, me, refresh])

  const getMoney = async () => {
    setFaucet({ busy: true })
    try {
      const r = await api('/faucet', { address: me.address, eth: me.id === 'dada' || !!me.injected }, me.address)
      setFaucet({ ok: `Sent ${r.usdc} test USDC${r.eth !== '0' ? ` and ${r.eth} test ETH` : ''}.` })
      setTimeout(refresh, 2000)
    } catch (e) {
      setFaucet({ err: e.message })
    }
  }

  const plans = data?.plans ?? []
  const mine = plans.filter((p) => p.parent.toLowerCase() === me.address.toLowerCase())
  const forMe = plans.filter((p) => p.child.toLowerCase() === me.address.toLowerCase())
  const guard = plans.filter((p) => p.nominee.toLowerCase() === me.address.toLowerCase())
  const others = family.filter((p) => p.id !== me.id)

  return (
    <>
      <div className="page-head">
        <div className="hello">
          <Face person={me} size="xl" />
          <div>
            <div className="eyebrow">{me.role}</div>
            <h1>Hello, {me.name}</h1>
            <div className="row small muted" style={{ marginTop: 6, gap: 8 }}>
              <Addr address={me.address} />
              {me.injected ? (
                <span className="badge neutral">
                  Connected wallet
                  <Tip>Your own wallet. It can save into plans, give gifts and receive what is left to you. It pays its own small gas fees. Writing a will needs a wallet made by Zoza Family.</Tip>
                </span>
              ) : data?.delegated ? (
                <span className="badge guard">
                  <Icon name="shield" /> Calibur smart wallet
                </span>
              ) : (
                <span className="badge neutral">
                  Plain wallet
                  <Tip>Your first action upgrades this same address to Uniswap's Calibur smart wallet (EIP-7702). Zoza pays the gas.</Tip>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="card tight" style={{ minWidth: 240 }}>
          <div className="stat-label">In your wallet</div>
          <div className="stat-value">
            {data ? usd(data.balance) : <Skel />}
            <span className="unit">USDC</span>
          </div>
          <div className="tiny muted">{data ? `${inr(data.balance)} at an example rate of ₹88/$` : ' '}</div>
          <button className="btn small" style={{ marginTop: 10 }} onClick={getMoney} disabled={faucet?.busy}>
            {faucet?.busy ? <span className="spinner" /> : <Icon name="coins" />} Get test money
          </button>
          {faucet?.ok && <div className="tiny ok" style={{ marginTop: 6 }}>{faucet.ok}</div>}
          {faucet?.err && <div className="tiny bad" style={{ marginTop: 6 }}>{faucet.err}</div>}
        </div>
      </div>

      {error && !data && <Callout tone="warn">Reading the chain privately… {error}</Callout>}

      {data?.will && (data.will.state === 'Claim' || data.will.state === 'Silent') && (
        <div style={{ marginBottom: 20 }}>
          <Callout tone="warn">
            <b>Are you there, {me.name}?</b> You have not checked in, so a claim on your will {data.will.state === 'Claim' ? 'is open and your family has been told' : 'can now be opened'}. Tap “I'm here” to cancel it.
          </Callout>
        </div>
      )}

      <div className="split">
        <div className="stack">
          {(me.id === 'priya' || me.id === 'self' || mine.length > 0) && (
            <section>
              <div className="between" style={{ marginBottom: 12 }}>
                <h2>Plans you save into</h2>
                <a className="btn small" href="#/plan/new">
                  <Icon name="plus" /> New plan
                </a>
              </div>
              <div className="tiles">
                {mine.map((p) => (
                  <PlanCard key={p.id} plan={p} now={now} viewer={me.address} />
                ))}
                {!data && <div className="plan-card"><Skel w={160} /><div style={{ marginTop: 16 }}><Skel w={120} /></div></div>}
                {data && mine.length === 0 && (
                  <a className="add-card" href="#/plan/new">
                    <div>
                      <Icon name="plus" />
                      <div><b>Start a savings plan</b></div>
                      <div className="small muted">For Meera's studies, Arjun's wedding, anything</div>
                    </div>
                  </a>
                )}
              </div>
            </section>
          )}

          {forMe.length > 0 && (
            <section>
              <h2 style={{ marginBottom: 12 }}>Saved for you</h2>
              <div className="tiles">
                {forMe.map((p) => (
                  <PlanCard key={p.id} plan={p} now={now} viewer={me.address} />
                ))}
              </div>
            </section>
          )}

          {guard.length > 0 && (
            <section>
              <h2 style={{ marginBottom: 6 }}>Plans you guard as nominee</h2>
              <p className="muted small" style={{ marginBottom: 12 }}>You cannot take this money. You can point a plan to the child's new wallet, and you must agree before it can close early.</p>
              <div className="tiles">
                {guard.map((p) => (
                  <PlanCard key={p.id} plan={p} now={now} viewer={me.address} />
                ))}
              </div>
            </section>
          )}

          {data && data.namedIn.length > 0 && (
            <section>
              <h2 style={{ marginBottom: 12 }}>Wills that name you</h2>
              <div className="stack-sm">
                {data.namedIn.map((n) => (
                  <a key={n.owner} className="plan-card" href="#/will">
                    <div className="between">
                      <div className="who-line">
                        <Face person={byAddress(n.owner)} />
                        <div>
                          <h3>{nameOf(n.owner)}'s will</h3>
                          <small>Your share: {n.share / 100}%</small>
                        </div>
                      </div>
                      <span className={`badge ${n.state === 'Alive' ? 'ok' : n.state === 'Released' ? 'accent' : 'warn'}`}>
                        {{ Alive: `${nameOf(n.owner)} is active`, Silent: 'Silent', Claim: 'Claim open', Released: 'Ready for you' }[n.state]}
                      </span>
                    </div>
                    <div className="tiny muted" style={{ marginTop: 10 }}>
                      {n.state === 'Alive' && `Nothing can move while ${nameOf(n.owner)} keeps checking in.`}
                      {n.state === 'Claim' && `Unlocks ${rel(n.at, now)} unless ${nameOf(n.owner)} checks in.`}
                      {n.state === 'Released' && `You can receive ${usd(n.claimable)} USDC now.`}
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}

          {data && mine.length === 0 && forMe.length === 0 && guard.length === 0 && data.namedIn.length === 0 && me.id !== 'priya' && (
            <Empty icon="users" title={`Nothing for ${me.name} yet`}>
              {me.persona ? `Switch to Priya and start a plan or write a will that names ${me.name}. ${me.id === 'dada' ? 'Then Dada can send a gift from the plan page.' : ''}` : 'When someone names you in a plan or a will, it shows here. To name others, invite them first.'}
            </Empty>
          )}
        </div>

        <aside className="stack">
          <WillCard me={me} w={data?.will} now={now} onCheckIn={checkIn} />
          <InviteCard me={me} />
          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Your family</h3>
            <div className="stack-sm">
              {others.map((p) => (
                <div key={p.id} className="row" style={{ gap: 10 }}>
                  <Face person={p} size="sm" />
                  <div className="small">
                    {p.name} <span className="muted">· {p.role}</span>
                  </div>
                </div>
              ))}
            </div>
            {others.length === 0 && <p className="small muted">No one yet. Invite them above.</p>}
            {me.persona && <p className="tiny muted" style={{ marginTop: 12 }}>Switch person at the top right to see Zoza Family from their side.</p>}
          </div>
          {data?.apr != null && (
            <div className="card tight">
              <div className="stat-label">Compound rate on the test network</div>
              <div className="stat-value">
                {data.apr.toFixed(2)}
                <span className="unit">% a year</span>
              </div>
              <div className="tiny muted">Not a real rate. Sepolia's test market is unusually high because test borrowing fills it. Real rates move with the market, are usually far lower, and are never promised.</div>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
