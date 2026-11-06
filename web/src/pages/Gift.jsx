import { useEffect, useState } from 'react'
import { formatEther, parseEther } from 'viem'
import { allowanceOf, api, call, config, inr, usd } from '../chain.js'
import { usePerson, usePlan } from '../data.js'
import { byAddress, nameOf } from '../family.js'
import { useApp } from '../main.jsx'
import { Callout, Face, Icon } from '../ui.jsx'

const AMOUNTS = ['0.00005', '0.0001', '0.0002']

export default function Gift({ id }) {
  const { me, send } = useApp()
  const { plan } = usePlan(id, 30_000)
  const { data, refresh } = usePerson(me.address, 20_000)
  const [eth, setEth] = useState('0.0001')
  const [quote, setQuote] = useState(null)
  const [qErr, setQErr] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let live = true
    setQuote(null)
    setQErr(null)
    setLoading(true)
    const t = setTimeout(() => {
      api(`/gift-quote?eth=${eth}&swapper=${me.address}`, undefined, me.address)
        .then((q) => live && setQuote(q))
        .catch((e) => live && setQErr(e.message))
        .finally(() => live && setLoading(false))
    }, 350)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [eth, me.address])

  if (!plan) return <p><span className="spinner" /> Reading the plan privately…</p>
  const child = byAddress(plan.child)
  const short = data && data.eth < parseEther(eth)

  const give = async () => {
    // One signature: Uniswap swaps the ETH, then the guaranteed minimum goes in.
    const min = BigInt(quote.minOut)
    const have = await allowanceOf(me.address)
    send({
      title: `Gift to ${plan.name}`,
      signer: me.signer,
      calls: [
        { to: quote.swap.to, data: quote.swap.data, value: BigInt(quote.swap.value) },
        call.usdc('approve', [config.savings, have + min]),
        call.savings('deposit', [BigInt(plan.id), min]),
      ],
      after: () => {
        refresh()
        setTimeout(() => (location.hash = `/plan/${plan.id}`), 1500)
      },
    })
  }

  return (
    <div className="wizard">
      <a href={`#/plan/${plan.id}`} className="small">
        <Icon name="back" /> {plan.name}
      </a>
      <div className="hello" style={{ margin: '14px 0 24px' }}>
        <Face person={child} size="xl" />
        <div>
          <div className="eyebrow">A gift for {nameOf(plan.child)}</div>
          <h1>{plan.name}</h1>
          <p className="muted small">Saved by {nameOf(plan.parent)} · locked until maturity</p>
        </div>
      </div>

      {plan.closed ? (
        <Callout tone="info">This plan has already matured and paid out.</Callout>
      ) : (
        <>
          <div className="card stack">
            <div>
              <div className="field-label">You give, in ETH</div>
              <div className="choices g2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {AMOUNTS.map((a) => (
                  <button key={a} className="choice" aria-pressed={a === eth} onClick={() => setEth(a)} style={{ justifyContent: 'center', textAlign: 'center' }}>
                    <span>
                      <span className="big">{a}</span>
                      <small>ETH</small>
                    </span>
                  </button>
                ))}
              </div>
              <span className="field-hint">You hold {data ? Number(formatEther(data.eth)).toFixed(5) : '…'} test ETH. The fee is paid by Zoza.</span>
            </div>
            <div className="summary">
              <div className="row-s">
                <span>{nameOf(plan.child)}'s plan receives at least</span>
                <span>{quote ? `${usd(quote.minOut)} USDC · ${inr(quote.minOut)}` : loading ? <span className="spinner" /> : '—'}</span>
              </div>
              <div className="row-s">
                <span>Expected</span>
                <span>{quote ? `${usd(quote.amountOut)} USDC` : '—'}</span>
              </div>
              <div className="row-s">
                <span>Route</span>
                <span className="small">{quote ? `Uniswap API · ${quote.route.map((leg) => leg.map((p) => `${p.type.replace('-pool', '')} ${Number(p.fee) / 10000}%`).join(' → ')).join(' + ')}` : '—'}</span>
              </div>
            </div>
            {qErr && <Callout tone="warn">Uniswap could not quote right now: {qErr}. Try again in a moment.</Callout>}
            {short && <Callout tone="warn">You need {eth} test ETH for this gift. On your family page, “Get test money” sends Dada a little.</Callout>}
            <ul className="promise-list">
              <li className="y"><Icon name="check" />One signature does three things: swap through Uniswap, approve, and add to the plan.</li>
              <li className="y"><Icon name="check" />If the swap gives less than the minimum, nothing happens at all.</li>
              <li className="y"><Icon name="check" />The gift is locked for {nameOf(plan.child)} like the rest of the plan.</li>
            </ul>
          </div>
          <div className="between" style={{ marginTop: 18 }}>
            <a className="btn" href={`#/plan/${plan.id}`}>Cancel</a>
            <button className="btn primary large" disabled={!quote || short} onClick={give}>
              <Icon name="gift" /> Give {eth} ETH
            </button>
          </div>
        </>
      )}
    </div>
  )
}
