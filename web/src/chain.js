import { createPublicClient, custom, defineChain, encodeFunctionData, erc20Abi, formatUnits, getAddress } from 'viem'
import abi from '../../shared/abi.json'
import { CALIBUR, isCalibur, signBatch, toWire } from '../../shared/calibur.mjs'
import { provider, serverFetch } from './anon.js'

export { abi }
export let config = null
export let client = null

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'

export async function loadConfig() {
  // Direct: it carries no family data, and the page itself just came from this server.
  // A saved copy lets a returning visitor start at once; a changed config reloads.
  const fresh = fetch('/api/config').then((r) => (r.ok ? r.text() : Promise.reject(new Error(`config ${r.status}`))))
  let saved = null
  try {
    saved = localStorage.getItem('zf.config')
  } catch {}
  const text = saved ?? (await fresh)
  fresh.then(
    (t) => {
      try {
        localStorage.setItem('zf.config', t)
      } catch {}
      if (saved && t !== saved) location.reload()
    },
    () => {},
  )
  config = JSON.parse(text)
  const chain = defineChain({
    id: config.chainId,
    name: config.chainName,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpc] } },
    blockExplorers: { default: { name: 'Etherscan', url: config.explorer } },
    contracts: { multicall3: { address: MULTICALL3 } },
  })
  // Reads go through Anon-RPC, batched so one private request carries many.
  client = createPublicClient({ chain, transport: custom(provider(config.rpc)), batch: { multicall: { wait: 30 } } })
  return config
}

export const read = (address, a, functionName, args = []) => client.readContract({ address, abi: a, functionName, args })
export const will = (fn, args) => read(config.will, abi.will, fn, args)
export const savings = (fn, args) => read(config.savings, abi.savings, fn, args)
export const usdcOf = (who) => read(config.usdc, erc20Abi, 'balanceOf', [who])
// approve() replaces the allowance, so new approvals add to what plans already have.
export const allowanceOf = (who) => read(config.usdc, erc20Abi, 'allowance', [who, config.savings])

export const call = {
  will: (functionName, args = []) => ({ to: config.will, data: encodeFunctionData({ abi: abi.will, functionName, args }) }),
  savings: (functionName, args = []) => ({ to: config.savings, data: encodeFunctionData({ abi: abi.savings, functionName, args }) }),
  usdc: (functionName, args = []) => ({ to: config.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName, args }) }),
}

/// Sign on this device, then the relayer sends it and pays the gas. The first
/// time, the same transaction upgrades the wallet to Calibur (EIP-7702).
export async function sendBatch({ signer, account, calls, onStep = () => {} }) {
  account = getAddress(account ?? signer.address)
  if (signer.injected && getAddress(signer.address) === account) {
    // A connected wallet cannot be upgraded by us, so it sends its own
    // transactions and pays their gas. Each waits for the one before.
    let hash
    for (const c of calls) {
      onStep('sign')
      hash = await signer.wallet.sendTransaction({ to: c.to, data: c.data, value: BigInt(c.value ?? 0) })
      onStep('send')
      await client.waitForTransactionReceipt({ hash, timeout: 180_000 })
    }
    onStep('done')
    return { hash }
  }
  onStep('sign')
  const body = { account, ...(await signBatch({ client, signer, account, calls })) }
  if (getAddress(signer.address) === account && !(await isCalibur(client, account))) {
    const nonce = await client.getTransactionCount({ address: account })
    body.authorization = await signer.signAuthorization({ contractAddress: CALIBUR, chainId: config.chainId, nonce })
  }
  onStep('send')
  const res = await serverFetch('/api/relay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toWire(body)) }, account)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(plainError(json.error ?? `relayer error ${res.status}`))
  onStep('done')
  return json
}

/// Contract errors in words a family can read.
export function plainError(msg) {
  const map = {
    NotReleased: 'Not yet. The owner still has time to say "I\'m here".',
    NotSilentYet: 'The owner checked in recently, so a claim cannot open yet.',
    MoreThanShare: 'That is more than your share.',
    NotYourAddress: 'Shares can only go to your own wallet.',
    TokenNotInWill: 'That token is not in the will.',
    NotAnHeirKey: 'This wallet is not named in that will.',
    NomineeMustAgree: 'The nominee has to agree first.',
    NomineeTooNew: 'The nominee changed recently. Early closing opens one period after the change.',
    NotDue: 'This month\'s instalment is already collected.',
    PastMaturity: 'The plan has matured.',
    NotMature: 'The plan has not matured yet.',
    TransferFailed: 'Not enough USDC in the wallet.',
    BadPlan: 'Something in the plan is not allowed. Check the amounts and dates.',
    BadWill: 'Shares must add up to 100%, with no one listed twice.',
    HeirKeyNotGuarded: 'An heir key was not set up with the will\'s guard.',
    NoTunnelExitError: 'The Nox mixnet has no exit node right now, so nothing was sent. Try again in a minute, or choose another network on the Privacy page.',
    TunnelOpenTimeoutError: 'The Nox mixnet did not open a connection in time, so nothing was sent. Try again in a minute, or choose another network on the Privacy page.',
  }
  for (const [k, v] of Object.entries(map)) if (msg.includes(k)) return v
  return msg.replace(/^the wallet would refuse this: /, 'The wallet refused: ')
}

export const usd = (v, d = 2) => Number(formatUnits(BigInt(v ?? 0), 6)).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
// For illustration only; the plans hold US dollars (USDC).
export const INR_PER_USD = 88
export const inr = (v) => '₹' + Math.round(Number(formatUnits(BigInt(v ?? 0), 6)) * INR_PER_USD).toLocaleString('en-IN')
export const txUrl = (h) => `${config.explorer}/tx/${h}`
export const addrUrl = (a) => `${config.explorer}/address/${a}`

/// Compound III supply APR right now, as a percentage.
export async function supplyApr() {
  const u = await read(config.comet, abi.comet, 'getUtilization')
  const r = await read(config.comet, abi.comet, 'getSupplyRate', [u])
  return (Number(r) * 31_536_000) / 1e16
}

export async function api(path, body, who) {
  const res = await serverFetch(`/api${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}, who)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `error ${res.status}`)
  return json
}
