# Zoza Family

Savings plans for your children, a nominee, and a will that only opens if you go silent, all inside your own wallet.

Families in India save for a child's studies or wedding every month: recurring deposits, child plans, a nominee on every form. Zoza Family keeps that habit and removes the middleman:

- **Savings plans.** A fixed amount is collected each month from the parent's wallet, capped by the contract at one instalment per period. Money paid in is locked until maturity, then goes to the child. Plans can optionally earn Compound III's variable supply rate.
- **A nominee.** The nominee guards the plan. They can point it to the child's new wallet, and must agree before the parent ends it early. They can never take the money.
- **Plans that change with life,** as at a bank. The parent can change the nominee, change the monthly amount, or extend the maturity (only later). With the nominee's agreement, the parent can end a plan early, either paying the child now (for fees that cannot wait) or taking the money back. No penalty.
- **A will in the wallet.** Each heir gets a key on the parent's wallet that does nothing while the parent is around. After a silence period with no check-in, and a cancel window nobody uses, each heir can send only their own share to only their own wallet. A MetaMask or other connected wallet can't take Calibur keys, so its will works through a USDC allowance instead: after the same quiet period and notice period, each heir pulls only their own share. The site reminds the owner to check in before the quiet period ends, and says plainly that this works alongside a legal will, not instead of one.
- **Gifts from family.** A grandparent pays in ETH. The Uniswap API swaps it to USDC inside the same signed batch, and the plan receives at least the quoted minimum.
- **Family joins with their own wallets.** The parent sends an invite link. The heir, child or nominee opens it and accepts by signing with MetaMask or any browser wallet, or makes a wallet there. Plans and wills only name addresses whose owners signed. An heir with MetaMask claims their share gaslessly. Anyone can also connect a wallet from the person menu to save into plans or give gifts, paying their own small gas. Writing a will needs the Zoza wallet.
- **Private by default.** Every blockchain read the website makes, and every call to its own server, goes through Anon-RPC. Writes are signed in the browser and sent by a relayer, so families never need ETH for gas.

It runs on Ethereum Sepolia with test money. It is not a bank deposit, a recurring deposit, insurance or legal advice.

## Run it

Requirements: Node 24, Foundry, Google Chrome (or any modern browser), and a `.env` with four values (see `.env.example`).

```sh
./run.sh            # build the website, start the server: http://127.0.0.1:8790
./run.sh test       # 51 contract tests on a Sepolia fork against the real Calibur and Compound
./run.sh e2e        # live end-to-end checks against the running server
./run.sh --stop
```

The website starts signed out. Sign in with a browser wallet (any EIP-6963 wallet, such as MetaMask), make a wallet in the browser, or try the demo family: Priya, a parent; Meera (daughter), Arjun (son), Ravi (uncle, nominee) and Dada (grandfather), five test wallets you can switch between at the top right. "Get test money" on the family page sends test USDC (and a little ETH for gifts and for browser wallets' gas). With demo timing on, a month passes in a minute, so a plan can mature while you watch.

## How it works

```
Parent's EOA ──EIP-7702──> Uniswap Calibur (same address, same money)
   │  keys: Arjun, Meera ── hook: FamilyWill   (blocks everything until silence + cancel window)
   │
   ├─ approve(FamilySavings, instalment × months)     the mandate
   └─ FamilySavings.createPlan(child, nominee, ...)   the plan

Watcher (the Chainlink CRE workflow, or the hosted server's watcher) ── every minute, anyone may call:
   collect(id)       one instalment per period, or "missed" if the wallet is short
   openClaim(owner)  only after the silence period
   release(id)       only at maturity, only to the child
```

The first thing a family member signs upgrades their own address to Calibur through EIP-7702. The relayer sends that authorization and the first batch in one type-4 transaction, and pays the gas.

## Where each technology is used

**Uniswap.**

| What | Where |
|---|---|
| Calibur, Uniswap's EIP-7702 smart wallet: every family wallet delegates to it | [shared/calibur.mjs](shared/calibur.mjs), [server/relay.mjs#L98](server/relay.mjs#L98) |
| A Calibur execution hook (`beforeExecute`) guarding heir keys | [src/FamilyWill.sol#L199](src/FamilyWill.sol#L199) |
| A will for wallets without Calibur: heirs pull their share through an allowance | [src/FamilyWill.sol#L230](src/FamilyWill.sol#L230) |
| The will refuses heir keys that lack the hook, or are admin keys | [src/FamilyWill.sol#L136](src/FamilyWill.sol#L136) |
| Hook address mined for Calibur's permission bits (BEFORE_EXECUTE only) | [script/Deploy.s.sol](script/Deploy.s.sol) |
| Calibur `SignedBatchedCall` signing (EIP-712, salted domain) | [shared/calibur.mjs#L97](shared/calibur.mjs#L97) |
| Uniswap API quotes for gifts (routes through v4 pools on Sepolia) | [server/uniswap.mjs#L11](server/uniswap.mjs#L11) |
| The Universal Router call from the API, batched with approve + deposit | [web/src/pages/Gift.jsx#L49](web/src/pages/Gift.jsx#L49) |
| Fork tests against the deployed Calibur | [test/FamilyWill.t.sol](test/FamilyWill.t.sol), [test/FamilyWillAllowance.t.sol](test/FamilyWillAllowance.t.sol) |

**Anon-RPC.** The website builds viem's client on an EIP-1193 provider backed by `AnonRpcWorker` ([web/src/anon.js#L112](web/src/anon.js#L112), [web/src/chain.js#L25](web/src/chain.js#L25)). The Nox mixnet is the default (its specifier is on Sepolia); Tor and Nym can be chosen on the Privacy page. Reads are batched with multicall, so one private request carries a whole screen.

Calls to the Zoza Family server (relaying signed batches, the inbox, invites, gift quotes, the test faucet) go through the same worker with `serverFetch` ([web/src/anon.js#L189](web/src/anon.js#L189)), so the server and its host see the mixnet's exit node, not the browser's IP. When Nox briefly has no exit node, reads are retried, and a server call is retried only if it never left the browser, so a signed batch is never sent twice. Each call carries an `isolationKey` for the person making it (anon-rpc §9.3). In our tests Nox rotated exit nodes the same way with or without a key, so for now it is a request that other networks may honour.

Traffic that does not go through Anon-RPC, by design:
- loading the page itself and `/api/config`, which carry no family data;
- the bootstrap read of the specifier contract, once per page load (anon-rpc §4);
- server calls when the site runs on localhost, because an exit node cannot reach it;
- a connected wallet's own transactions and reads, which go to that wallet's RPC. Only the wallet can change that.

The server sees the IP that loaded the page, so with few visitors the timing of later calls could link them to it. The Privacy page shows the share of reads and server calls sent privately during the visit, and the average latency.

**Chainlink CRE.** [cre/family-watcher/main.ts](cre/family-watcher/main.ts) runs every minute. It reads plans and wills with the EVM client, gets the list of will owners from the server over HTTP, and sends one signed report to [src/FamilyWatcher.sol#L34](src/FamilyWatcher.sol#L34). That report collects due instalments, opens claims and releases matured plans. Then it posts a message to each affected family through the server's API, with the server's `NOTIFY_TOKEN` read as a CRE secret ([cre/secrets.yaml](cre/secrets.yaml)). Every action in the report is one anyone could call, so a wrong report changes nothing. To simulate it:

```sh
curl -sSL https://app.chain.link/cre/install.sh | bash     # the CRE CLI
cre login
cd cre/family-watcher && bun install && cd ..
cp .env.example .env    # CRE_ETH_PRIVATE_KEY: a funded Sepolia test key; NOTIFY_TOKEN_ALL: the server's NOTIFY_TOKEN
cre workflow simulate family-watcher --target staging-settings --broadcast
```

**What runs where today.** The CRE workflow is built and runs with `cre workflow simulate --broadcast` against the live Sepolia contracts and the live site (`https://eth.zoza.world/api/owners` and `/api/notify`). It is not deployed to the CRE network yet, and FamilyWatcher still trusts the MockKeystoneForwarder (see [ISSUES.md](ISSUES.md)). So the hosted site at eth.zoza.world runs with `WATCHER=server`: its own watcher sends the same three permissionless calls with `KEEPER_KEY`, and you can check this at `/api/watcher`. With `WATCHER=cre` the server only observes and notifies, and CRE submits the report.

**Compound III.** Earning plans supply USDC to the Sepolia USDC market ([src/FamilySavings.sol#L290](src/FamilySavings.sol#L290)) and withdraw straight to the child at maturity ([#L306](src/FamilySavings.sol#L306)). Each plan owns shares of the contract's Compound balance, with a virtual offset against donation attacks ([#L314](src/FamilySavings.sol#L314)).

## Contracts (Ethereum Sepolia)

| Contract | Address |
|---|---|
| FamilyWill (Calibur hook, or allowance for other wallets) | [0xd65f7aF469cE8352c23a91Ea0989819C9b1AA008](https://sepolia.etherscan.io/address/0xd65f7aF469cE8352c23a91Ea0989819C9b1AA008) |
| FamilySavings | [0x399146CEA8Bd31776f013f10817a79284767d6f8](https://sepolia.etherscan.io/address/0x399146CEA8Bd31776f013f10817a79284767d6f8) |
| FamilyWatcher (CRE receiver, MockKeystoneForwarder) | [0x3599f1f08e7cb09d1D40f70CB312a4B8546325dF](https://sepolia.etherscan.io/address/0x3599f1f08e7cb09d1D40f70CB312a4B8546325dF) |
| Calibur v1.1.0 (Uniswap) | [0x000000005c84F8Fd50b21CAC312528A64437030e](https://sepolia.etherscan.io/address/0x000000005c84F8Fd50b21CAC312528A64437030e) |
| Compound III USDC market | [0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e](https://sepolia.etherscan.io/address/0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e) |
| USDC (Circle, test) | [0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) |

## What is tested

- **Contracts:** 64 Foundry tests on a Sepolia fork, against the deployed Calibur, Compound III and Circle USDC. They cover heirs acting early, taking more than a share, paying someone else, using unlisted tokens, calling anything but `transfer`, changing the wallet's keys, revoked and replaced wills, missed instalments, one pull per period, allowance caps, nominee rights, changing the nominee, amount and maturity, paying the child early, donation attacks and fair interest between plans.
- **Live, end to end** ([server/e2e.mjs](server/e2e.mjs)): a fresh family each run, through the real server and Sepolia. One gasless transaction delegates the parent to Calibur, writes her will and opens a plan. The relayer refuses outside calls. The watcher collects. The parent tops up and the monthly mandate is left intact. A grandparent's ETH gift goes through the Uniswap API into the plan. A claim opens after silence and is cancelled by "I'm here". Heirs are refused early, over their share and to someone else, then each takes their exact share. The nominee moves the plan to a new wallet, and the plan matures to it.
- **In the browser:** the same flows driven through the website in headless Chrome, signing in the page.

## Security notes

- The relayer pays only for batches that touch Zoza Family's contracts, the plan token (approve to FamilySavings, transfer) or Uniswap's Universal Router. It never adds admin keys, and only adds keys with the FamilyWill hook. It only accepts EIP-7702 authorizations to Calibur, signed by the account itself. It simulates each batch before paying, with a 30% gas margin, and waits for the wallet to show Calibur code.
- The relayer and the test faucet are limited per account and per hour overall (`RELAY_PER_HOUR`, `FAUCET_PER_HOUR`). A public server must set `NOTIFY_TOKEN`, or anyone could post messages into family inboxes.
- Inboxes and family lists hold names and relationships the chain does not show. The server only returns them to a browser that signed a read pass for that address (valid 7 days). Invite codes are shown only to their sender.
- Changing the nominee drops any agreement to end early, makes ending early wait one period, and tells the old nominee, the new nominee and the child. It is a delay and a notice, not a veto: a parent who replaces the nominee can end the plan early after that period. The parent can also point the plan to another wallet as the child, as the nominee can.
- `approve` replaces an allowance, so the website always approves the existing allowance plus the new amount. A top-up, a gift or a second plan never cancels another plan's mandate.
- The watcher and the relayer cannot move money. The watcher's actions are permissionless, and each contract checks its own timing and amounts.
- A will's shares are of the balance when the first share of each token is paid (for an allowance will, the smaller of the balance and the allowance). The parent can spend freely before that.
- The Compact (Uniswap) was considered for locking savings, but its owner can always force-withdraw after the reset period (at most 30 days), which does not fit an 18-year promise. Plans therefore lock in FamilySavings itself.
- Not audited. Test money only.
- Automation: the code defaults to `WATCHER=cre`, where CRE submits reports through `FamilyWatcher` and the server only observes and notifies. The hosted site uses `WATCHER=server` until the workflow is deployed to CRE; that mode uses `KEEPER_KEY`. Every action is permissionless either way.

## Layout

```
src/            FamilyWill (Calibur hook), FamilySavings, FamilyWatcher, interfaces
test/           Foundry fork tests (Sepolia)
script/         Deploy (mines the hook address), ABI export
shared/         Calibur signing, error decoding, ABIs (server and website)
server/         relayer, watcher, Uniswap API quotes, inbox, faucet, e2e
web/            the website (React, viem, Anon-RPC)
cre/            the Chainlink CRE workflow
```

## How this was built

Shaik Sajid (CoreCogitAI) built Zoza Family with Claude Code (Anthropic) as an AI pair programmer. Claude Code read and analysed the new protocols the project builds on (Uniswap's Calibur and the Uniswap API, the Ethereum Foundation's Anon-RPC, and Chainlink CRE) and wrote the code that uses them: the contracts and tests ([src/](src/), [test/](test/)), the server ([server/](server/), [shared/](shared/)), the website ([web/](web/)), the Chainlink CRE workflow ([cre/](cre/)) and drafts of these docs. Every commit is co-authored with Claude and says so.

The team decided what to build and checked that it worked:

- The product: a will inside the parent's own wallet, monthly savings for a child's studies or wedding, a nominee, and optional interest, from how Indian families already save.
- The technology: Uniswap's Calibur and the Uniswap API, Anon-RPC and Chainlink CRE.
- Features chosen by comparing with banks: changing the nominee, the monthly amount and the maturity, and paying the child early.
- Live testing of the public site, which found issues that were then fixed: family invites and inboxes readable by anyone, example amounts that looked real, and new visitors shown as the demo parent.
- Test wallets, Sepolia ETH, the Uniswap API key and the public test site.

## License

MIT

For small startups, the same wallet stack also has a separate `Startup` page for USDC payment limits, configured approvers, maker-checker proposals, and CSV audit export. Family savings and wills remain unchanged; startup controls are not on-chain execution hooks or custody software.
