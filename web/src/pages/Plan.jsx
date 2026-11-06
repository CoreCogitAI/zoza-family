import { useState } from 'react'
import { isAddress, parseUnits } from 'viem'
import { allowanceOf, call, config, inr, usd } from '../chain.js'
import { usePlan } from '../data.js'
import { byAddress, family, nameOf } from '../family.js'
import { useApp } from '../main.jsx'
import { Addr, Callout, dateOf, Face, Icon, Modal, rel, Ring, Skel, useNow, Who } from '../ui.jsx'

const KIND = [
  { label: 'Monthly instalment', ico: 'piggy', cls: 'inst' },
  { label: 'Top-up', ico: 'plus', cls: 'top' },
  { label: 'Gift', ico: 'gift', cls: 'gift' },
  { label: 'Instalment missed', ico: 'warn', cls: 'miss' },
]

export default function Plan({ id }) {
  const { me, send } = useApp()
  const { plan, error, refresh } = usePlan(id)
  const now = useNow()
  const [topUp, setTopUp] = useState(null)
  const [childModal, setChildModal] = useState(false)
  const [newChild, setNewChild] = useState('')
  const [changing, setChanging] = useState(false)
  const [ending, setEnding] = useState(false)
  const [newNominee, setNewNominee] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [moreMonths, setMoreMonths] = useState(6)

  if (!plan) return error ? <Callout tone="bad">Could not read plan #{id}: {error}</Callout> : <p><span className="spinner" /> Reading the plan privately…</p>

  const isParent = me.address.toLowerCase() === plan.parent.toLowerCase()
  const isNominee = me.address.toLowerCase() === plan.nominee.toLowerCase()
  const isChild = me.address.toLowerCase() === plan.child.toLowerCase()
  const total = Number(plan.maturity) - Number(plan.createdAt)
  const pct = plan.closed ? 100 : Math.min(100, (100 * (now - Number(plan.createdAt))) / Math.max(total, 1))
  const interest = plan.closed || plan.value < plan.paidIn + 100n ? 0n : plan.value - plan.paidIn
  const mature = now >= Number(plan.maturity)
  const book = [...plan.book].reverse()
  const run = (title, calls) => send({ title, signer: me.signer, calls, after: refresh })
  const giftLink = `${location.origin}/#/gift/${plan.id}`
  const period = BigInt(plan.period)
  // Instalments still to collect between `from` and `until` (one per period, the first at `from`).
  const left = (from, until) => (from < until ? (until - 1n - from) / period + 1n : 0n)
  const opensAt = Number(plan.nomineeSince ?? 0n) ? Number(plan.nomineeSince) + plan.period : 0
  const canEnd = plan.nomineeAgreesToClose && now >= opensAt
  const planId = BigInt(plan.id)
  const changeNominee = () => {
    setChanging(false)
    run('Change the nominee', [call.savings('setNominee', [planId, newNominee])])
  }
  const changeAmount = async () => {
    const amt = parseUnits(newAmount || '0', 6)
    const calls = []
    if (amt > plan.instalment) calls.push(call.usdc('approve', [config.savings, (await allowanceOf(me.address)) + left(plan.nextDue, plan.maturity) * (amt - plan.instalment)]))
    calls.push(call.savings('setInstalment', [planId, amt]))
    setChanging(false)
    run('Change the monthly amount', calls)
  }
  const extend = async () => {
    const until = plan.maturity + BigInt(moreMonths) * period
    const extra = left(plan.nextDue, until) - left(plan.nextDue, plan.maturity)
    setChanging(false)
    run('Extend the plan', [call.usdc('approve', [config.savings, (await allowanceOf(me.address)) + extra * plan.instalment]), call.savings('extendMaturity', [planId, until])])
  }

  return (
    <>
      <a href="#/family" className="small">
        <Icon name="back" /> My family
      </a>
      <div className="page-head" style={{ marginTop: 10 }}>
        <div className="hello">
          <Face person={byAddress(plan.child)} size="xl" />
          <div>
            <div className="eyebrow">Savings plan #{plan.id}</div>
            <h1>{plan.name}</h1>
            <div className="row small muted" style={{ marginTop: 6 }}>
              For <Who address={plan.child} /> · saved by <Who address={plan.parent} /> · nominee <Who address={plan.nominee} />
            </div>
          </div>
        </div>
        <div className="row">
          {!plan.closed && (
            <a className="btn" href={`#/gift/${plan.id}`}>
              <Icon name="gift" /> Send a gift
            </a>
          )}
        </div>
      </div>

      {plan.closed && (
        <div style={{ marginBottom: 20 }}>
          {plan.paidIn === 0n ? (
            <Callout tone="warn">
              <b>This plan closed with nothing in it.</b> All {plan.missedCount} instalments were missed because the wallet held less than {usd(plan.instalment)} USDC each time.
            </Callout>
          ) : (
            <Callout tone="ok">
              <b>This plan has paid out.</b> {usd(plan.paidIn)} USDC was saved, and everything it held, interest included, was paid out when it closed.
            </Callout>
          )}
        </div>
      )}
      {!plan.closed && !mature && isParent && plan.book.length > 0 && plan.book[plan.book.length - 1].kind === 3 && (
        <div style={{ marginBottom: 20 }}>
          <Callout tone="warn">
            <b>The last instalment was missed.</b> Your wallet held less than {usd(plan.instalment)} USDC. Add money on your family page, or lower the monthly amount below. Missed months carry no penalty.
          </Callout>
        </div>
      )}
      {!plan.closed && mature && (
        <div style={{ marginBottom: 20 }}>
          <Callout tone="ok">
            <b>{plan.name} has matured.</b> The watcher pays it to {nameOf(plan.child)} within a minute, or anyone can do it now.
            <div style={{ marginTop: 10 }}>
              <button className="btn primary small" onClick={() => run('Pay out to the child', [call.savings('release', [BigInt(plan.id)])])}>
                Pay {nameOf(plan.child)} now
              </button>
            </div>
          </Callout>
        </div>
      )}

      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="between" style={{ alignItems: 'center' }}>
              <div>
                <div className="stat-label">Worth now</div>
                <div className="stat-value" style={{ fontSize: 40 }}>
                  {usd(plan.closed ? 0n : plan.value)}
                  <span className="unit">USDC</span>
                </div>
                <div className="muted small">
                  {inr(plan.closed ? 0n : plan.value)} · paid in {usd(plan.paidIn)}
                  {interest > 0n && <span className="ok"> · interest +{usd(interest, 4)}</span>}
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  {plan.earn ? <span className="badge accent"><Icon name="trend" /> Earning with Compound</span> : <span className="badge neutral"><Icon name="shield" /> Safe, no interest</span>}
                  <span className="badge neutral">{plan.paidCount} paid · {plan.missedCount} missed</span>
                </div>
              </div>
              <Ring pct={pct}>
                <b>{Math.round(pct)}%</b>to maturity
              </Ring>
            </div>
            <hr className="divider" />
            <dl className="kv">
              <dt>Every month</dt>
              <dd>{usd(plan.instalment)} USDC · {inr(plan.instalment)}</dd>
              <dt>Next instalment</dt>
              <dd>{plan.closed || mature ? '—' : !plan.mandateOn ? 'Paused by the parent' : Number(plan.nextDue) <= now ? 'Due now; the watcher collects it shortly' : `${rel(plan.nextDue, now)} · ${dateOf(plan.nextDue)}`}</dd>
              <dt>Matures</dt>
              <dd>{rel(plan.maturity, now)} · {dateOf(plan.maturity)}</dd>
              <dt>Pays out to</dt>
              <dd><Who address={plan.child} /> <Addr address={plan.child} /></dd>
            </dl>
          </div>

          <div className="card">
            <div className="card-title">
              <h3>Passbook</h3>
              <span className="tiny muted">Read from the chain, every line</span>
            </div>
            {book.length === 0 && <p className="muted small">No entries yet. The first instalment is due as soon as the plan starts; the watcher collects it within a few seconds.</p>}
            <div className="pb-lines" style={{ padding: 0 }}>
              {book.map((e, i) => {
                const k = KIND[e.kind]
                return (
                  <div className="pb-line" key={i}>
                    <div className="what">
                      <span className={`pb-ico ${k.cls}`}>
                        <Icon name={k.ico} />
                      </span>
                      <span>
                        {e.kind === 2 ? `Gift from ${nameOf(e.from)}` : k.label}
                        <small>
                          {dateOf(e.at)}
                          {e.kind === 3 && ' · wallet was short or the mandate ran out · no penalty'}
                        </small>
                      </span>
                    </div>
                    <span className={`amt ${e.kind === 3 ? 'missed' : ''}`}>{e.kind === 3 ? 'Missed' : `+ ${usd(e.amount)}`}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <aside className="stack">
          {isParent && !plan.closed && (
            <div className="card stack-sm">
              <h3>You saved this</h3>
              <button className="btn block" onClick={() => setTopUp('1')} disabled={mature}>
                <Icon name="plus" /> Top up now
              </button>
              <button className="btn block" onClick={() => run(plan.mandateOn ? 'Pause monthly saving' : 'Resume monthly saving', [call.savings('setMandate', [BigInt(plan.id), !plan.mandateOn])])} disabled={mature}>
                <Icon name={plan.mandateOn ? 'pause' : 'play'} /> {plan.mandateOn ? 'Pause monthly saving' : 'Resume monthly saving'}
              </button>
              <button className="btn block" onClick={() => (setNewAmount(''), setNewNominee(''), setChanging(true))} disabled={mature}>
                <Icon name="refresh" /> Change nominee, amount or date
              </button>
              <button className="btn block danger" disabled={!canEnd} onClick={() => setEnding(true)}>
                End the plan early
              </button>
              <p className="tiny muted">
                {!plan.nomineeAgreesToClose
                  ? `Ending early needs ${nameOf(plan.nominee)}, the nominee, to agree first.`
                  : now < opensAt
                    ? `${nameOf(plan.nominee)} agreed. The nominee changed recently, so ending early opens ${rel(opensAt, now)}.`
                    : `${nameOf(plan.nominee)} agreed. You can pay ${nameOf(plan.child)} now or take it back.`}
              </p>
            </div>
          )}
          {isNominee && !plan.closed && (
            <div className="card stack-sm">
              <h3>You are the nominee</h3>
              <p className="small muted">You protect this plan for {nameOf(plan.child)}. You cannot take from it.</p>
              <button className="btn block" onClick={() => setChildModal(true)}>
                <Icon name="wallet" /> Point to {nameOf(plan.child)}'s new wallet
              </button>
              <button className="btn block" disabled={plan.nomineeAgreesToClose} onClick={() => run('Agree to end the plan early', [call.savings('agreeToClose', [BigInt(plan.id)])])}>
                {plan.nomineeAgreesToClose ? 'You agreed to end it early' : 'Agree to end the plan early'}
              </button>
              <p className="tiny muted">If you agree, {nameOf(plan.parent)} can pay {nameOf(plan.child)} now, for fees that cannot wait, or take the money back.</p>
            </div>
          )}
          {isChild && (
            <div className="card">
              <h3>This is for you</h3>
              <p className="small muted" style={{ marginTop: 6 }}>
                {plan.closed ? 'It has been paid to your wallet.' : `It pays to your wallet ${rel(plan.maturity, now)}. Nobody, including the people who saved it, can move it somewhere else before then.`}
              </p>
            </div>
          )}
          <div className="card">
            <h3>Gift link</h3>
            <p className="small muted" style={{ marginTop: 6 }}>Share this with grandparents and family. They can add to the plan in ETH; Uniswap turns it into USDC.</p>
            <div className="mono small" style={{ marginTop: 10, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8, overflowWrap: 'anywhere' }}>
              {giftLink}
            </div>
            <button className="btn small" style={{ marginTop: 10 }} onClick={() => navigator.clipboard?.writeText(giftLink)}>
              <Icon name="link" /> Copy link
            </button>
          </div>
          <div className="card tight">
            <div className="tiny muted">
              Contract <Addr address={config.savings} />
              <br />
              Every rule on this page is enforced by that contract, not by Zoza.
            </div>
          </div>
        </aside>
      </div>

      <Modal open={topUp != null} title="Top up" onClose={() => setTopUp(null)}>
        <div className="amount-input">
          <input inputMode="decimal" value={topUp ?? ''} onChange={(e) => setTopUp(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Top-up in USDC" />
          <span>USDC</span>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn" onClick={() => setTopUp(null)}>Cancel</button>
          <button
            className="btn primary"
            onClick={async () => {
              const amt = parseUnits(topUp || '0', 6)
              setTopUp(null)
              const have = await allowanceOf(me.address)
              run('Top up', [call.usdc('approve', [config.savings, have + amt]), call.savings('deposit', [BigInt(plan.id), amt])])
            }}
          >
            Add to plan
          </button>
        </div>
      </Modal>

      <Modal open={changing} title="Change the plan" onClose={() => setChanging(false)}>
        <div className="stack">
          <div>
            <div className="field-label">Nominee</div>
            <div className="choices" style={{ marginTop: 6 }}>
              {family
                .filter((p) => ![plan.parent, plan.child, plan.nominee].some((a) => a.toLowerCase() === p.address.toLowerCase()))
                .map((p) => (
                  <button key={p.id} className="choice" aria-pressed={newNominee === p.address} onClick={() => setNewNominee(p.address)}>
                    <Face person={p} />
                    <span>
                      <b>{p.name}</b>
                      <small>{p.role}</small>
                    </span>
                  </button>
                ))}
            </div>
            <input style={{ marginTop: 8 }} placeholder="or paste their wallet address, 0x…" value={newNominee} onChange={(e) => setNewNominee(e.target.value.trim())} />
            <p className="tiny muted" style={{ marginTop: 6 }}>{nameOf(plan.nominee)} and {nameOf(plan.child)} are told. Any agreement to end early is dropped, and ending early waits one period.</p>
            <button className="btn small" style={{ marginTop: 6 }} disabled={!isAddress(newNominee)} onClick={changeNominee}>
              Make them the nominee
            </button>
          </div>
          <div>
            <div className="field-label">Monthly amount</div>
            <div className="amount-input">
              <input inputMode="decimal" placeholder={usd(plan.instalment)} value={newAmount} onChange={(e) => setNewAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="New monthly amount in USDC" />
              <span>USDC</span>
            </div>
            <p className="tiny muted" style={{ marginTop: 6 }}>From the next instalment on. Raising it adds to your mandate for the months left.</p>
            <button className="btn small" style={{ marginTop: 6 }} disabled={!(Number(newAmount) > 0)} onClick={changeAmount}>
              Change the amount
            </button>
          </div>
          <div>
            <div className="field-label">Maturity</div>
            <div className="choices g2" style={{ marginTop: 6 }}>
              {[6, 12, 24].map((m) => (
                <button key={m} className="choice" aria-pressed={moreMonths === m} onClick={() => setMoreMonths(m)} style={{ justifyContent: 'center' }}>
                  <b>{m} more months</b>
                </button>
              ))}
            </div>
            <p className="tiny muted" style={{ marginTop: 6 }}>Only later, never earlier: a longer lock only protects {nameOf(plan.child)}. Now it matures {dateOf(plan.maturity)}.</p>
            <button className="btn small" style={{ marginTop: 6 }} onClick={extend}>
              Extend the plan
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={ending} title="End the plan early" onClose={() => setEnding(false)}>
        <p className="small">{nameOf(plan.nominee)} agreed. Where should the {usd(plan.value)} USDC go?</p>
        <div className="stack-sm" style={{ marginTop: 12 }}>
          <button className="btn primary block" onClick={() => (setEnding(false), run(`Pay ${nameOf(plan.child)} now`, [call.savings('payChildEarly', [planId])]))}>
            <Icon name="heart" /> Pay {nameOf(plan.child)} now
          </button>
          <button className="btn danger block" onClick={() => (setEnding(false), run('Take it back', [call.savings('closeEarly', [planId])]))}>
            Take it back to my wallet
          </button>
        </div>
        <p className="tiny muted" style={{ marginTop: 10 }}>Either way the plan closes. No penalty.</p>
      </Modal>

      <Modal open={childModal} title={`${nameOf(plan.child)}'s new wallet`} onClose={() => setChildModal(false)}>
        <p className="small muted">Pick the family member's wallet, or paste an address. From now on the plan pays there.</p>
        <div className="choices" style={{ marginTop: 12 }}>
          {family
            .filter((p) => p.address !== plan.parent && p.address !== plan.nominee)
            .map((p) => (
              <button key={p.id} className="choice" aria-pressed={newChild === p.address} onClick={() => setNewChild(p.address)}>
                <Face person={p} />
                <span>
                  <b>{p.name}</b>
                  <small>{p.address}</small>
                </span>
              </button>
            ))}
        </div>
        <input style={{ marginTop: 12 }} placeholder="0x… new wallet address" value={newChild} onChange={(e) => setNewChild(e.target.value.trim())} />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn" onClick={() => setChildModal(false)}>Cancel</button>
          <button
            className="btn primary"
            disabled={!isAddress(newChild)}
            onClick={() => {
              setChildModal(false)
              run('Update the child\'s wallet', [call.savings('setChild', [BigInt(plan.id), newChild])])
            }}
          >
            Update wallet
          </button>
        </div>
      </Modal>
    </>
  )
}

export { Skel }
