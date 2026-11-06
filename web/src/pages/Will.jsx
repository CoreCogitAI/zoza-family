import { useState } from 'react'
import { encodeFunctionData, erc20Abi, maxUint256, zeroAddress } from 'viem'
import { addGuardedKey, keyHashOf } from '../../../shared/calibur.mjs'
import { abi, call, config, inr, usd } from '../chain.js'
import { usePerson } from '../data.js'
import { byAddress, demoTime, family, nameOf, setDemoTime } from '../family.js'
import { go, useApp } from '../main.jsx'
import { NeedFamily } from './PlanNew.jsx'
import { Callout, dateOf, Empty, Face, Icon, rel, Tip, useNow } from '../ui.jsx'

const PERIODS = {
  // Short stand-ins for the real periods, so a claim can open on stage.
  demo: {
    silence: [[90, '90 seconds (stands in for 6 months)'], [180, '3 minutes (stands in for 1 year)']],
    window: [[45, '45 seconds (stands in for 30 days)'], [90, '90 seconds (stands in for 60 days)']],
  },
  real: {
    silence: [[180 * 86400, '6 months'], [365 * 86400, '1 year'], [90 * 86400, '3 months']],
    window: [[30 * 86400, '30 days'], [60 * 86400, '60 days'], [90 * 86400, '90 days']],
  },
}
const DAY = 86400
const human = (s) =>
  s < 120 ? `${s} seconds`
  : s < 7200 ? `${Math.round(s / 60)} minutes`
  : s % (365 * DAY) === 0 ? (s === 365 * DAY ? '1 year' : `${s / (365 * DAY)} years`)
  : s >= 90 * DAY && s % (30 * DAY) === 0 ? `${s / (30 * DAY)} months`
  : `${Math.round(s / DAY)} days`
const revokeKeys = (heirs) => heirs.map((h) => ({ to: zeroAddress, data: encodeFunctionData({ abi: abi.calibur, functionName: 'revoke', args: [keyHashOf(h)] }) }))

/// What a real will needs too. This one only moves what is in this wallet.
function LegalNote() {
  return (
    <Callout tone="info">
      <b>This works alongside a legal will, not instead of it.</b> In India your property passes by a written will, signed by you and two witnesses (registering it is optional), or else by succession law. This on-chain will only decides the money in this wallet. Mention the wallet in your written will, and tell your executor that it exists.
    </Callout>
  )
}

function Timeline({ state }) {
  const order = ['Alive', 'Silent', 'Claim', 'Released']
  const at = order.indexOf(state)
  const labels = [
    ['Active', 'Checking in'],
    ['Silent', 'No check-in for a while'],
    ['Claim open', 'Family told; can cancel'],
    ['Released', 'Heirs take shares'],
  ]
  return (
    <div className="timeline">
      {labels.map(([b, s], i) => (
        <div key={b} className={`tl-step ${i < at ? 'done' : ''} ${i === at ? 'now' : ''} ${i === at && i > 0 ? 'warn' : ''}`}>
          <span className="pin" />
          <b>{b}</b>
          <span className="tiny">{s}</span>
        </div>
      ))}
    </div>
  )
}

function Editor({ me, data, send, refresh }) {
  const [demo, setDemo] = useState(demoTime())
  const P = PERIODS[demo ? 'demo' : 'real']
  const existing = data?.will
  const candidates = family.filter((p) => p.id !== me.id)
  const [picked, setPicked] = useState(() =>
    existing ? Object.fromEntries(existing.heirs.map((h, i) => [byAddress(h)?.id ?? h, existing.shares[i] / 100])) : candidates.some((p) => p.id === 'arjun') ? { arjun: 60, meera: 40 } : {},
  )
  const [silence, setSilence] = useState(existing ? Number(existing.silence) : P.silence[0][0])
  const [windowS, setWindowS] = useState(existing ? Number(existing.window) : P.window[0][0])
  const [eth, setEth] = useState(existing ? existing.tokens.includes(zeroAddress) : false)
  // MetaMask cannot hold Calibur keys, so its will pulls through a USDC allowance.
  const pull = !!me.injected
  const ids = Object.keys(picked)
  const sum = ids.reduce((a, k) => a + Number(picked[k]), 0)

  const toggle = (id) =>
    setPicked((p) => {
      const n = { ...p }
      if (n[id] != null) delete n[id]
      else n[id] = 0
      // Split evenly, then let the person adjust.
      const keys = Object.keys(n)
      keys.forEach((k, i) => (n[k] = Math.floor(100 / keys.length) + (i === 0 ? 100 % keys.length : 0)))
      return n
    })
  const setShare = (id, v) => setPicked((p) => ({ ...p, [id]: Math.max(1, Math.min(100, Math.round(v))) }))

  const submit = async () => {
    const heirs = ids.map((id) => family.find((p) => p.id === id).address)
    const shares = ids.map((id) => Math.round(Number(picked[id]) * 100))
    const tokens = [config.usdc, ...(eth && !pull ? [zeroAddress] : [])]
    const calls = []
    if (pull) {
      // The will may move USDC only after release, and only each heir's share.
      if (!(data?.willAllowance >= maxUint256 / 2n)) calls.push(call.usdc('approve', [config.will, maxUint256]))
      calls.push(call.will('makeWillWithAllowance', [heirs, shares, tokens, silence, windowS]))
    } else {
      // Each heir gets a Calibur key on this wallet that only our hook can unlock.
      for (const h of heirs) calls.push(...addGuardedKey(h, config.will))
      // Heirs taken out of the will lose their key as well.
      calls.push(...revokeKeys((existing?.heirs ?? []).filter((old) => !heirs.some((h) => h.toLowerCase() === old.toLowerCase()))))
      calls.push(call.will('makeWill', [heirs, shares, tokens, silence, windowS]))
    }
    const r = await send({ title: existing ? 'Update my will' : 'Sign my will', signer: me.signer, calls, after: refresh })
    if (r) setTimeout(() => go('/will'), 800)
  }

  if (!candidates.length) return <NeedFamily what="write a will" need="at least one heir" />
  return (
    <div className="wizard">
      <a href="#/will" className="small">
        <Icon name="back" /> Back
      </a>
      <h1 style={{ margin: '10px 0 6px' }}>{existing ? 'Change your will' : 'Write your will'}</h1>
      <p className="muted" style={{ marginBottom: 22 }}>The money stays in your wallet, and you keep using it. This only decides what happens if you go silent.</p>

      <div className="card stack">
        <div>
          <div className="field-label">Who should receive it?</div>
          <div className="choices g2">
            {candidates.map((p) => (
              <button key={p.id} className="choice" aria-pressed={picked[p.id] != null} onClick={() => toggle(p.id)}>
                <Face person={p} />
                <span>
                  <b>{p.name}</b>
                  <small>{p.role}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
        {ids.length > 0 && (
          <div>
            <div className="field-label">
              Shares <span className={sum === 100 ? 'ok' : 'bad'}>{sum}% of 100%</span>
            </div>
            {ids.map((id) => {
              const p = family.find((x) => x.id === id)
              return (
                <div className="heir-row" key={id}>
                  <Face person={p} size="sm" />
                  <input type="range" min="1" max="100" value={picked[id]} onChange={(e) => setShare(id, e.target.value)} aria-label={`${p.name}'s share`} />
                  <span className="pct">{picked[id]}%</span>
                </div>
              )
            })}
            {data && <span className="field-hint">Today that would be about {ids.map((id) => `${family.find((x) => x.id === id).name} ${usd((data.balance * BigInt(Math.round(picked[id] * 100))) / 10000n)} USDC`).join(', ')}.</span>}
          </div>
        )}
        <div className="fields">
          <label className="field">
            <span className="field-label">
              Quiet period
              <Tip>{pull ? 'Tap “I\'m here” now and then, like a yearly life certificate. We remind you before this runs out.' : 'Every time you open Zoza, it checks in for you.'} Only after this long with no check-in can a claim open.</Tip>
            </span>
            <select value={silence} onChange={(e) => setSilence(Number(e.target.value))}>
              {P.silence.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">
              Notice period
              <Tip>When a claim opens, you and your heirs are told, like a public notice before an estate is settled. Tap “I'm here” within this time and nothing happens.</Tip>
            </span>
            <select value={windowS} onChange={(e) => setWindowS(Number(e.target.value))}>
              {P.window.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={demo}
            onChange={(e) => {
              const on = e.target.checked
              setDemo(on)
              setDemoTime(on)
              const Q = PERIODS[on ? 'demo' : 'real']
              setSilence(Q.silence[0][0])
              setWindowS(Q.window[0][0])
            }}
          />{' '}
          Demo timing: watch a claim open in a few minutes. Turn off for a real will, measured in months.
        </label>
        {pull ? (
          <span className="field-hint">Covers the USDC in this wallet. ETH can't be left through a connected wallet's will.</span>
        ) : (
          <label className="check">
            <input type="checkbox" checked={eth} onChange={(e) => setEth(e.target.checked)} /> Include ETH as well as USDC
          </label>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 8 }}>What you are signing</h3>
        <ul className="promise-list">
          {pull ? (
            <li className="y"><Icon name="check" />Your wallet lets the Zoza Family Will contract move your USDC, but the contract only pays an heir after the steps below.</li>
          ) : (
            <li className="y"><Icon name="check" />Each heir gets a key on your wallet that does nothing while you are around.</li>
          )}
          <li className="y"><Icon name="check" />Only after {human(silence)} without a check-in, plus a {human(windowS)} notice period nobody cancels, can each heir take their own share.</li>
          <li className="y"><Icon name="check" />An heir can only send their share to their own wallet. They cannot take more, or anyone else's.</li>
          <li className="y"><Icon name="check" />You can change or cancel this will any time.</li>
          <li className="n"><Icon name="x" />Zoza and the watcher cannot move your money. They can only open the claim window.</li>
        </ul>
        {!data?.delegated && !me.injected && <Callout tone="guard">This also upgrades your wallet to Uniswap's Calibur smart wallet. Same address, and Zoza pays the fee.</Callout>}
        {pull && (
          <Callout tone="info">
            MetaMask will ask you to approve {data?.willAllowance >= maxUint256 / 2n ? '1 transaction' : '2 transactions: the USDC permission, then the will'}. Your wallet pays a small Sepolia gas fee. Cancelling the will also takes the permission back.
          </Callout>
        )}
      </div>
      <div style={{ marginTop: 16 }}>
        <LegalNote />
      </div>

      <div className="between" style={{ marginTop: 18 }}>
        <a className="btn" href="#/will">Cancel</a>
        <button className="btn primary large" disabled={sum !== 100 || ids.length === 0} onClick={submit}>
          <Icon name="key" /> {existing ? 'Sign the new will' : 'Sign my will'}
        </button>
      </div>
    </div>
  )
}

function OwnerView({ me, data, now, send, refresh }) {
  const w = data.will
  const balance = data.balance
  return (
    <div className="stack">
      <div className="card">
        <div className="between" style={{ marginBottom: 18 }}>
          <div>
            <div className="eyebrow">Your will</div>
            <h2>{{ Alive: 'Active. Your family is protected.', Silent: 'You have been silent', Claim: 'A claim is open', Released: 'Released to your heirs' }[w.state]}</h2>
            <p className="muted small" style={{ marginTop: 4 }}>
              Last check-in {rel(w.lastSeen, now)} · {dateOf(w.lastSeen)}
            </p>
          </div>
          {w.state !== 'Released' && (
            <button className={`btn ${w.state === 'Alive' ? '' : 'primary'} large`} onClick={() => send({ title: "I'm here", signer: me.signer, calls: [call.will('checkIn')], after: refresh })}>
              <Icon name="heart" /> I'm here
            </button>
          )}
        </div>
        <Timeline state={w.state} />
        <div style={{ marginTop: 16 }}>
          {w.state === 'Alive' && <Callout tone="ok">If you stay silent, a claim could open {rel(w.at, now)}. Opening Zoza checks in for you.</Callout>}
          {w.state === 'Silent' && <Callout tone="warn">Anyone can now open a claim. Tap “I'm here” to reset the clock.</Callout>}
          {w.state === 'Claim' && <Callout tone="warn">Your heirs have been told. Their shares unlock {rel(w.at, now)} unless you tap “I'm here”.</Callout>}
          {w.state === 'Released' && <Callout tone="info">Each heir can now take their share. To make a new will, write one below.</Callout>}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Who receives what</h3>
        <div className="share-bar">
          {w.heirs.map((h, i) => (
            <span key={h} style={{ width: `${w.shares[i] / 100}%`, background: `var(--${byAddress(h)?.tone ?? 'teal'})` }} />
          ))}
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Heir</th>
                <th className="num">Share</th>
                <th className="num">Today</th>
              </tr>
            </thead>
            <tbody>
              {w.heirs.map((h, i) => (
                <tr key={h}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <Face person={byAddress(h)} size="sm" /> {nameOf(h)}
                    </span>
                  </td>
                  <td className="num">{w.shares[i] / 100}%</td>
                  <td className="num">
                    {usd((balance * BigInt(w.shares[i])) / 10000n)} USDC
                    <div className="tiny muted">{inr((balance * BigInt(w.shares[i])) / 10000n)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="kv" style={{ marginTop: 14 }}>
          <dt>Quiet period</dt>
          <dd>{human(Number(w.silence))}</dd>
          <dt>Notice period</dt>
          <dd>{human(Number(w.window))}</dd>
          <dt>Covers</dt>
          <dd>{w.tokens.map((t) => (t === zeroAddress ? 'ETH' : 'USDC')).join(' and ')}</dd>
          <dt>How heirs receive</dt>
          <dd>{w.pull ? 'Each heir pulls their share through your USDC permission' : 'A guarded key on your Calibur wallet'}</dd>
        </dl>
        {w.pull && data.willAllowance < balance && (
          <div style={{ marginTop: 12 }}>
            <Callout tone="warn">
              Your USDC permission ({usd(data.willAllowance)}) is less than your balance, so heirs share {usd(data.willAllowance)} USDC, not all of it.{' '}
              <button className="btn small" onClick={() => send({ title: 'Cover my whole balance', signer: me.signer, calls: [call.usdc('approve', [config.will, maxUint256])], after: refresh })}>
                Cover my whole balance
              </button>
            </Callout>
          </div>
        )}
        <div className="row" style={{ marginTop: 16 }}>
          <a className="btn" href="#/will/edit">Change will</a>
          <button
            className="btn danger"
            onClick={() =>
              send({
                title: 'Cancel my will',
                signer: me.signer,
                calls: w.pull ? [call.will('revokeWill'), call.usdc('approve', [config.will, 0n])] : [...revokeKeys(w.heirs), call.will('revokeWill')],
                after: refresh,
              })
            }
          >
            Cancel will
          </button>
        </div>
      </div>
    </div>
  )
}

function HeirView({ me, n, now, send, refresh }) {
  const owner = byAddress(n.owner)
  const receive = () =>
    n.will.pull
      ? send({ title: `Receive your share from ${nameOf(n.owner)}`, signer: me.signer, calls: [call.will('take', [n.owner, config.usdc, n.claimable])], after: refresh })
      : send({
          title: `Receive your share from ${nameOf(n.owner)}`,
          signer: me.signer,
          account: n.owner, // signed by my key on their wallet; their hook checks it
          calls: [{ to: config.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [me.address, n.claimable] }) }],
          after: refresh,
        })
  return (
    <div className="card">
      <div className="between" style={{ marginBottom: 14 }}>
        <div className="hello">
          <Face person={owner} size="lg" />
          <div>
            <div className="eyebrow">Will that names you</div>
            <h2>{nameOf(n.owner)}'s will</h2>
            <div className="muted small">Your share: {n.share / 100}%</div>
          </div>
        </div>
        {n.state === 'Released' && n.claimable > 0n && (
          <button className="btn primary large" onClick={receive}>
            Receive {usd(n.claimable)} USDC
          </button>
        )}
      </div>
      <Timeline state={n.state} />
      <div style={{ marginTop: 16 }}>
        {n.state === 'Alive' && <Callout tone="ok">{nameOf(n.owner)} is active. Your key on {nameOf(n.owner)}'s wallet can do nothing, and you will be told if {nameOf(n.owner)} goes silent.</Callout>}
        {n.state === 'Silent' && (
          <Callout tone="warn">
            {nameOf(n.owner)} has not checked in for a while. The watcher opens a claim within seconds and lets {nameOf(n.owner)} know.
            <div style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => send({ title: 'Open the claim', signer: me.signer, calls: [call.will('openClaim', [n.owner])], after: refresh })}>
                Open the claim now
              </button>
            </div>
          </Callout>
        )}
        {n.state === 'Claim' && <Callout tone="warn">A claim is open and {nameOf(n.owner)} has been told. If they do not check in during the notice period, your share unlocks {rel(n.at, now)}.</Callout>}
        {n.state === 'Released' && (
          <Callout tone="info">
            {n.claimable > 0n ? `Your share is ready: ${usd(n.claimable)} USDC (${inr(n.claimable)}). It can only go to your own wallet.${me.injected ? ' Your wallet pays a small gas fee.' : ' Zoza pays the fee.'}` : 'You have received your share.'}
          </Callout>
        )}
      </div>
    </div>
  )
}

export default function Will({ edit }) {
  const { me, send } = useApp()
  const { data, refresh } = usePerson(me.address, 8000)
  const now = useNow()
  if (edit) return <Editor me={me} data={data} send={send} refresh={refresh} />
  if (!data) return <p><span className="spinner" /> Reading your will privately…</p>
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">When I'm gone</div>
          <h1>Will</h1>
          <p className="lede">A will that lives inside the wallet. It never moves money while you are around.</p>
        </div>
        {!data.will && (
          <a className={`btn ${data.namedIn.length ? '' : 'primary'}`} href="#/will/edit">
            <Icon name="scroll" /> Write my own will
          </a>
        )}
      </div>
      <div className="stack">
        {data.will && <OwnerView me={me} data={data} now={now} send={send} refresh={refresh} />}
        {data.namedIn.map((n) => (
          <HeirView key={n.owner} me={me} n={n} now={now} send={send} refresh={refresh} />
        ))}
        {!data.will && data.namedIn.length === 0 && (
          <Empty icon="scroll" title="No will yet" action={<a className="btn primary" href="#/will/edit">Write my will</a>}>
            Choose who in your family receives this wallet's money, and in what shares. Nothing moves while you are around.
          </Empty>
        )}
      </div>
    </>
  )
}
