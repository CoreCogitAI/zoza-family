# Uniswap developer feedback

From building Zoza Family on Calibur and the Uniswap API, on Ethereum Sepolia.

## What worked well

- **Calibur is a good base for wallet features.** Per-key hooks with `beforeExecute(keyHash, to, value, data)` let us build a will as a plug-in on an audited, ownerless wallet, instead of writing our own 7702 delegate. A wallet can only delegate to one implementation, so features as hooks compose where separate delegates would compete.
- **Calibur's guard rails are the right defaults.** Non-admin keys cannot self-call, and `update` rejects a hook with no permission bits or no code. Both closed attack paths we would otherwise have had to block ourselves.
- **Relayed `SignedBatchedCall` with `executor = 0`** made gasless onboarding simple: the authorization and the first batch go in one type-4 transaction.
- **The Uniswap API on Sepolia** returns a ready `swapTransaction` for native-ETH input, with `output.minimumAmount`. We put that call straight into a Calibur batch with `approve` and `deposit`, so a gift is one signature and nothing happens if the minimum is not met. Routes came back through v4 pools.
- **The docs work well with agents:** `llms.txt` and the `.mdx` versions of each page.

## What slowed us down

1. **The Uniswap API on Base Sepolia (84532)** returned `UpstreamTimeoutError` on every quote we tried, for USDC/WETH and with `protocols: ["V3"]`, while Ethereum Sepolia and Base answered at once. Base Sepolia is listed as supported. We moved to Ethereum Sepolia.
2. **Deployment tables are incomplete.**
   - Calibur's table does not list Base Sepolia, but the contract is there at the same address (we checked the code size).
   - The Compact's table lists mainnet, Base and Unichain only, yet it is on Sepolia and Base Sepolia too.
   A note that deployments are deterministic and usually present on testnets would help.
3. **Calibur's EIP-712 domain is not spelled out.** The name, version and salt (prefix plus implementation) live in `eip712Domain()`. We read them on chain, from the implementation, to sign before an account is delegated. A short "signing a SignedBatchedCall" example in the docs would save time.
4. **Hook addresses need mining, as in v4, but no tool is mentioned.** We mined a CREATE2 salt in our deploy script so the low bits read `BEFORE_EXECUTE` only. A pointer to a miner, or a factory, would help.
5. **The Compact's forced withdrawal** (reset period at most 30 days) is easy to miss. It makes The Compact unsuitable for long locks such as an 18-year savings plan, which we first considered it for. A sentence on what resource locks are not meant for would help.
6. **`developer.uniswap.com` does not resolve.** People say it after workshops; the site is `developers.uniswap.org`.

## Ideas

- A reference Calibur hook for "guarded keys": a recovery or inheritance key that can only act after a time lock, with per-token limits. Many wallets need this.
- A Uniswap API option to send the swap output to another address, so a gift could land directly in a contract without a separate `approve`.
