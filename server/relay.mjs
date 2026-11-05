// Pays gas for signed batches that only touch Zoza Family's contracts, the
// plan token or Uniswap's router. The wallet decides what is allowed; this
// only decides what we pay for.
import { getAddress, isAddress, zeroAddress } from 'viem'
import { recoverAuthorizationAddress } from 'viem/utils'
import { CALIBUR, decodeCall, executeCalldata, isCalibur, keyHashOf, signedBatchFromWire } from '../shared/calibur.mjs'
import { revertReason } from '../shared/errors.mjs'
import { abi, client, deployment, fees, relayer, UNIVERSAL_ROUTER } from './config.mjs'

const MAX_CALLS = 16
const WINDOW_MS = 60_000
const PER_WINDOW = Number(process.env.RELAY_PER_MINUTE ?? 12)
const recent = new Map()

let queue = Promise.resolve()
function serial(fn) {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

export class RelayError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

/// Why the relayer would refuse this call, or null if it would pay for it.
export function refuseCall(account, call) {
  const to = getAddress(call.to === zeroAddress ? account : call.to)
  const data = call.data ?? '0x'
  const value = BigInt(call.value ?? 0)

  if (to === getAddress(account)) {
    const d = decodeCall(abi.calibur, data)
    if (!d || !['register', 'update', 'revoke'].includes(d.functionName)) return 'only key changes may call the wallet itself'
    if (d.functionName === 'update') {
      const settings = BigInt(d.args[1])
      const hook = getAddress('0x' + (settings & ((1n << 160n) - 1n)).toString(16).padStart(40, '0'))
      if (settings >> 200n & 1n) return 'we never add admin keys'
      if (hook !== getAddress(deployment.will)) return 'keys may only be added with the Zoza Family Will hook'
    }
    return value === 0n ? null : 'no value on key changes'
  }
  if (to === getAddress(deployment.will)) return decodeCall(abi.will, data) ? null : 'unknown will call'
  if (to === getAddress(deployment.savings)) return decodeCall(abi.savings, data) ? null : 'unknown savings call'
  if (to === getAddress(deployment.usdc)) {
    const d = decodeCall(abi.erc20, data)
    if (!d) return 'unknown token call'
    if (d.functionName === 'approve' && getAddress(d.args[0]) === getAddress(deployment.savings)) return null
    if (d.functionName === 'transfer') return null
    return 'token: only transfers and approving the savings contract'
  }
  if (to === getAddress(UNIVERSAL_ROUTER)) return null // Uniswap API gift swaps
  if (data === '0x' && value > 0n) return null // an heir taking their ETH share
  return `we do not pay for calls to ${to}`
}

function rateLimit(account) {
  const now = Date.now()
  const hits = (recent.get(account) ?? []).filter((t) => now - t < WINDOW_MS)
  if (hits.length >= PER_WINDOW) throw new RelayError('too many requests, wait a minute', 429)
  hits.push(now)
  recent.set(account, hits)
}

/// body: { account, signedBatchedCall, wrappedSignature, authorization? }
export async function relay(body) {
  if (!relayer) throw new RelayError('relayer is not configured', 503)
  if (!isAddress(body?.account)) throw new RelayError('bad account')
  const account = getAddress(body.account)
  const s = signedBatchFromWire(body.signedBatchedCall)
  if (s.batchedCall.calls.length === 0 || s.batchedCall.calls.length > MAX_CALLS) throw new RelayError('1 to 16 calls')
  for (const c of s.batchedCall.calls) {
    const why = refuseCall(account, c)
    if (why) throw new RelayError(why, 403)
  }
  rateLimit(account)

  const tx = { account: relayer.account, to: account, data: executeCalldata(s, body.wrappedSignature) }
  if (body.authorization) {
    // First time: this same transaction points the EOA at Calibur (EIP-7702).
    const a = body.authorization
    const authorization = {
      address: getAddress(a.address ?? a.contractAddress),
      chainId: Number(a.chainId),
      nonce: Number(a.nonce),
      r: a.r,
      s: a.s,
      yParity: Number(a.yParity),
    }
    if (authorization.address !== getAddress(CALIBUR)) throw new RelayError('we only delegate to Calibur', 403)
    const signer = await recoverAuthorizationAddress({ authorization })
    if (getAddress(signer) !== account) throw new RelayError('authorization is not from this account', 403)
    tx.authorizationList = [authorization]
  }

  // A lagging node may not show Calibur yet; wait before simulating.
  if (!tx.authorizationList) {
    let delegated = false
    for (let i = 0; i < 6 && !delegated; i++) {
      delegated = await isCalibur(client, account)
      if (!delegated) await new Promise((r) => setTimeout(r, 1500))
    }
    if (!delegated) throw new RelayError('this wallet is not a Calibur wallet yet', 409)
  }

  // Refuse what would revert, with the reason, before paying for it.
  let gas
  try {
    gas = await client.estimateGas(tx)
  } catch (e) {
    throw new RelayError(`the wallet would refuse this: ${short(e)}`, 422)
  }
  // One send at a time, so two families never get the same relayer nonce.
  const hash = await serial(async () => relayer.sendTransaction({ ...tx, gas: (gas * 13n) / 10n, ...(await fees()) }))
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 })
  if (receipt.status !== 'success') throw new RelayError(`reverted on chain: ${hash}`, 422)
  return { hash, block: Number(receipt.blockNumber), gasUsed: receipt.gasUsed.toString() }
}

export function short(e) {
  const reason = revertReason(e) ?? e?.cause?.reason
  if (reason) return reason
  const m = e?.shortMessage ?? e?.message ?? String(e)
  return m.split('\n')[0].slice(0, 200)
}

export { keyHashOf }
