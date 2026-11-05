// Talking to a wallet that runs Uniswap's Calibur through EIP-7702.
// Used by the website (signing) and the server (relaying and checking).
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  zeroAddress,
  zeroHash,
} from 'viem'
import abi from './abi.json' with { type: 'json' }

export const CALIBUR = '0x000000005c84F8Fd50b21CAC312528A64437030e'
const SECP256K1 = 2
const DELEGATION_PREFIX = '0xef0100'

export const SIGNED_BATCH_TYPES = {
  SignedBatchedCall: [
    { name: 'batchedCall', type: 'BatchedCall' },
    { name: 'nonce', type: 'uint256' },
    { name: 'keyHash', type: 'bytes32' },
    { name: 'executor', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
  BatchedCall: [
    { name: 'calls', type: 'Call[]' },
    { name: 'revertOnFailure', type: 'bool' },
  ],
  Call: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
}

const executeSigned = abi.calibur.find((f) => f.name === 'execute' && f.inputs.length === 2)

/// Calibur's key hash for an Ethereum address key.
export function keyHashOf(address) {
  const pub = keccak256(encodeAbiParameters([{ type: 'address' }], [getAddress(address)]))
  return keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [SECP256K1, pub]))
}

/// Is this address an EOA delegated to Calibur?
export async function isCalibur(client, address) {
  const code = await client.getCode({ address })
  return !!code && code.toLowerCase() === (DELEGATION_PREFIX + CALIBUR.slice(2)).toLowerCase()
}

/// Two self-calls that add `signer` as a non-admin key guarded by `hook`.
export function addGuardedKey(signer, hook) {
  const keyHash = keyHashOf(signer)
  const publicKey = encodeAbiParameters([{ type: 'address' }], [getAddress(signer)])
  return [
    { to: zeroAddress, value: 0n, data: encodeFunctionData({ abi: abi.calibur, functionName: 'register', args: [{ keyType: SECP256K1, publicKey }] }) },
    { to: zeroAddress, value: 0n, data: encodeFunctionData({ abi: abi.calibur, functionName: 'update', args: [keyHash, BigInt(hook)] }) },
  ]
}

let domainBase
/// Calibur's EIP-712 domain for `account`. Name, version and salt come from
/// the implementation, so this works before the account is delegated.
export async function caliburDomain(client, account) {
  if (!domainBase) {
    const [, name, version, chainId, , salt] = await client.readContract({
      address: CALIBUR,
      abi: [{ type: 'function', name: 'eip712Domain', stateMutability: 'view', inputs: [], outputs: [
        { type: 'bytes1' }, { type: 'string' }, { type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint256[]' },
      ] }],
      functionName: 'eip712Domain',
    })
    domainBase = { name, version, chainId: Number(chainId), salt }
  }
  return { ...domainBase, verifyingContract: getAddress(account) }
}

/// Next nonce on sequence key 0, retried if a lagging node shows no code yet.
export async function nextNonce(client, account) {
  for (let attempt = 0; ; attempt++) {
    const delegated = await isCalibur(client, account)
    if (delegated) {
      try {
        return await client.readContract({ address: account, abi: abi.calibur, functionName: 'getSeq', args: [0n] })
      } catch (e) {
        if (attempt >= 4) throw e
      }
    } else if (attempt >= 1) {
      return 0n
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
}

/// Sign a batch for `account` with `signer` (a viem local account). The
/// account's own key signs as the root key; any other key signs as itself.
export async function signBatch({ client, signer, account, calls, deadline = 0n }) {
  const asOwner = getAddress(signer.address) === getAddress(account)
  const signedBatchedCall = {
    batchedCall: { calls: calls.map((c) => ({ to: c.to, value: BigInt(c.value ?? 0), data: c.data ?? '0x' })), revertOnFailure: true },
    nonce: await nextNonce(client, account),
    keyHash: asOwner ? zeroHash : keyHashOf(signer.address),
    executor: zeroAddress,
    deadline,
  }
  const signature = await signer.signTypedData({
    domain: await caliburDomain(client, account),
    types: SIGNED_BATCH_TYPES,
    primaryType: 'SignedBatchedCall',
    message: signedBatchedCall,
  })
  const wrappedSignature = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes' }], [signature, '0x'])
  return { signedBatchedCall, wrappedSignature }
}

/// Calldata for the relayer: account.execute(signedBatchedCall, wrappedSignature).
export function executeCalldata(signedBatchedCall, wrappedSignature) {
  return encodeFunctionData({ abi: [executeSigned], functionName: 'execute', args: [signedBatchedCall, wrappedSignature] })
}

/// The selector and decoded args of a call into one of our ABIs, or null.
export function decodeCall(abiList, data) {
  try {
    return decodeFunctionData({ abi: abiList, data })
  } catch {
    return null
  }
}

/// JSON with bigints as strings, for the wire.
export const toWire = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)))

export function signedBatchFromWire(w) {
  return {
    batchedCall: {
      calls: w.batchedCall.calls.map((c) => ({ to: getAddress(c.to), value: BigInt(c.value), data: c.data })),
      revertOnFailure: !!w.batchedCall.revertOnFailure,
    },
    nonce: BigInt(w.nonce),
    keyHash: w.keyHash,
    executor: getAddress(w.executor),
    deadline: BigInt(w.deadline),
  }
}
