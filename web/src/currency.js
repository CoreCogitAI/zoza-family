// Amounts are USDC (US dollars). Next to them the site shows an estimate in
// the viewer's own currency, at today's rate from our server.
import { formatUnits } from 'viem'
import { serverFetch } from './anon.js'

const KEY = 'zf.currency'
const RATES = 'zf.fx'
const EURO = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' ')
const BY_REGION = {
  US: 'USD', IN: 'INR', GB: 'GBP', AE: 'AED', SA: 'SAR', SG: 'SGD', JP: 'JPY', CN: 'CNY', HK: 'HKD', KR: 'KRW',
  AU: 'AUD', NZ: 'NZD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', NG: 'NGN', KE: 'KES', ZA: 'ZAR', EG: 'EGP',
  ID: 'IDR', PH: 'PHP', TH: 'THB', VN: 'VND', MY: 'MYR', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', TR: 'TRY',
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', IL: 'ILS',
  ...Object.fromEntries(EURO.map((r) => [r, 'EUR'])),
}
// The time zone says more about where someone is than the browser's language.
const BY_ZONE = { 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Asia/Singapore': 'SG', 'Europe/London': 'GB', 'Asia/Tokyo': 'JP', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Kathmandu': 'NP', 'Asia/Colombo': 'LK', 'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE' }

export const CURRENCIES = [...new Set(['USD', ...Object.values(BY_REGION)])].sort()

function guess() {
  try {
    const zone = BY_ZONE[Intl.DateTimeFormat().resolvedOptions().timeZone]
    if (zone) return BY_REGION[zone]
    const region = new Intl.Locale(navigator.language).maximize().region
    return BY_REGION[region] ?? 'USD'
  } catch {
    return 'USD'
  }
}

const stored = (k) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
let currency = stored(KEY) ?? guess()
let fx = (() => {
  try {
    return JSON.parse(stored(RATES)) ?? null
  } catch {
    return null
  }
})()

export const currencyCode = () => currency
export const currencyName = (c = currency) => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'currency' }).of(c)
  } catch {
    return c
  }
}
export function setCurrency(c) {
  currency = c
  try {
    localStorage.setItem(KEY, c)
  } catch {}
  window.dispatchEvent(new Event('zf-fx'))
}

export async function loadRates() {
  try {
    const res = await serverFetch('/api/fx')
    const body = await res.json()
    if (!body?.rates?.USD) return
    fx = body
    try {
      localStorage.setItem(RATES, JSON.stringify(body))
    } catch {}
    window.dispatchEvent(new Event('zf-fx'))
  } catch {}
}

/// "≈ €1.23" for a USDC amount (6 decimals), or '' when the viewer uses US
/// dollars or the rate is not known yet.
export function fxOf(v) {
  const rate = fx?.rates?.[currency]
  if (currency === 'USD' || !rate) return ''
  const n = Number(formatUnits(BigInt(v ?? 0), 6)) * rate
  try {
    return '≈ ' + new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 }).format(n)
  } catch {
    return `≈ ${n.toFixed(2)} ${currency}`
  }
}

/// "12.50 USDC · ≈ €11.50"
export const withFx = (v, usd) => `${usd(v)} USDC${fxOf(v) ? ` · ${fxOf(v)}` : ''}`
export const ratesDate = () => (fx?.updated ? new Date(fx.updated * 1000).toLocaleDateString() : null)
