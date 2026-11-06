import { family } from '../family.js'
import { useApp } from '../main.jsx'
import { Face, Icon } from '../ui.jsx'

const Line = ({ ico, cls, what, sub, amt, missed }) => (
  <div className="pb-line">
    <div className="what">
      <span className={`pb-ico ${cls}`}>
        <Icon name={ico} />
      </span>
      <span>
        {what}
        <small>{sub}</small>
      </span>
    </div>
    <span className={`amt ${missed ? 'missed' : ''}`}>{amt}</span>
  </div>
)

export default function Home() {
  const { setMe } = useApp()
  const startAs = (id, path) => {
    setMe(id)
    location.hash = path
  }
  return (
    <>
      <section className="fam-hero">
        <div>
          <div className="eyebrow">Zoza Family</div>
          <h1>
            Your family's future, <em>in your own wallet.</em>
          </h1>
          <p className="lede">
            Save every month for your child's studies or wedding. Name a nominee. Write a will that only opens if you go silent. No bank, no lawyer and no company ever holds your money.
          </p>
          <div className="row hero-cta" style={{ marginTop: 28 }}>
            <button className="btn primary large" onClick={() => startAs('priya', '/plan/new')}>
              Start a savings plan <Icon name="arrow" />
            </button>
            <a className="btn large" href="#/how">
              How it works
            </a>
          </div>
          <div className="family-row">
            {family.map((p) => (
              <Face key={p.id} person={p} />
            ))}
            <span className="txt">Try it as Priya, her children Meera and Arjun, uncle Ravi or Dada. Switch at the top right.</span>
          </div>
        </div>

        <div className="passbook" aria-label="Example passbook">
          <div className="pb-top">
            <div className="between">
              <div className="row" style={{ gap: 10 }}>
                <Face person={family[1]} />
                <div>
                  <b>Meera's studies</b>
                  <div className="tiny muted">Matures on her 18th birthday · Nominee: Ravi</div>
                </div>
              </div>
              <span className="badge ok">Earning 4.1%</span>
            </div>
            <div className="big">
              ₹1,24,380<small>≈ 1,413.40 USDC</small>
            </div>
          </div>
          <div className="pb-lines">
            <Line ico="piggy" cls="inst" what="Monthly instalment" sub="From Priya's wallet · 5 Mar" amt="+ ₹2,000" />
            <Line ico="gift" cls="gift" what="Birthday gift from Dada" sub="Paid in ETH, swapped by Uniswap · 2 Mar" amt="+ ₹5,000" />
            <Line ico="warn" cls="miss" what="Instalment missed" sub="Wallet was short · no penalty · 5 Feb" amt="Missed" missed />
            <Line ico="trend" cls="top" what="Interest this year" sub="Compound III, variable" amt="+ ₹4,912" />
          </div>
          <div className="pb-foot">
            <span>
              <Icon name="shield" /> Locked until maturity. Nobody can move it early.
            </span>
            <span>Example</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Three promises, kept by your wallet</h2>
          <p>Each one is a rule written into the blockchain. Zoza runs the reminders and pays the fees, but it can never move your money or bend the rules.</p>
        </div>
        <div className="grid g3">
          <div className="promise tone-teal">
            <span className="ico">
              <Icon name="cap" />
            </span>
            <div className="tag">For my child</div>
            <h3>Savings plans</h3>
            <p>A fixed amount every month, like a recurring deposit, until your child turns 18 or gets married.</p>
            <ul>
              <li><Icon name="check" />Collected automatically, never more than you set</li>
              <li><Icon name="check" />Optional interest from Compound</li>
              <li><Icon name="check" />Paid to your child at maturity</li>
            </ul>
            <button className="more linkish" onClick={() => startAs('priya', '/plan/new')}>
              Start a plan <Icon name="arrow" />
            </button>
          </div>
          <div className="promise tone-indigo">
            <span className="ico">
              <Icon name="scroll" />
            </span>
            <div className="tag">When I'm gone</div>
            <h3>A will in your wallet</h3>
            <p>Your money stays yours. Only if you go silent for a set time, and nobody cancels, can each heir take their share.</p>
            <ul>
              <li><Icon name="check" />The app checks in for you when you open it</li>
              <li><Icon name="check" />A cancel window if it was a false alarm</li>
              <li><Icon name="check" />Each heir can only take their own share</li>
            </ul>
            <button className="more linkish" onClick={() => startAs('priya', '/will/edit')}>
              Write a will <Icon name="arrow" />
            </button>
          </div>
          <div className="promise tone-rose">
            <span className="ico">
              <Icon name="gift" />
            </span>
            <div className="tag">From family</div>
            <h3>Gifts that grow</h3>
            <p>Grandparents can add to a child's plan from a link, in ETH. Uniswap turns it into dollars inside the plan.</p>
            <ul>
              <li><Icon name="check" />One signature, no gas to pay</li>
              <li><Icon name="check" />Locked for the child like the rest</li>
              <li><Icon name="check" />Shows up in the passbook</li>
            </ul>
            <a className="more" href="#/how">
              See how gifts work <Icon name="arrow" />
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Like the plans you know, but yours</h2>
          <p>Families in India already save this way. The difference is who holds the money and who decides.</p>
        </div>
        <div className="card table-wrap">
          <table className="compare">
            <thead>
              <tr>
                <th></th>
                <th>Bank deposit or child plan</th>
                <th>Zoza Family</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Who holds the money</td><td className="no">The bank or insurer</td><td className="yes">Your own wallet, then a contract only the rules can open</td></tr>
              <tr><td>Monthly saving</td><td className="no">Standing instruction or auto-debit</td><td className="yes">A mandate capped by the contract: one instalment a month</td></tr>
              <tr><td>Nominee</td><td className="no">Forms, and a claim process after a death</td><td className="yes">Written into the plan; they can protect it, not take it</td></tr>
              <tr><td>If you pass away</td><td className="no">Certificates, branch visits, months</td><td className="yes">Your will opens after silence and a cancel window</td></tr>
              <tr><td>Interest</td><td className="no">Fixed, in rupees, with deposit insurance</td><td>Variable, in dollars, from Compound; no insurance. Or no interest at all</td></tr>
              <tr><td>If the company shuts down</td><td className="no">Depends on the institution</td><td className="yes">The contracts keep working without Zoza</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Built on open infrastructure</h2>
          <p>Each piece does one job, and every rule can be read on chain.</p>
        </div>
        <div className="built">
          <div className="card">
            <div className="who-built">Uniswap</div>
            <h3>Calibur wallet and the Uniswap API</h3>
            <p>Your address becomes a Calibur smart wallet through EIP-7702. Heir keys carry our hook. Gifts swap through the Uniswap API on v4 pools.</p>
          </div>
          <div className="card">
            <div className="who-built">Ethereum Foundation</div>
            <h3>Anon-RPC</h3>
            <p>Every read goes through a mixnet, so no RPC provider can tie your IP address to your family's wallets.</p>
          </div>
          <div className="card">
            <div className="who-built">Chainlink</div>
            <h3>CRE workflow</h3>
            <p>Collects instalments, opens claims after silence and releases matured plans, without being trusted with anything.</p>
          </div>
          <div className="card">
            <div className="who-built">Compound</div>
            <h3>Compound III</h3>
            <p>Plans that earn supply USDC to Compound and take back their share, interest included, at maturity.</p>
          </div>
        </div>
      </section>
    </>
  )
}
