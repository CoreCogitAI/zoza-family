import { useEffect, useState } from 'react'
import { createWalletClient, custom, getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { acceptMessage } from '../../../shared/invites.mjs'
import { tokenFor } from '../auth.js'
import { family, loadMembers, loadSelf, saveSelf } from '../family.js'
import { go, useApp } from '../main.jsx'
import { Addr, Callout, Icon } from '../ui.jsx'

const TITLE = {
  heir: (f, n) => `${f} wants to name ${n} as an heir`,
  child: (f, n) => `${f} wants to save for ${n}`,
  nominee: (f, n) => `${f} asks ${n} to be the nominee`,
  family: (f, n) => `${f} invites ${n} to the family`,
}
const WHAT = {
  heir: (f) => `You would be named in ${f}'s will. Your key can do nothing while ${f} is active. Only if ${f} goes silent, and nobody cancels, can you receive your share, with no gas to pay.`,
  child: (f) => `${f} wants to save for you. When a plan matures, it pays this wallet.`,
  nominee: (f) => `You will guard ${f}'s savings plans for the children. You can never take the money. You can move a plan to a child's new wallet, and ${f} needs your agreement to close one early.`,
  family: (f) => `You can follow ${f}'s family plans and send gifts to the children.`,
}

export default function Join({ code }) {
  const { setMe } = useApp()
  const [inv, setInv] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const mine = loadSelf()

  useEffect(() => {
    fetch(`/api/invites/${code}`)
      .then((r) => r.json().then((j) => (r.ok ? setInv(j) : setErr(j.error))))
      .catch((e) => setErr(e.message))
  }, [code])

  const finish = async (kind, address, sign, key) => {
    const signature = await sign(acceptMessage(inv))
    const res = await fetch(`/api/invites/${code}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, signature }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error ?? `error ${res.status}`)
    saveSelf({ kind, address, key, name: inv.name, role: inv.role, inviter: { address: inv.from, name: inv.fromName } })
    await tokenFor(family.find((p) => p.id === 'self'), true).catch(() => null)
    await loadMembers()
    setMe('self')
    go(inv.role === 'heir' ? '/will' : '/family')
  }

  const connect = async () => {
    setBusy('wallet')
    setErr(null)
    try {
      const wallet = createWalletClient({ chain: sepolia, transport: custom(window.ethereum) })
      const [address] = await wallet.requestAddresses()
      await wallet.switchChain({ id: sepolia.id }).catch(() => {})
      await finish('injected', getAddress(address), (message) => wallet.signMessage({ account: address, message }))
    } catch (e) {
      setErr(e.shortMessage ?? e.message)
      setBusy(null)
    }
  }

  const make = async () => {
    setBusy('local')
    setErr(null)
    try {
      const key = generatePrivateKey()
      const a = privateKeyToAccount(key)
      await finish('local', a.address, (message) => a.signMessage({ message }), key)
    } catch (e) {
      setErr(e.message)
      setBusy(null)
    }
  }

  if (err && !inv) return <Callout tone="bad">This invite could not be read: {err}</Callout>
  if (!inv) return <p><span className="spinner" /> Reading the invite…</p>

  const accepted = inv.acceptedBy
  const isMine = accepted && mine?.address?.toLowerCase() === accepted.toLowerCase()

  return (
    <div className="wizard">
      <div className="page-head">
        <div>
          <div className="eyebrow">Family invite</div>
          <h1>{TITLE[inv.role](inv.fromName, inv.name)}</h1>
          <p className="lede">{WHAT[inv.role](inv.fromName)}</p>
        </div>
      </div>

      <div className="card stack">
        {accepted ? (
          <>
            <Callout tone={isMine ? 'ok' : 'warn'}>
              {isMine ? 'You accepted this invite on this device.' : 'This invite was already accepted.'} Wallet <Addr address={accepted} />
            </Callout>
            {isMine && (
              <button className="btn primary" onClick={() => (setMe('self'), go(inv.role === 'heir' ? '/will' : '/family'))}>
                Open Zoza Family <Icon name="arrow" />
              </button>
            )}
          </>
        ) : (
          <>
            <p className="small">Choose the wallet {inv.fromName} should name. You will sign a short message saying you accept; it costs nothing and moves no money.</p>
            {window.ethereum ? (
              <button className="btn primary block" onClick={connect} disabled={!!busy}>
                {busy === 'wallet' ? <span className="spinner" /> : <Icon name="key" />} Connect my wallet (MetaMask or any browser wallet)
              </button>
            ) : (
              <p className="tiny muted">No browser wallet found. Install one, or make a wallet here.</p>
            )}
            <button className="btn block" onClick={make} disabled={!!busy}>
              {busy === 'local' ? <span className="spinner" /> : <Icon name="plus" />} Make a new wallet in this browser
            </button>
            <p className="tiny muted">
              A wallet made here keeps its key in this browser only, on the Sepolia test network. In the Zoza app the key lives in your phone's secure hardware.
            </p>
            {err && <Callout tone="bad">{err}</Callout>}
          </>
        )}
        <p className="tiny muted">
          From {inv.fromName}, wallet <Addr address={inv.from} />. Zoza checked that {inv.fromName}'s wallet signed this invite.
        </p>
      </div>
    </div>
  )
}
