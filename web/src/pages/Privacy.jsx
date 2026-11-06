import { useEffect, useState } from 'react'
import { chosenNetwork, NETWORKS, onStats, setNetwork, stats as initial } from '../anon.js'
import { config } from '../chain.js'
import { Addr, Callout, Icon } from '../ui.jsx'

export default function Privacy() {
  const [s, setS] = useState({ ...initial })
  const [net, setNet] = useState(chosenNetwork())
  useEffect(() => onStats(setS), [])
  const t = s.totals ?? { anon: s.anon, direct: s.direct, bootstrap: s.bootstrap }
  const total = t.anon + t.direct
  const share = total ? Math.round((100 * t.anon) / total) : null
  const avg = s.anon ? Math.round(s.totalMs / s.anon) : null
  const n = NETWORKS[s.network ?? net]

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Privacy</div>
          <h1>Your family's wallets stay unlinked from you</h1>
          <p className="lede">
            A normal wallet asks a company's server about your balances, and that server sees your IP address next to every address you look up: yours, your children's, your nominee's. Zoza Family sends every one of those reads through Anon-RPC instead.
          </p>
        </div>
      </div>

      <div className="grid g3">
        <div className="card">
          <div className="stat-label">Family data reads sent privately</div>
          <div className="meter-big">{share == null ? '—' : `${share}%`}</div>
          <div className="small muted" style={{ marginTop: 8 }}>
            {t.anon} through Anon-RPC · {t.direct} direct, during this visit
          </div>
          <div className="tiny muted" style={{ marginTop: 6 }}>Not counted: {t.bootstrap ?? 0} bootstrap reads of the network's specifier contract, which Anon-RPC makes directly at each page load to learn which anon-client code to trust (anon-rpc §4). They carry no family addresses.</div>
        </div>
        <div className="card">
          <div className="stat-label">Network</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{n?.label}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <span className={`badge ${s.state === 'ready' && s.network !== 'direct' ? 'ok' : s.state === 'failed' || s.network === 'direct' ? 'bad' : 'warn'}`}>
              {s.network === 'direct' ? 'Not private' : { ready: 'Connected', starting: 'Connecting', failed: 'Failed', idle: 'Idle' }[s.state]}
            </span>
            {s.readyAt && s.startedAt && s.network !== 'direct' && <span className="tiny muted">ready in {((s.readyAt - s.startedAt) / 1000).toFixed(1)} s</span>}
          </div>
          {s.error && <div className="tiny bad" style={{ marginTop: 6 }}>{s.error}</div>}
        </div>
        <div className="card">
          <div className="stat-label">Average private read</div>
          <div className="stat-value">
            {avg != null ? (avg / 1000).toFixed(1) : '—'}
            <span className="unit">seconds</span>
          </div>
          <div className="tiny muted" style={{ marginTop: 6 }}>Mixing adds delay. Zoza Family batches many reads into one request (multicall) and shows saved values while it refreshes.</div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>How a read travels</h2>
        </div>
        <div className="card">
          <div className="flow">
            <span className="node">This page</span>
            <span className="arrow">→</span>
            <span className="node hide">Sandboxed anon-client</span>
            <span className="arrow">→</span>
            <span className="node hide">{n?.label ?? 'Mixnet'}</span>
            <span className="arrow">→</span>
            <span className="node">Public Sepolia RPC</span>
          </div>
          <ul className="promise-list" style={{ marginTop: 16 }}>
            <li className="y"><Icon name="check" />The anon-client's code is pinned by hash in an on-chain specifier contract and checked before it runs.</li>
            <li className="y"><Icon name="check" />It runs in a Web Worker inside a sandboxed, null-origin iframe: no access to this page, your keys, cookies or storage.</li>
            <li className="y"><Icon name="check" />{n?.about}</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Choose the network</h2>
          <p>Nox is the default because it is published on Sepolia, like this demo. Tor and Nym are pinned on Ethereum mainnet and can reach the same RPC.</p>
        </div>
        <div className="net-choice">
          {Object.entries(NETWORKS).map(([id, x]) => (
            <button key={id} className="choice" aria-pressed={id === net} onClick={() => (setNet(id), setNetwork(id))}>
              <span className={`pb-ico ${id === 'direct' ? 'miss' : 'top'}`}>
                <Icon name={id === 'direct' ? 'eye' : 'eyeoff'} />
              </span>
              <span>
                <b>{x.label}</b>
                <small>{x.about}</small>
                {x.address && (
                  <small>
                    Specifier on {x.specifierChain}: <span className="mono">{x.address}</span>
                  </small>
                )}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>What is hidden, and what is not</h2>
        </div>
        <div className="grid g2">
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Hidden</h3>
            <ul className="promise-list">
              <li className="y"><Icon name="check" />From the RPC provider: which device and IP address asked about which family wallets.</li>
              <li className="y"><Icon name="check" />From the mixnet's exit node (Nox): the content of the request, since TLS to the RPC runs inside the worker.</li>
              <li className="y"><Icon name="check" />From analytics companies: this site loads no trackers, fonts or scripts from anyone else.</li>
            </ul>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Not hidden</h3>
            <ul className="promise-list">
              <li className="n"><Icon name="x" />What is on chain. Plans, wills and payments are public by nature of a blockchain.</li>
              <li className="n"><Icon name="x" />From the Zoza Family server: the batches you ask it to relay (it pays the gas), your inbox, and gift quotes. It sees your IP for those.</li>
              <li className="n"><Icon name="x" />From the anon-client itself: it sees every request it carries and could refuse or alter one. You trust whoever controls the specifier contract.</li>
            </ul>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <Callout tone="info">
            Writes never go from this browser to an RPC. You sign here, and the relayer <Addr address={config.relayer} /> sends the transaction and pays for it.
          </Callout>
        </div>
      </section>
    </>
  )
}
