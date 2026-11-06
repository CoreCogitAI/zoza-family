import { config } from '../chain.js'
import { Addr, Callout, Icon } from '../ui.jsx'

const Step = ({ n, title, children }) => (
  <div className="card step-card">
    <div className="step-num">{n}</div>
    <h3>{title}</h3>
    <p>{children}</p>
  </div>
)

export default function How() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">How it works</div>
          <h1>The wallet keeps the promises</h1>
          <p className="lede">
            Zoza Family writes three kinds of family promises into smart contracts. Zoza sends reminders and pays the fees. It never holds your keys and cannot move your money.
          </p>
        </div>
      </div>

      <section>
        <div className="section-head">
          <h2>A savings plan, step by step</h2>
        </div>
        <div className="grid g3 steps">
          <Step n="1" title="One signature">You choose the child, the monthly amount, the maturity and a nominee, and sign once. That signature sets an allowance for exactly the instalments until maturity, and creates the plan.</Step>
          <Step n="2" title="Collected each month">Once a month the plan collects one instalment. Anyone can trigger it, our watcher or a Chainlink CRE workflow, because the contract allows one instalment per period and never more.</Step>
          <Step n="3" title="A missed month is fine">If your wallet is short, the month is marked missed in the passbook. No penalty, nothing owed, and next month it tries again. You can top up or pause any time.</Step>
          <Step n="4" title="Optional interest">An earning plan supplies its USDC to Compound III. Each plan owns shares of what the contract holds there, so interest is split fairly between families.</Step>
          <Step n="5" title="The nominee protects">The nominee can point the plan to the child's new wallet and must agree before you close it early. They can never take the money.</Step>
          <Step n="6" title="Matures to the child">At maturity everything, interest included, is paid to the child's wallet. Locked money cannot go anywhere else first.</Step>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>The will, inside your wallet</h2>
          <p>Built on Uniswap's Calibur, an audited, ownerless smart wallet. Through EIP-7702 your normal address runs Calibur, with the same address and the same money.</p>
        </div>
        <div className="grid g2">
          <div className="card">
            <h3 style={{ marginBottom: 10 }}>What happens when you sign</h3>
            <ul className="promise-list">
              <li className="y"><Icon name="key" />Each heir gets a <b>key</b> on your wallet. Calibur lets extra keys sign for a wallet, and gives each key a <b>hook</b>: a contract asked before every call that key makes.</li>
              <li className="y"><Icon name="shield" />Every heir key carries the <b>FamilyWill</b> hook. While you are around it refuses everything.</li>
              <li className="y"><Icon name="heart" />Opening Zoza checks in for you. A claim can only open after the silence period with no check-in.</li>
              <li className="y"><Icon name="clock" />When a claim opens, you and your heirs are told. Tap “I'm here” in the cancel window and nothing happens.</li>
              <li className="y"><Icon name="coins" />After the window, each heir key may send <b>its own heir</b> up to <b>its own share</b> of each token in the will. Nothing else: no approvals, no other recipients, no changes to the wallet.</li>
            </ul>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Why it cannot be cheated</h3>
            <ul className="promise-list">
              <li className="n"><Icon name="x" />An heir key without the hook would be dangerous, so the will refuses to be written unless every heir key carries it and is not an admin key.</li>
              <li className="n"><Icon name="x" />Calibur itself stops non-admin keys from changing the wallet's keys or settings.</li>
              <li className="n"><Icon name="x" />Shares are of the balance when the first share is paid, so one heir going first cannot shrink another's share.</li>
              <li className="n"><Icon name="x" />A new will or a cancelled will makes every old heir key useless at once, even if it is still registered.</li>
              <li className="n"><Icon name="x" />The watcher and Zoza can only open the claim window, which you can cancel. They never sign for your wallet.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Who does what</h2>
        </div>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Who</th>
                <th>Can</th>
                <th>Cannot</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><b>Parent</b></td><td>Start plans, top up, pause, write or change the will, check in</td><td>Take locked savings back without the nominee</td></tr>
              <tr><td><b>Child</b></td><td>Receive the plan at maturity</td><td>Take it early</td></tr>
              <tr><td><b>Nominee</b></td><td>Point the plan to the child's new wallet, agree to an early close, add gifts</td><td>Take any of the money</td></tr>
              <tr><td><b>Heir</b></td><td>After silence and the cancel window, take their own share</td><td>Act early, take more, or pay anyone else</td></tr>
              <tr><td><b>Family</b></td><td>Gift in ETH; Uniswap swaps it to USDC inside the plan</td><td>Withdraw</td></tr>
              <tr><td><b>Watcher</b> (Chainlink CRE)</td><td>Collect due instalments, open claims after silence, pay matured plans</td><td>Collect twice, open a claim early, or move money anywhere else</td></tr>
              <tr><td><b>Relayer</b> (Zoza)</td><td>Pay the gas for batches you signed</td><td>Change what you signed</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>The contracts</h2>
          <p>Deployed on Ethereum Sepolia. Read them on Etherscan; every rule above is in this code.</p>
        </div>
        <div className="card">
          <dl className="kv">
            <dt>FamilyWill (Calibur hook)</dt>
            <dd><Addr address={config.will} full /></dd>
            <dt>FamilySavings</dt>
            <dd><Addr address={config.savings} full /></dd>
            <dt>FamilyWatcher (CRE receiver)</dt>
            <dd><Addr address={config.watcher} full /></dd>
            <dt>Calibur (Uniswap)</dt>
            <dd><Addr address={config.calibur} full /></dd>
            <dt>Compound III USDC</dt>
            <dd><Addr address={config.comet} full /></dd>
            <dt>USDC (Circle, test)</dt>
            <dd><Addr address={config.usdc} full /></dd>
            <dt>Universal Router (Uniswap)</dt>
            <dd><Addr address={config.universalRouter} full /></dd>
          </dl>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Honest limits</h2>
        </div>
        <div className="stack-sm">
          <Callout tone="warn">This is a test network with test money. The contracts have tests but no audit.</Callout>
          <Callout tone="info">Zoza Family is not a bank deposit, a recurring deposit or insurance, and it is not legal advice. A will on chain does not replace a legal will, and inheritance law still applies.</Callout>
          <Callout tone="info">Plans hold US dollars (USDC). Amounts in your own currency are estimates at today's exchange rate, which our server fetches so your browser never contacts a rate provider. Interest from Compound is variable, and lending carries smart-contract risk.</Callout>
          <Callout tone="info">The will covers what is in the wallet when a share is first paid. Anything you spend before then is yours to spend.</Callout>
        </div>
      </section>
    </>
  )
}
