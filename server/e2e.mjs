// End to end on a real chain, through the running server, with a fresh family
// every run. Short timings stand in for months and years.
//   node e2e.mjs            (server on API_URL, default http://127.0.0.1:8790)
import { createPublicClient, encodeFunctionData, erc20Abi, fallback, formatUnits, http, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import abi from '../shared/abi.json' with { type: 'json' }
import { addGuardedKey, CALIBUR, isCalibur, signBatch, toWire } from '../shared/calibur.mjs'
import { readMessage } from '../shared/invites.mjs'

const API = process.env.API_URL ?? 'http://127.0.0.1:8790'
const SILENCE = Number(process.env.SILENCE_S ?? 45)
const WINDOW = Number(process.env.WINDOW_S ?? 30)
const PERIOD = Number(process.env.PERIOD_S ?? 40)
const MATURES_IN = Number(process.env.MATURES_S ?? 260)
const INSTALMENT = parseUnits(process.env.INSTALMENT ?? '0.5', 6)

let passed = 0
let failed = 0
const check = (ok, what, extra = '') => {
  ok ? passed++ : failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? `  ${extra}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(path, body) {
  const res = await fetch(`${API}/api${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toWire(body)) } : undefined)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

const cfg = await call('/config')
const RPCS = (process.env.RPC_URLS ?? 'https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.gateway.tenderly.co,https://1rpc.io/sepolia').split(',')
const client = createPublicClient({ transport: fallback(RPCS.map((u) => http(u, { retryCount: 1 })), { retryCount: 2 }) })
const read = (address, a, functionName, args = []) => client.readContract({ address, abi: a, functionName, args })
const usdc = (who) => read(cfg.usdc, erc20Abi, 'balanceOf', [who])
const now = async () => Number((await client.getBlock()).timestamp)
const tx = (h) => `${cfg.explorer}/tx/${h}`

/// Sign a batch as `signer` for `account`, adding the 7702 authorization the
/// first time, and send it through the relayer.
async function send(signer, account, calls, retry = true) {
  const body = { account, ...(await signBatch({ client, signer, account, calls })) }
  if (signer.address === account && !(await isCalibur(client, account))) {
    const nonce = await client.getTransactionCount({ address: account })
    body.authorization = await signer.signAuthorization({ contractAddress: CALIBUR, chainId: cfg.chainId, nonce })
  }
  const out = await call('/relay', body)
  // A lagging node can hand out a stale nonce: sign again once.
  if (retry && /InvalidNonce/.test(out.error ?? '')) {
    await sleep(2500)
    return send(signer, account, calls, false)
  }
  return out
}

/// The signed header that lets `signer` read its own inbox.
async function readAuth(signer) {
  const address = signer.address.toLowerCase()
  const expiry = Math.floor(Date.now() / 1000) + 3600
  const signature = await signer.signMessage({ message: readMessage(address, expiry) })
  return { 'x-zoza-auth': Buffer.from(JSON.stringify([{ address, expiry, signature }])).toString('base64url') }
}

async function until(what, fn, seconds) {
  const end = Date.now() + seconds * 1000
  while (Date.now() < end) {
    try {
      if (await fn()) return true
    } catch {} // a public RPC hiccup: try again
    await sleep(3000)
  }
  console.log(`      (gave up waiting for ${what})`)
  return false
}

const priya = privateKeyToAccount(generatePrivateKey())
const arjun = privateKeyToAccount(generatePrivateKey())
const meera = privateKeyToAccount(generatePrivateKey())
const ravi = privateKeyToAccount(generatePrivateKey())
const dada = privateKeyToAccount(generatePrivateKey())
console.log(`family: priya ${priya.address}  arjun ${arjun.address}  meera ${meera.address}  ravi ${ravi.address}  dada ${dada.address}`)

// 1. Test money
const f1 = await call('/faucet', { address: priya.address })
check(f1.status === 200, 'faucet: Priya gets test USDC', f1.error ?? '')
const f2 = await call('/faucet', { address: dada.address, eth: true })
check(f2.status === 200, 'faucet: Dada gets test USDC and ETH for a gift', f2.error ?? '')

// 2. Priya: one signature makes her wallet Calibur, writes her will, and opens Meera's plan.
const start = await now()
const setup = [
  ...addGuardedKey(arjun.address, cfg.will),
  ...addGuardedKey(meera.address, cfg.will),
  { to: cfg.will, data: encodeFunctionData({ abi: abi.will, functionName: 'makeWill', args: [[arjun.address, meera.address], [6000, 4000], [cfg.usdc], SILENCE, WINDOW] }) },
  { to: cfg.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [cfg.savings, INSTALMENT * 2n] }) },
  { to: cfg.savings, data: encodeFunctionData({ abi: abi.savings, functionName: 'createPlan', args: ["Meera's studies", meera.address, ravi.address, INSTALMENT, PERIOD, BigInt(start + MATURES_IN), true] }) },
]
const s1 = await send(priya, priya.address, setup)
check(s1.status === 200, 'Priya: Calibur + will + plan in one gasless transaction', s1.hash ? tx(s1.hash) : s1.error)
check(await until('delegation to show', () => isCalibur(client, priya.address), 20), 'Priya: her address now runs Calibur (EIP-7702), same address')
check(Number(await read(cfg.will, abi.will, 'stateOf', [priya.address])) === 1, 'will: Alive')
check((await client.getBalance({ address: priya.address })) === 0n, 'Priya never held ETH')
const [asParent] = await read(cfg.savings, abi.savings, 'plansOf', [priya.address])
const planId = asParent[asParent.length - 1]
console.log(`      plan #${planId}`)

// 3. The relayer refuses what it should not pay for, and the chain refuses early claims.
const bad = await send(priya, priya.address, [{ to: '0x000000000000000000000000000000000000dEaD', data: '0xa9059cbb' }])
check(bad.status === 403, 'relayer refuses calls outside Zoza Family', bad.error)
const early = await send(arjun, priya.address, [{ to: cfg.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [arjun.address, 1n] }) }])
check(early.status === 422, 'Arjun cannot take anything while Priya is around', early.error)

// 4. The watcher collects the first instalment.
check(await until('first instalment', async () => (await read(cfg.savings, abi.savings, 'planOf', [planId])).paidCount >= 1, 60), 'watcher collected the first instalment')

// 4b. Priya tops up. approve() replaces the allowance, so she adds to it and the mandate survives.
const allowance = () => read(cfg.usdc, erc20Abi, 'allowance', [priya.address, cfg.savings])
const paid = async () => (await read(cfg.savings, abi.savings, 'planOf', [planId])).paidCount
const TOP_UP = 100_000n
const [haveBefore, paidBefore] = [await allowance(), await paid()]
const top = await send(priya, priya.address, [
  { to: cfg.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [cfg.savings, haveBefore + TOP_UP] }) },
  { to: cfg.savings, data: encodeFunctionData({ abi: abi.savings, functionName: 'deposit', args: [planId, TOP_UP] }) },
])
check(top.status === 200, 'Priya tops up the plan', top.hash ? tx(top.hash) : top.error)
const pulled = BigInt((await paid()) - paidBefore) * INSTALMENT
check((await allowance()) + pulled === haveBefore, 'the monthly mandate is untouched by the top-up')

// 5. Dada gives a gift in ETH; the Uniswap API swaps it to USDC inside his batch.
const q = await call(`/gift-quote?eth=0.0002&swapper=${dada.address}`)
check(q.status === 200 && BigInt(q.minOut ?? 0) > 0n, 'Uniswap API quote for the gift', q.status === 200 ? `${formatUnits(BigInt(q.amountOut), 6)} USDC via ${JSON.stringify(q.route)}` : q.error)
if (q.status === 200) {
  const gift = [
    { to: q.swap.to, data: q.swap.data, value: BigInt(q.swap.value) },
    { to: cfg.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [cfg.savings, BigInt(q.minOut)] }) },
    { to: cfg.savings, data: encodeFunctionData({ abi: abi.savings, functionName: 'deposit', args: [planId, BigInt(q.minOut)] }) },
  ]
  const g = await send(dada, dada.address, gift)
  check(g.status === 200, 'Dada: ETH -> Uniswap -> USDC -> Meera\'s plan, one gasless signature', g.hash ? tx(g.hash) : g.error)
  const book = await read(cfg.savings, abi.savings, 'passbookOf', [planId])
  check(book.some((e) => e.kind === 2), 'passbook shows the gift')
}

// 6. Priya goes quiet; the watcher opens a claim; she checks in and cancels it.
check(await until('claim to open', async () => Number(await read(cfg.will, abi.will, 'stateOf', [priya.address])) === 3, SILENCE + 60), 'watcher opened a claim after silence')
const told = await until('message to Arjun', async () => {
  const box = await fetch(`${API}/api/inbox/${arjun.address}`, { headers: await readAuth(arjun) }).then((r) => r.json())
  return Array.isArray(box) && box.some((m) => m.title === 'A claim has opened')
}, 20)
check(told, 'Arjun was told')
const ci = await send(priya, priya.address, [{ to: cfg.will, data: encodeFunctionData({ abi: abi.will, functionName: 'checkIn', args: [] }) }])
check(ci.status === 200 && (await until('check-in to show', async () => Number(await read(cfg.will, abi.will, 'stateOf', [priya.address])) === 1, 20)), 'Priya: "I\'m here" cancels the claim', ci.hash ? tx(ci.hash) : ci.error)

// 7. Silent again: this time the window passes and each heir takes their share.
check(await until('second claim', async () => Number(await read(cfg.will, abi.will, 'stateOf', [priya.address])) === 3, SILENCE + 60), 'claim opened again')
check(await until('release', async () => Number(await read(cfg.will, abi.will, 'stateOf', [priya.address])) === 4, WINDOW + 90), 'cancel window passed: released')
const share = await read(cfg.will, abi.will, 'claimable', [priya.address, arjun.address, cfg.usdc])
const greedy = await send(arjun, priya.address, [{ to: cfg.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [arjun.address, share + 1n] }) }])
check(greedy.status === 422, 'Arjun cannot take more than his 60%', greedy.error)
const steal = await send(arjun, priya.address, [{ to: cfg.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [ravi.address, 1n] }) }])
check(steal.status === 422, 'Arjun cannot send Priya\'s money to anyone else', steal.error)
const take = await send(arjun, priya.address, [{ to: cfg.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [arjun.address, share] }) }])
check(take.status === 200 && (await until('Arjun\'s share to show', async () => (await usdc(arjun.address)) === share, 20)), `Arjun received his share, gasless: ${formatUnits(share, 6)} USDC`, take.hash ? tx(take.hash) : take.error)
const meeraShare = await read(cfg.will, abi.will, 'claimable', [priya.address, meera.address, cfg.usdc])
const take2 = await send(meera, priya.address, [{ to: cfg.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [meera.address, meeraShare] }) }])
check(take2.status === 200, `Meera received her 40%: ${formatUnits(meeraShare, 6)} USDC`, take2.hash ? tx(take2.hash) : take2.error)
check(meeraShare * 6000n / 4000n - share <= 1n, 'shares are 60/40 of the same balance')

// 8. The nominee points the plan to Meera's new wallet; the plan matures to it.
const newMeera = privateKeyToAccount(generatePrivateKey())
const sc = await send(ravi, ravi.address, [{ to: cfg.savings, data: encodeFunctionData({ abi: abi.savings, functionName: 'setChild', args: [planId, newMeera.address] }) }])
check(sc.status === 200, 'Ravi (nominee) moved the plan to Meera\'s new wallet', sc.hash ? tx(sc.hash) : sc.error)
const value = await read(cfg.savings, abi.savings, 'valueOf', [planId])
const paidIn = (await read(cfg.savings, abi.savings, 'planOf', [planId])).paidIn
console.log(`      plan value ${formatUnits(value, 6)} USDC, paid in ${formatUnits(paidIn, 6)} (Compound interest ${formatUnits(value - paidIn, 6)})`)
const left = start + MATURES_IN - (await now())
check(await until('maturity', async () => (await read(cfg.savings, abi.savings, 'planOf', [planId])).closed, Math.max(left, 0) + 60), 'watcher released the plan at maturity')
const got = await usdc(newMeera.address)
check(got + 10n >= paidIn, `Meera's new wallet received ${formatUnits(got, 6)} USDC (paid in ${formatUnits(paidIn, 6)})`)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
