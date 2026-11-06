import { useEffect, useState } from 'react'
import { connectWallet, loadMembers, makeWallet, PEOPLE, startDemo } from '../family.js'
import { go, useApp } from '../main.jsx'
import { Callout, Face, Icon } from '../ui.jsx'
import { onWallets, wallets } from '../wallets.js'

/// Signed out: choose your own wallet, a wallet made here, or the demo family.
export default function Welcome({ next = '/family' }) {
  const { setMe } = useApp()
  const [list, setList] = useState(wallets())
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [name, setName] = useState('')
  useEffect(() => onWallets(() => setList(wallets())), [])

  const done = async (id) => {
    await loadMembers()
    setMe(id)
    go(next)
  }
  const connect = async (w) => {
    setBusy(w.id)
    setErr(null)
    try {
      await connectWallet(w)
      await done('self')
    } catch (e) {
      setErr(e.shortMessage ?? e.message)
      setBusy(null)
    }
  }

  return (
    <div className="wizard">
      <div className="page-head">
        <div>
          <div className="eyebrow">Sign in</div>
          <h1>Who is using Zoza Family?</h1>
          <p className="lede">Your wallet is your account. Nothing here holds your money: plans and wills live on chain, and only your wallet can sign for you.</p>
        </div>
      </div>

      <div className="card stack">
        <div>
          <h3>Use my own wallet</h3>
          <p className="small muted">Save into plans, give gifts, and receive what a family leaves you. Your wallet pays its own small gas fees on Sepolia.</p>
        </div>
        {list.length > 0 ? (
          <div className="stack-sm">
            {list.map((w) => (
              <button key={w.id} className="btn block" onClick={() => connect(w)} disabled={!!busy}>
                {busy === w.id ? <span className="spinner" /> : w.icon ? <img src={w.icon} alt="" width="18" height="18" /> : <Icon name="wallet" />} Connect {w.name}
              </button>
            ))}
          </div>
        ) : (
          <Callout tone="info">
            No wallet found in this browser. Install <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a> or another wallet, then reload this page. Or make a wallet below.
          </Callout>
        )}
        {err && <Callout tone="bad">{err}</Callout>}
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <div>
          <h3>Make a wallet in this browser</h3>
          <p className="small muted">For trying Zoza Family without a wallet. The key stays in this browser only and holds test money.</p>
        </div>
        <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Your name" />
        <button className="btn block" onClick={() => (makeWallet(name.trim()), done('self'))}>
          <Icon name="plus" /> Make my wallet
        </button>
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <div className="between">
          <div>
            <h3>Try the demo family</h3>
            <p className="small muted">Be Priya, her children Meera and Arjun, uncle Ravi or Dada. Five test wallets, made in this browser, that you can switch between.</p>
          </div>
          <div className="family-row" style={{ margin: 0 }}>
            {PEOPLE.map((p) => (
              <Face key={p.id} person={p} />
            ))}
          </div>
        </div>
        <button className="btn primary block" onClick={() => (startDemo(), done('priya'))}>
          Start as Priya <Icon name="arrow" />
        </button>
      </div>
    </div>
  )
}
