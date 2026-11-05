// Uniswap API quotes for ETH gifts. The giver signs one batch: the swap, then
// approve and deposit the quoted minimum into the plan.
import { getAddress, isAddress, parseEther } from 'viem'
import { CHAIN_ID, deployment, UNIVERSAL_ROUTER } from './config.mjs'

const API = process.env.UNISWAP_API_URL ?? 'https://trade-api.gateway.uniswap.org/v1'
const ETH = '0x0000000000000000000000000000000000000000'

export class QuoteError extends Error {}

export async function giftQuote({ eth, swapper, slippage = 2 }) {
  if (!process.env.UNISWAP_API_KEY) throw new QuoteError('Uniswap API key is not configured')
  if (!isAddress(swapper)) throw new QuoteError('bad swapper')
  const amount = parseEther(String(eth))
  if (amount <= 0n || amount > parseEther('0.05')) throw new QuoteError('gift between 0 and 0.05 ETH')

  let res, body
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${API}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.UNISWAP_API_KEY },
      body: JSON.stringify({
        type: 'EXACT_INPUT',
        amount: amount.toString(),
        tokenInChainId: CHAIN_ID,
        tokenOutChainId: CHAIN_ID,
        tokenIn: ETH,
        tokenOut: deployment.usdc,
        swapper: getAddress(swapper),
        slippageTolerance: slippage,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    body = await res.json().catch(() => ({}))
    if (res.ok || body?.errorCode !== 'UpstreamTimeoutError') break
  }
  if (!res.ok) throw new QuoteError(body?.detail ?? body?.errorCode ?? `Uniswap API ${res.status}`)
  const q = body.quote
  const tx = body.swapTransaction
  if (!tx || getAddress(tx.to) !== getAddress(UNIVERSAL_ROUTER)) throw new QuoteError('unexpected swap target')
  return {
    amountIn: amount.toString(),
    amountOut: q.output.amount,
    minOut: q.output.minimumAmount ?? q.aggregatedOutputs?.[0]?.minAmount,
    routing: body.routing,
    route: (q.route ?? []).map((leg) => leg.map((p) => ({ type: p.type, fee: p.fee }))),
    priceImpact: q.priceImpact,
    requestId: body.requestId,
    swap: { to: getAddress(tx.to), data: tx.data, value: BigInt(tx.value).toString() },
  }
}
