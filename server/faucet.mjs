// Test money for the demo family. The treasury holds Circle's test USDC
// (bought through the Uniswap API by fund.mjs) and a little Sepolia ETH.
import { erc20Abi, formatUnits, getAddress, isAddress, parseEther, parseUnits } from 'viem'
import { client, deployment, fees, treasury } from './config.mjs'
import { db, save } from './store.mjs'

const USDC_EACH = parseUnits(process.env.FAUCET_USDC ?? '3', 6)
const ETH_EACH = parseEther(process.env.FAUCET_ETH ?? '0.00025') // for gifts in ETH
// A connected wallet pays its own gas, and its wallet may suggest a higher tip.
const GAS_EACH = parseEther(process.env.FAUCET_GAS_ETH ?? '0.002')
const COOLDOWN_MS = 5 * 60_000
const PER_HOUR = Number(process.env.FAUCET_PER_HOUR ?? 10) // all addresses together
let hour = []

export class FaucetError extends Error {}

export async function faucet({ address, eth = false }) {
  if (!treasury) throw new FaucetError('faucet is not configured')
  if (!isAddress(address)) throw new FaucetError('bad address')
  const who = getAddress(address)
  const last = db.faucet[who] ?? 0
  if (Date.now() - last < COOLDOWN_MS) throw new FaucetError('already sent recently, try again in a few minutes')
  hour = hour.filter((t) => Date.now() - t < 3_600_000)
  if (hour.length >= PER_HOUR) throw new FaucetError('the test faucet has handed out enough this hour, try again later')
  hour.push(Date.now())
  const out = {}
  const held = await client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [treasury.account.address] })
  if (held < USDC_EACH) throw new FaucetError(`the test faucet is empty (${formatUnits(held, 6)} USDC left)`)
  out.usdc = await treasury.writeContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'transfer', args: [who, USDC_EACH], ...(await fees()) })
  const value = eth === 'gas' ? GAS_EACH : ETH_EACH
  if (eth) out.eth = await treasury.sendTransaction({ to: who, value, ...(await fees()) })
  await Promise.all(Object.values(out).map((hash) => client.waitForTransactionReceipt({ hash, timeout: 120_000 })))
  db.faucet[who] = Date.now()
  save()
  return { ...out, usdc: formatUnits(USDC_EACH, 6), eth: eth ? formatUnits(value, 18) : '0', hashes: out }
}
