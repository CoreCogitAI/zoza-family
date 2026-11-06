import { useState } from 'react'
import { parseUnits } from 'viem'
import { allowanceOf, call, config, inr, INR_PER_USD, savings, usd } from '../chain.js'
import { usePerson } from '../data.js'
import { demoTime, family, setDemoTime } from '../family.js'
import { go, useApp } from '../main.jsx'
import { Callout, Face, Icon, Tip } from '../ui.jsx'

const GOALS = [
  { id: 'studies', icon: 'cap', label: 'Studies', name: (c) => `${c}'s studies` },
  { id: 'wedding', icon: 'rings', label: 'Wedding', name: (c) => `${c}'s wedding` },
  { id: 'home', icon: 'door', label: 'First home', name: (c) => `${c}'s first home` },
  { id: 'future', icon: 'heart', label: 'Their future', name: (c) => `${c}'s future` },
]

export default function PlanNew() {
  const { me, send } = useApp()
  const { data } = usePerson(me.address, 30_000)
  const [step, setStep] = useState(0)
  const [childId, setChildId] = useState(family.find((p) => p.id === 'meera' && p.id !== me.id)?.id ?? family.find((p) => p.id !== me.id).id)
  const [goal, setGoal] = useState('studies')
  const [amount, setAmount] = useState('1')
  const [months, setMonths] = useState(6)
  const [earn, setEarn] = useState(true)
  const [nomineeId, setNomineeId] = useState('ravi')
  const [demo, setDemo] = useState(demoTime())

  const child = family.find((p) => p.id === childId)
  const nominee = family.find((p) => p.id === nomineeId && p.id !== me.id && p.id !== childId) ?? family.find((p) => p.id !== me.id && p.id !== childId)
  const g = GOALS.find((x) => x.id === goal)
  const name = g.name(child.name)
  let instalment = 0n
  try {
    instalment = parseUnits(amount || '0', 6)
  } catch {}
  const month = demo ? 60 : 30 * 86400
  const total = instalment * BigInt(months)
  const okAmount = instalment > 0n && instalment <= parseUnits('1000', 6)
  const lacks = data && data.balance < instalment

  const submit = async () => {
    const now = Math.floor(Date.now() / 1000)
    // The first instalment is due at once and the last one month before
    // maturity, so `months` instalments in all.
    const maturity = BigInt(now + (months - 1) * month + Math.min(month, 3600) / 2)
    // The mandate: an allowance for exactly those instalments, on top of other plans'.
    const have = await allowanceOf(me.address)
    const calls = [
      call.usdc('approve', [config.savings, have + instalment * BigInt(months)]),
      call.savings('createPlan', [name, child.address, nominee.address, instalment, month, maturity, earn]),
    ]
    const r = await send({ title: `Start ${name}`, signer: me.signer, calls })
    if (r) {
      const [asParent] = await savings('plansOf', [me.address])
      setTimeout(() => go(`/plan/${asParent[asParent.length - 1]}`), 1200)
    }
  }

  const steps = ['For whom', 'How much', 'Interest', 'Nominee', 'Review']
  return (
    <div className="wizard">
      <a href="#/family" className="small">
        <Icon name="back" /> Back
      </a>
      <h1 style={{ margin: '10px 0 6px' }}>New savings plan</h1>
      <p className="muted" style={{ marginBottom: 22 }}>
        Step {step + 1} of {steps.length} · {steps[step]}
      </p>
      <div className="wiz-steps" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s} className={i <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 0 && (
        <div className="card stack">
          <div>
            <div className="field-label">Who is this plan for?</div>
            <div className="choices g2">
              {family
                .filter((p) => p.id !== me.id)
                .map((p) => (
                  <button key={p.id} className="choice" aria-pressed={p.id === childId} onClick={() => setChildId(p.id)}>
                    <Face person={p} />
                    <span>
                      <b>{p.name}</b>
                      <small>{p.role}</small>
                    </span>
                  </button>
                ))}
            </div>
            <span className="field-hint">At maturity the plan pays {child.name}'s wallet. If {child.name} gets a new wallet later, you or the nominee can point the plan to it.</span>
          </div>
          <div>
            <div className="field-label">What is it for?</div>
            <div className="choices g2">
              {GOALS.map((x) => (
                <button key={x.id} className="choice" aria-pressed={x.id === goal} onClick={() => setGoal(x.id)}>
                  <span className="pb-ico inst">
                    <Icon name={x.icon} />
                  </span>
                  <span>
                    <b>{x.label}</b>
                    <small>{x.name(child.name)}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card stack">
          <label className="field">
            <span className="field-label">Every month</span>
            <div className="amount-input">
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Monthly amount in USDC" />
              <span>USDC</span>
            </div>
            <span className="field-hint">
              About {inr(instalment)} a month at ₹{INR_PER_USD} per dollar, for illustration. Plans hold US dollars (USDC), so the rupee value moves with the exchange rate.
            </span>
          </label>
          <div>
            <div className="field-label">
              For how long
              <label className="check tiny" style={{ fontWeight: 500 }}>
                <input type="checkbox" checked={demo} onChange={(e) => (setDemo(e.target.checked), setDemoTime(e.target.checked))} /> Demo timing: a month passes in a minute
              </label>
            </div>
            <div className="choices g2" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {(demo ? [3, 6, 12, 18] : [12, 60, 144, 216]).map((m) => (
                <button key={m} className="choice" aria-pressed={m === months} onClick={() => setMonths(m)} style={{ justifyContent: 'center', textAlign: 'center' }}>
                  <span>
                    <span className="big">{demo ? m : m / 12}</span>
                    <small>{demo ? 'months' : 'years'}</small>
                  </span>
                </button>
              ))}
            </div>
            <span className="field-hint">
              {demo
                ? `${months} instalments, one a minute. It matures right after the last one, so in about ${months - 1} minutes you can watch it pay out to ${child.name}.`
                : `${months} instalments. Choose 18 years for a newborn's 18th birthday.`}
            </span>
          </div>
          <div className="summary">
            <div className="row-s">
              <span>Instalments</span>
              <span>{months} × {usd(instalment)} USDC</span>
            </div>
            <div className="row-s">
              <span>You put in, in total</span>
              <span>
                {usd(total)} USDC · {inr(total)}
              </span>
            </div>
          </div>
          {lacks && <Callout tone="warn">Your wallet has {usd(data.balance)} USDC, less than one instalment. Get test money on your family page first, or the first month will be marked missed.</Callout>}
        </div>
      )}

      {step === 2 && (
        <div className="card stack">
          <div className="field-label">Should the savings earn interest?</div>
          <div className="choices">
            <button className="choice" aria-pressed={earn} onClick={() => setEarn(true)}>
              <span className="pb-ico top">
                <Icon name="trend" />
              </span>
              <span>
                <b>Earn interest with Compound</b>
                <small>
                  The plan lends its dollars on Compound III and gets them back with interest at maturity. Rate on this test network now: {data?.apr != null ? `${data.apr.toFixed(2)}% a year` : '…'}. That is not a real rate: real rates are usually far lower and change every block. If Compound were hacked, savings could be lost.
                </small>
              </span>
            </button>
            <button className="choice" aria-pressed={!earn} onClick={() => setEarn(false)}>
              <span className="pb-ico">
                <Icon name="shield" />
              </span>
              <span>
                <b>Keep it safe, no interest</b>
                <small>The dollars sit in the plan contract untouched until maturity. No lending, no extra risk.</small>
              </span>
            </button>
          </div>
          <Callout tone="info">
            Unlike a bank deposit, there is no deposit insurance and no fixed rate. Zoza never promises a return.
          </Callout>
        </div>
      )}

      {step === 3 && (
        <div className="card stack">
          <div className="field-label">
            Who is the nominee?
            <Tip>In a bank, a nominee receives the money if the holder dies. Here the plan already belongs to {child.name}, so the nominee's job is to protect it.</Tip>
          </div>
          <div className="choices g2">
            {family
              .filter((p) => p.id !== me.id && p.id !== childId)
              .map((p) => (
                <button key={p.id} className="choice" aria-pressed={p.id === nominee.id} onClick={() => setNomineeId(p.id)}>
                  <Face person={p} />
                  <span>
                    <b>{p.name}</b>
                    <small>{p.role}</small>
                  </span>
                </button>
              ))}
          </div>
          <ul className="promise-list">
            <li className="y"><Icon name="check" />If {child.name} loses their wallet, {nominee.name} can point the plan to a new one.</li>
            <li className="y"><Icon name="check" />Closing the plan early needs {nominee.name} to agree first.</li>
            <li className="y"><Icon name="check" />{nominee.name} and anyone else can add gifts.</li>
            <li className="n"><Icon name="x" />{nominee.name} can never take the money. It only goes to {child.name}, or back to you if you both close it early.</li>
          </ul>
        </div>
      )}

      {step === 4 && (
        <div className="card stack">
          <div className="row" style={{ gap: 12 }}>
            <Face person={child} size="lg" />
            <div>
              <h2>{name}</h2>
              <div className="muted small">
                For {child.name} · nominee {nominee.name} · {earn ? 'earning interest' : 'no interest'}
              </div>
            </div>
          </div>
          <div className="summary">
            <div className="row-s"><span>Every month</span><span>{usd(instalment)} USDC · {inr(instalment)}</span></div>
            <div className="row-s"><span>Instalments</span><span>{months}, one per {demo ? 'minute (demo)' : 'month'}</span></div>
            <div className="row-s"><span>Matures</span><span>right after instalment {months}, in about {months - 1} {demo ? 'minutes' : 'months'}</span></div>
            <div className="row-s"><span>Paid to</span><span>{child.name} · <span className="mono small">{child.address.slice(0, 6)}…{child.address.slice(-4)}</span></span></div>
          </div>
          <div>
            <div className="field-label">What you are signing</div>
            <ul className="promise-list">
              <li className="y"><Icon name="check" />The plan may collect {usd(instalment)} USDC from your wallet once a month, and never more, never sooner.</li>
              <li className="y"><Icon name="check" />The total it can ever collect is capped at {usd(instalment * BigInt(months))} USDC: {months} instalments.</li>
              <li className="y"><Icon name="check" />You can pause the monthly collection any time.</li>
              <li className="y"><Icon name="check" />Money paid in is locked until maturity, then goes to {child.name}.</li>
              <li className="n"><Icon name="x" />Zoza, the nominee and the watcher cannot move it anywhere else.</li>
            </ul>
          </div>
          {!data?.delegated && (
            <Callout tone="guard">
              This also upgrades your wallet to Uniswap's Calibur smart wallet. Your address stays the same, and Zoza pays the fee.
            </Callout>
          )}
        </div>
      )}

      <div className="between" style={{ marginTop: 18 }}>
        <button className="btn" onClick={() => (step ? setStep(step - 1) : go('/family'))}>
          {step ? 'Back' : 'Cancel'}
        </button>
        {step < 4 ? (
          <button className="btn primary" onClick={() => setStep(step + 1)} disabled={step === 1 && !okAmount}>
            Continue <Icon name="arrow" />
          </button>
        ) : (
          <button className="btn primary large" onClick={submit}>
            <Icon name="key" /> Sign and start the plan
          </button>
        )}
      </div>
    </div>
  )
}
