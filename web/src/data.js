// Everything a screen needs about one person, read in one batch (multicall)
// through Anon-RPC, and cached so the next visit paints at once.
import { useCallback, useEffect, useRef, useState } from 'react'
import { isCalibur } from '../../shared/calibur.mjs'
import { authHeader } from './auth.js'
import { api, client, config, savings, supplyApr, usdcOf, will } from './chain.js'

export const STATES = ['None', 'Alive', 'Silent', 'Claim', 'Released']
const cacheKey = (a) => `zf.cache.${a.toLowerCase()}`

const revive = (o) =>
  JSON.parse(JSON.stringify(o), (_, v) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v))
const freeze = (o) => JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? `${v}n` : v))

async function planBundle(id) {
  const [p, value, book] = await Promise.all([savings('planOf', [id]), savings('valueOf', [id]), savings('passbookOf', [id])])
  return { id: Number(id), ...p, value, book: [...book] }
}

export async function loadPerson(address) {
  const [delegated, balance, eth, w, state, moment, named, linked, apr] = await Promise.all([
    isCalibur(client, address),
    usdcOf(address),
    client.getBalance({ address }),
    will('willOf', [address]),
    will('stateOf', [address]),
    will('nextMoment', [address]),
    will('willsNaming', [address]),
    savings('plansOf', [address]),
    supplyApr().catch(() => null),
  ])
  const [asParent, asChild, asNominee] = linked
  const ids = [...new Set([...asParent, ...asChild, ...asNominee].map(Number))]
  const plans = await Promise.all(ids.map((id) => planBundle(BigInt(id))))
  const namedIn = await Promise.all(
    [...named].map(async (owner) => {
      const [ow, st, nm, mine] = await Promise.all([
        will('willOf', [owner]),
        will('stateOf', [owner]),
        will('nextMoment', [owner]),
        will('claimable', [owner, address, config.usdc]),
      ])
      const slot = ow.heirs.findIndex((h) => h.toLowerCase() === address.toLowerCase())
      const ownerBalance = await usdcOf(owner)
      return { owner, will: ow, state: STATES[st], at: Number(nm[1]), share: ow.shares[slot], claimable: mine, ownerBalance }
    }),
  )
  return {
    address,
    delegated,
    balance,
    eth,
    will: w.heirs.length ? { ...w, state: STATES[state], at: Number(moment[1]) } : null,
    namedIn,
    plans,
    asParent: asParent.map(Number),
    asChild: asChild.map(Number),
    asNominee: asNominee.map(Number),
    apr,
    at: Date.now(),
  }
}

/// Live data for one address: cached first, then refreshed every `every` ms.
export function usePerson(address, every = 15_000) {
  const [data, setData] = useState(() => {
    try {
      const c = localStorage.getItem(cacheKey(address))
      return c ? { ...revive(JSON.parse(c)), stale: true } : null
    } catch {
      return null
    }
  })
  const [error, setError] = useState(null)
  const busy = useRef(false)
  const refresh = useCallback(async () => {
    if (busy.current || !client) return
    busy.current = true
    try {
      const d = await loadPerson(address)
      setData(d)
      setError(null)
      try {
        localStorage.setItem(cacheKey(address), freeze(d))
      } catch {}
    } catch (e) {
      setError(e?.shortMessage ?? e?.message ?? String(e))
    } finally {
      busy.current = false
    }
  }, [address])
  useEffect(() => {
    setData(() => {
      try {
        const c = localStorage.getItem(cacheKey(address))
        return c ? { ...revive(JSON.parse(c)), stale: true } : null
      } catch {
        return null
      }
    })
    refresh()
    const t = setInterval(refresh, every)
    return () => clearInterval(t)
  }, [address, every, refresh])
  return { data, error, refresh }
}

export function usePlan(id, every = 12_000) {
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState(null)
  const refresh = useCallback(async () => {
    try {
      setPlan(await planBundle(BigInt(id)))
      setError(null)
    } catch (e) {
      setError(e?.shortMessage ?? e?.message ?? String(e))
    }
  }, [id])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, every)
    return () => clearInterval(t)
  }, [refresh, every])
  return { plan, error, refresh }
}

export function useInbox(person, every = 8000) {
  const [items, setItems] = useState([])
  const address = person.address
  useEffect(() => {
    let live = true
    const load = async () => {
      const headers = await authHeader([person])
      if (!headers['x-zoza-auth']) return live && setItems([])
      const res = await fetch(`/api/inbox/${address}`, { headers }).catch(() => null)
      if (res?.ok && live) setItems(await res.json())
    }
    load()
    const t = setInterval(load, every)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [address, every, person])
  return items
}
