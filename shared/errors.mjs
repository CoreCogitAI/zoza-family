// Turn revert data into an error name, unwrapping Calibur's CallFailed(bytes).
import { decodeErrorResult, parseAbi } from 'viem'
import abi from './abi.json' with { type: 'json' }

const CALIBUR_ERRORS = parseAbi([
  'error CallFailed(bytes reason)',
  'error Unauthorized()',
  'error InvalidSignature()',
  'error SignatureExpired()',
  'error InvalidNonce()',
  'error OnlyAdminCanSelfCall()',
  'error KeyExpired(uint40 expiry)',
  'error KeyDoesNotExist()',
  'error InvalidHookResponse()',
  'error Error(string)',
])
const ALL = [...abi.will, ...abi.savings, ...abi.watcher, ...CALIBUR_ERRORS].filter((x) => x.type === 'error')

export function errorName(data, depth = 0) {
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10 || depth > 3) return null
  try {
    const d = decodeErrorResult({ abi: ALL, data })
    if (d.errorName === 'CallFailed') return errorName(d.args[0], depth + 1) ?? 'CallFailed'
    if (d.errorName === 'Error') return String(d.args[0])
    return d.errorName
  } catch {
    return null
  }
}

/// Find revert data anywhere in a viem error and name it.
export function revertReason(e) {
  let found = null
  const seen = new Set()
  const visit = (x) => {
    if (!x || typeof x !== 'object' || seen.has(x) || found) return
    seen.add(x)
    for (const v of [x.data, x.data?.data, x.raw]) {
      const n = errorName(v)
      if (n) {
        found = n
        return
      }
    }
    if (typeof x.details === 'string') {
      const m = x.details.match(/0x[0-9a-fA-F]{8,}/)
      if (m) found = errorName(m[0])
    }
    visit(x.cause)
    visit(x.error)
  }
  visit(e)
  return found
}
