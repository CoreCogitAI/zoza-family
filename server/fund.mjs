// Buy Circle test USDC for the treasury with Sepolia ETH, through the Uniswap
// API (the same path family gifts use).   node fund.mjs 0.001
import { erc20Abi, formatUnits } from 'viem'
import { client, deployment, fees, treasury } from './config.mjs'
import { giftQuote } from './uniswap.mjs'

const eth = process.argv[2] ?? '0.001'
const me = treasury.account.address
const q = await giftQuote({ eth, swapper: me })
console.log(`quote: ${eth} ETH -> ${formatUnits(BigInt(q.amountOut), 6)} USDC (min ${formatUnits(BigInt(q.minOut), 6)}), route ${JSON.stringify(q.route)}`)
const hash = await treasury.sendTransaction({ to: q.swap.to, data: q.swap.data, value: BigInt(q.swap.value), ...(await fees()) })
const r = await client.waitForTransactionReceipt({ hash })
const bal = await client.readContract({ address: deployment.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [me] })
console.log(`${r.status} ${hash}\ntreasury now holds ${formatUnits(bal, 6)} USDC`)
