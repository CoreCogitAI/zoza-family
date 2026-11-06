// Exchange rates, so the website can show USDC in the viewer's own currency.
// The server fetches them, so a visitor's browser never contacts a rate
// provider. Rates from ExchangeRate-API's open endpoint, refreshed every 6 hours.
const SOURCE = process.env.FX_URL ?? 'https://open.er-api.com/v6/latest/USD'
const FRESH_MS = 6 * 3600_000
let cache = null

export async function rates() {
  if (cache && Date.now() - cache.fetched < FRESH_MS) return cache.body
  try {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(8000) })
    const j = await res.json()
    if (j.result !== 'success' || !j.rates?.USD) throw new Error(j['error-type'] ?? `status ${res.status}`)
    cache = { fetched: Date.now(), body: { base: 'USD', updated: j.time_last_update_unix, source: 'https://www.exchangerate-api.com', rates: j.rates } }
  } catch (e) {
    console.warn('fx:', e.message)
    if (!cache) return { base: 'USD', updated: null, source: null, rates: { USD: 1 } } // USDC only until rates load
  }
  return cache.body
}
