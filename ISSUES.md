# Issues

Work still to build, roughly in order.

1. **Run the watcher on Chainlink CRE by default.** The workflow in `cre/` simulates against Sepolia with the MockKeystoneForwarder. Deploy it, point FamilyWatcher at the production KeystoneForwarder, check the workflow ID and owner in `onReport`, and run the server with `WATCHER=cre`.
2. **Keys in the phone, not the browser.** The demo makes each person's key in the browser. In the Zoza app the key should live in secure hardware, as a Calibur WebAuthn/P-256 key, with the browser keys removed.
3. **Anon-RPC in the mobile app.** The browser harness covers the website. The Zoza app needs a native harness, or a sandboxed web view bridge, so its reads are private too.
4. **Real notifications.** Messages go to an in-app inbox. Add email and SMS for claims and missed instalments, through the CRE workflow's HTTP capability, without storing more than an address-to-contact mapping.
5. **Plans in more than one token.** Plans hold USDC. Add a rupee stablecoin when one exists on chain, and show rupee values from a price feed instead of a fixed rate.
6. **Life-event goals.** Release on "2 of 3 guardians confirm the wedding" as well as on a date, with guardian signatures checked by FamilySavings.
7. **A locked-forever option.** Today an early close needs the nominee and the parent. Offer a plan that nobody can close early.
8. **Relayer limits.** The relayer is rate-limited per account but pays for any valid batch. Add per-family gas budgets, or move sponsorship to a paymaster with stake.
9. **Will covering more assets.** Wills list USDC and ETH. Support any ERC-20 the owner holds, and NFTs.
10. **Agent keys that stop when the owner goes silent.** The same hook can guard a key for an AI agent: a daily limit, listed tokens and recipients, and no power once the owner stops checking in.
11. **Nominee actions by signature.** Today the nominee sends their own transaction. Accept an EIP-712 signature instead, so a nominee using any wallet acts without gas.
12. **Security review** of FamilyWill and FamilySavings before any real money.
