import { useEffect, useState } from 'react'
import { addrUrl, config, txUrl } from './chain.js'
import { byAddress } from './family.js'

const PATHS = {
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  piggy: 'M5 11a7 6 0 0 1 12.5-2.5H20v4l-2 1.5V17h-3v-2H9v2H6v-2.5A6 6 0 0 1 5 11zM15 10h.01',
  scroll: 'M8 4h10a2 2 0 0 1 2 2v1H10V6a2 2 0 0 0-2-2zm0 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 12h6M10 16h4',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3-5-3-5-.5S12 7 12 7zm0 0c1.5-3 5-3 5-.5S12 7 12 7z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeoff: 'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.2 7.4C3.6 9.1 2 12 2 12s3.5 6 10 6c1.5 0 2.9-.3 4.1-.8M9.9 9.9a3 3 0 0 0 4.2 4.2',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  key: 'M15 7a4 4 0 1 1-3.5 6L5 19.5V22H2v-3l6.5-6.5A4 4 0 0 1 15 7zm1 2h.01',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  warn: 'M12 4l9 16H3l9-16zM12 10v4M12 17h.01',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  pause: 'M9 5v14M15 5v14',
  play: 'M7 5l12 7-12 7V5z',
  coins: 'M9 8a6 3 0 1 0 12 0A6 3 0 1 0 9 8zM9 8v4c0 1.7 2.7 3 6 3s6-1.3 6-3V8M3 12a6 3 0 0 0 6 3M3 12v4c0 1.7 2.7 3 6 3 1.2 0 2.3-.2 3.2-.5M3 12c0-1.2 1.4-2.2 3.4-2.7',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  mask: 'M3 9c3-1 6-1 9 1 3-2 6-2 9-1-.3 5-3 8-6 8-1.6 0-2.4-1-3-2-.6 1-1.4 2-3 2-3 0-5.7-3-6-8zM8 12h.01M16 12h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01',
  swap: 'M7 7h12l-3-3M17 17H5l3 3',
  door: 'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18M14 12h.01',
  cap: 'M2 9l10-5 10 5-10 5L2 9zM6 11v5c0 1 3 3 6 3s6-2 6-3v-5M22 9v6',
  rings: 'M9 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM15 19a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
}

export function Icon({ name, className, title }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  )
}

export function Face({ person, size = '', title }) {
  if (!person) return <span className={`face tone-teal ${size}`}>?</span>
  return (
    <span className={`face tone-${person.tone} ${size}`} title={title ?? `${person.name}, ${person.role}`}>
      {person.name[0]}
    </span>
  )
}

/// A family member by address, or a short address.
export function Who({ address, showRole }) {
  const p = byAddress(address)
  if (!p) return <Addr address={address} />
  return (
    <span className="row" style={{ gap: 8, display: 'inline-flex' }}>
      <Face person={p} size="sm" />
      <span>
        {p.name}
        {showRole && <span className="muted small"> · {p.role}</span>}
      </span>
    </span>
  )
}

export function CopyButton({ value, label = 'Copy' }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="iconbtn"
      aria-label={label}
      title={done ? 'Copied' : label}
      onClick={() => {
        navigator.clipboard?.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      <Icon name={done ? 'check' : 'copy'} />
    </button>
  )
}

export function Addr({ address, full }) {
  if (!address) return null
  const text = full ? address : `${address.slice(0, 6)}…${address.slice(-4)}`
  return (
    <span className="addr">
      <a href={addrUrl(address)} target="_blank" rel="noreferrer" title={address}>
        {text}
      </a>
      <CopyButton value={address} label="Copy address" />
    </span>
  )
}

export function TxLink({ hash, children = 'View on Etherscan' }) {
  if (!hash || !config) return null
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="row" style={{ display: 'inline-flex', gap: 5 }}>
      {children} <Icon name="ext" />
    </a>
  )
}

export function Callout({ tone = 'info', icon, children }) {
  const i = icon ?? { info: 'info', warn: 'warn', bad: 'warn', ok: 'check', guard: 'shield' }[tone]
  return (
    <div className={`callout ${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon name={i} />
      <div>{children}</div>
    </div>
  )
}

export function Tip({ children, label = 'More information' }) {
  return (
    <span className="tip">
      <button type="button" aria-label={label}>
        <Icon name="info" />
      </button>
      <span className="tip-body" role="tooltip">
        {children}
      </span>
    </span>
  )
}

export function Modal({ open, title, children, onClose }) {
  useEffect(() => {
    if (!open) return
    const k = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

/// The three steps of every action: sign here, relayer sends, confirmed.
export function SendSteps({ step, result, error }) {
  const steps = [
    ['sign', 'Signed on this device', 'Your key never leaves this browser'],
    ['send', 'Sent by the Zoza relayer', 'Zoza pays the gas, so you need no ETH'],
    ['done', 'Confirmed on Ethereum Sepolia', null],
  ]
  const at = steps.findIndex((s) => s[0] === step)
  return (
    <div className="sending" aria-live="polite">
      {steps.map(([id, label, sub], i) => {
        const state = error && i === at ? 'err' : i < at || step === 'done' ? 'done' : i === at ? 'now' : ''
        return (
          <div key={id} className={`send-step ${state === 'err' ? '' : state}`}>
            <span className="bullet">{state === 'done' && <Icon name="check" />}</span>
            <div>
              {label}
              {sub && <div className="tiny muted">{sub}</div>}
              {id === 'done' && result?.hash && (
                <div className="tiny">
                  <TxLink hash={result.hash}>Block {result.block} · view on Etherscan</TxLink>
                </div>
              )}
            </div>
          </div>
        )
      })}
      {error && (
        <Callout tone="bad">
          <b>Nothing was sent.</b> {error}
        </Callout>
      )}
    </div>
  )
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/// "in 3 minutes", "2 days ago"
export function rel(at, now) {
  const s = Number(at) - now
  const a = Math.abs(s)
  const unit = a < 90 ? [Math.round(a), 'second'] : a < 5400 ? [Math.round(a / 60), 'minute'] : a < 129600 ? [Math.round(a / 3600), 'hour'] : a < 5184000 ? [Math.round(a / 86400), 'day'] : [Math.round(a / 2592000), 'month']
  const t = `${unit[0]} ${unit[1]}${unit[0] === 1 ? '' : 's'}`
  return s >= 0 ? `in ${t}` : `${t} ago`
}

export const dateOf = (unix) => new Date(Number(unix) * 1000).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function Ring({ pct, children }) {
  return (
    <div className="ring" style={{ '--p': Math.max(0, Math.min(100, pct)) }}>
      <div>{children}</div>
    </div>
  )
}

export function Empty({ icon = 'info', title, children, action }) {
  return (
    <div className="card flat" style={{ textAlign: 'center', padding: '36px 24px' }}>
      <div className="pb-ico" style={{ margin: '0 auto 12px', width: 40, height: 40 }}>
        <Icon name={icon} />
      </div>
      <h3>{title}</h3>
      {children && <p className="muted small" style={{ marginTop: 6 }}>{children}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

export const Skel = ({ w = 80 }) => <span className="skeleton" style={{ width: w }} />
