import { createContext, StrictMode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NETWORKS, onStats, setNetwork, start as startAnon, stats as anonStats } from './anon.js'
import { config as liveConfig, loadConfig, sendBatch } from './chain.js'
import { hasPass } from './auth.js'
import { providerFor } from './wallets.js'
import { choose, current, family, loadMembers, loadSelf, mode, signOut, startDemo, watchWallet } from './family.js'
import { useInbox } from './data.js'
import { Face, Icon, Modal, rel, SendSteps, useNow } from './ui.jsx'
import Home from './pages/Home.jsx'
import Family from './pages/Family.jsx'
import PlanNew from './pages/PlanNew.jsx'
import Plan from './pages/Plan.jsx'
import Will from './pages/Will.jsx'
import Gift from './pages/Gift.jsx'
import Privacy from './pages/Privacy.jsx'
import How from './pages/How.jsx'
import Join from './pages/Join.jsx'
import Welcome from './pages/Welcome.jsx'
import Startup from './pages/Startup.jsx'
import './styles.css'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

function useHash() {
  const [hash, setHash] = useState(() => location.hash.slice(1) || '/')
  useEffect(() => {
    const on = () => {
      setHash(location.hash.slice(1) || '/')
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export const go = (path) => (location.hash = path)

function useAnon() {
  const [s, setS] = useState({ ...anonStats })
  useEffect(() => onStats(setS), [])
  return s
}

/// The privacy network has not connected: say so, and let the person choose.
/// Never switches on its own, since Direct is not private.
function NetBanner() {
  useAnon()
  const now = useNow()
  const s = anonStats
  const slow = s.state === 'starting' && s.chosenAt && now * 1000 - s.chosenAt > 30_000
  if (s.network === 'direct' || !(slow || s.state === 'failed')) return null
  const name = NETWORKS[s.network]?.label ?? s.network
  const pick = (n) => (setNetwork(n), setTimeout(() => location.reload(), 300))
  return (
    <div className="callout warn" role="alert" style={{ margin: '0 auto 20px', maxWidth: 'var(--page)' }}>
      <div>
        <b>{name} has not connected{s.state === 'failed' ? `: ${s.error}` : ' after 30 seconds'}.</b> Until it does, your family, plans and messages cannot load.
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          {s.network !== 'nox' && (
            <button className="btn small primary" onClick={() => pick('nox')}>
              Use the Nox mixnet
            </button>
          )}
          <button className="btn small" onClick={() => pick('direct')}>
            Send directly (not private)
          </button>
          <a className="btn ghost small" href="#/privacy">
            About these networks
          </a>
        </div>
      </div>
    </div>
  )
}

/// Run a batch with the three-step dialog: sign here, relayer sends, confirmed.
function useSender() {
  const [job, setJob] = useState(null)
  const run = useCallback(async ({ title, signer, account, calls, after }) => {
    setJob({ title, step: 'sign' })
    try {
      const result = await sendBatch({ signer, account, calls, onStep: (step) => setJob((j) => ({ ...j, step })) })
      setJob((j) => ({ ...j, step: 'done', result }))
      after?.(result)
      return result
    } catch (e) {
      setJob((j) => ({ ...j, error: e.message ?? String(e) }))
      return null
    }
  }, [])
  const dialog = (
    <Modal open={!!job} title={job?.title} onClose={() => (job?.step === 'done' || job?.error) && setJob(null)}>
      {job && <SendSteps step={job.step} result={job.result} error={job.error} />}
      {(job?.step === 'done' || job?.error) && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn primary" onClick={() => setJob(null)}>
            {job.error ? 'Close' : 'Done'}
          </button>
        </div>
      )}
    </Modal>
  )
  return { run, dialog }
}

function PersonSwitcher({ me, setMe }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const off = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [])
  const out = () => {
    signOut()
    setMe(null)
    setOpen(false)
    go('/')
  }
  const demo = mode() === 'demo'
  return (
    <div className="rel" ref={ref}>
      <button className="me-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Face person={me} />
        <span>
          {me.name} <span className="role">· {me.role}</span>
        </span>
      </button>
      {open && (
        <div className="pop" role="menu">
          <div className="pop-head">{demo ? 'Demo family: five test wallets in this browser. Switch to see each side.' : 'Signed in with this wallet.'}</div>
          {family.filter((p) => p.signer).map((p) => (
            <button key={p.id} className="person" role="menuitem" aria-current={p.id === me.id} onClick={() => (setMe(p.id), setOpen(false))}>
              <Face person={p} />
              <span>
                {p.name} · {p.role}
                <small>{p.id === 'self' ? `${p.about} · ${p.address.slice(0, 6)}…${p.address.slice(-4)}` : p.about}</small>
              </span>
            </button>
          ))}
          <div className="pop-foot">
            {demo ? (
              <button className="btn small block" onClick={() => (setOpen(false), go('/welcome'))}>
                <Icon name="wallet" /> Use my own wallet instead
              </button>
            ) : (
              <button className="btn small block" onClick={() => (startDemo(), setMe('priya'), setOpen(false), go('/family'))}>
                <Icon name="users" /> Try the demo family
              </button>
            )}
            <button className="btn small ghost block" onClick={out}>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Inbox({ me }) {
  const items = useInbox(me)
  const now = useNow(10_000)
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(() => Number(localStorage.getItem(`zf.seen.${me.id}`) ?? 0))
  useEffect(() => setSeen(Number(localStorage.getItem(`zf.seen.${me.id}`) ?? 0)), [me.id])
  const unread = items.filter((m) => m.at > seen).length
  const ref = useRef(null)
  useEffect(() => {
    const off = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [])
  const toggle = () => {
    setOpen((o) => !o)
    const t = Date.now()
    localStorage.setItem(`zf.seen.${me.id}`, String(t))
    setSeen(t)
  }
  return (
    <div className="rel bell" ref={ref}>
      <button className="btn ghost small" onClick={toggle} aria-label={`Messages, ${unread} new`}>
        <Icon name="bell" />
      </button>
      {unread > 0 && <span className="count">{unread}</span>}
      {open && (
        <div className="pop inbox">
          <div className="pop-head">Messages for {me.name}</div>
          {items.length === 0 && <p className="muted small" style={{ padding: '4px 12px 12px' }}>Nothing yet. The watcher writes here when something happens to a plan or a will.</p>}
          {items.map((m) => (
            <div className="msg" key={m.id}>
              <b>{m.title}</b>
              <p>{m.body}</p>
              <time>{rel(Math.floor(m.at / 1000), now)}{m.via === 'cre' ? ' · via Chainlink CRE' : ''}</time>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PrivChip() {
  const s = useAnon()
  const label = s.network === 'direct' ? 'Reads not private' : s.state === 'ready' ? 'Private reads' : s.state === 'failed' ? 'Privacy network down' : 'Connecting privately…'
  return (
    <a href="#/privacy" className={`privchip ${s.network === 'direct' ? 'direct' : s.state}`} title="Every blockchain read goes through Anon-RPC">
      <span className="dot" /> <span className="txt">{label}</span>
    </a>
  )
}

const NAV = [
  ['/family', 'My family'],
  ['/startup', 'Startup'],
  ['/will', 'Will'],
  ['/privacy', 'Privacy'],
  ['/how', 'How it works'],
]

function App() {
  const hash = useHash()
  const [cfg, setCfg] = useState(null)
  const [err, setErr] = useState(null)
  const [meId, setMeId] = useState(() => current()?.id ?? null)
  const me = (meId && family.find((p) => p.id === meId && p.signer)) || current()
  const sender = useSender()
  const [, bump] = useState(0)

  useEffect(() => {
    startAnon()
    // Draw as soon as the config is in; the family list follows over the mixnet.
    loadConfig().then(setCfg, (e) => setErr(e.message))
  }, [])
  // Someone may have accepted an invite since: refresh the family on each page.
  useEffect(() => {
    if (cfg) loadMembers().then(() => bump((x) => x + 1))
  }, [hash, cfg])
  const setMe = (id) => {
    if (id) choose(id)
    setMeId(id)
  }
  // Follow the connected wallet: another account becomes "you", none signs out.
  useEffect(() => watchWallet(() => (setMeId(current()?.id ?? null), bump((x) => x + 1))), [meId])

  if (err) return <main><div className="callout bad">Could not reach the Zoza Family server: {err}</div></main>
  if (!cfg) return <main><span className="spinner" /> Loading…</main>

  const [, page, arg] = hash.split('/')
  const needsMe = ['family', 'plan', 'will', 'gift', 'startup'].includes(page)
  let body
  if (!page) body = <Home />
  else if (page === 'welcome' || (needsMe && !me)) body = <Welcome next={page === 'welcome' ? '/family' : hash} />
  else if (page === 'family') body = <Family key={me.id} />
  else if (page === 'startup') body = <Startup key={me.id} />
  else if (page === 'plan' && arg === 'new') body = <PlanNew key={me.id} />
  else if (page === 'plan') body = <Plan id={Number(arg)} key={`${me.id}-${arg}`} />
  else if (page === 'will') body = <Will key={me.id} edit={arg === 'edit'} />
  else if (page === 'gift') body = <Gift id={Number(arg)} key={`${me.id}-${arg}`} />
  else if (page === 'privacy') body = <Privacy />
  else if (page === 'how') body = <How />
  else if (page === 'join') body = <Join code={arg} />
  else body = <Home />

  return (
    <Ctx.Provider value={{ me, setMe, config: cfg, send: sender.run, rerender: () => bump((x) => x + 1) }}>
      <div className="strip">
        <b>Test network.</b> Ethereum Sepolia with test money only.{mode() === 'demo' ? ' The demo family\'s wallet keys are made and kept in this browser.' : ''}
      </div>
      <header className="top">
        <div className="top-in">
          <a href="#/" className="brand">
            <span className="brand-mark">Z</span>
            <span className="brand-word">
              Zoza <b>Family</b>
            </span>
          </a>
          <nav className="nav">
            {NAV.map(([href, label]) => (
              <a key={href} href={`#${href}`} className={hash.startsWith(href) ? 'on' : ''}>
                {label}
              </a>
            ))}
          </nav>
          <div className="who">
            <PrivChip />
            {me ? (
              <>
                <Inbox me={me} key={me.id} />
                <PersonSwitcher me={me} setMe={setMe} />
              </>
            ) : (
              <a className="btn small primary" href="#/welcome">
                <Icon name="wallet" /> Sign in
              </a>
            )}
          </div>
        </div>
      </header>
      <main>
        <NetBanner />
        {body}
      </main>
      <footer className="footer">
        <div className="footer-in">
          <span>Zoza Family · a will, savings plans and a nominee, inside your own wallet. Open source, MIT.</span>
          <span>
            Not a bank deposit or insurance. Interest is variable. <a href="#/how">How it works</a>
          </span>
        </div>
      </footer>
      {sender.dialog}
    </Ctx.Provider>
  )
}

// A tab left open across a deploy keeps running old code. Look for a new build
// every minute, and reload at a calm moment: a page change, or coming back to
// the tab. Never while a wallet prompt may be open on this page.
const BUNDLE = [...document.scripts].map((x) => x.src).find((x) => /\/assets\/index-[^/]+\.js$/.test(x))
let stale = false
setInterval(async () => {
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text()
    const now = html.match(/\/assets\/index-[^"]+\.js/)?.[0]
    if (BUNDLE && now && !BUNDLE.endsWith(now)) stale = true
  } catch {}
}, 60_000)
const reloadIfStale = () => stale && !document.querySelector('.spinner') && location.reload()
window.addEventListener('hashchange', reloadIfStale)
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reloadIfStale())

// Only when the server runs with LOG_API=1: every 30 s, and on any error, one
// short line about this tab (page, who, read pass, the wallet's own account,
// any warning shown) goes to the server log, so a problem in one browser shows.
const diagErrors = []
window.addEventListener('error', (e) => diagErrors.push(`error: ${e.message}`))
window.addEventListener('zf-diag', (e) => diagErrors.push(e.detail))
window.addEventListener('unhandledrejection', (e) => diagErrors.push(`rejected: ${e.reason?.shortMessage ?? e.reason?.message ?? e.reason}`))
async function diag() {
  if (!liveConfig?.diag) return
  try {
    const me = current()
    let wallet = '-'
    if (me?.injected) {
      const [a] = (await providerFor(loadSelf()?.wallet)?.request({ method: 'eth_accounts' }).catch((e) => [`err ${e.message}`])) ?? []
      wallet = !a ? 'none' : a.toLowerCase?.() === me.address.toLowerCase() ? 'same' : a
    }
    const shown = [...document.querySelectorAll('.callout.warn, .callout.bad, .tiny.bad')].map((x) => x.innerText.trim().slice(0, 140)).slice(0, 3)
    const line = [location.hash || '#/', me ? `${me.name} ${me.address} ${me.injected ? 'metamask' : 'local'}` : 'signed out', `pass=${me ? hasPass(me) : '-'}`, `wallet=${wallet}`, `net=${anonStats.network}/${anonStats.state} anon=${anonStats.anon} failed=${anonStats.failed}`, ...shown.map((x) => `shows: ${x}`), ...diagErrors.splice(0).slice(0, 3)].join(' | ')
    await fetch('/api/diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ line }) })
  } catch {}
}
setInterval(diag, 30_000)
setTimeout(diag, 5000)
window.addEventListener('hashchange', () => setTimeout(diag, 2000))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
