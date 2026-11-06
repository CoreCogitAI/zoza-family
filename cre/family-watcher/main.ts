// Zoza Family watcher on Chainlink CRE. Every minute it reads plans and wills,
// sends one report to FamilyWatcher (collect, openClaim, release), and tells
// the families. Every action is permissionless, so nothing here is trusted.
import {
  bytesToHex,
  consensusIdenticalAggregation,
  CronCapability,
  encodeCallMsg,
  EVMClient,
  getNetwork,
  handler,
  hexToBase64,
  HTTPClient,
  LATEST_BLOCK_NUMBER,
  ok,
  Runner,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk"
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, zeroAddress, type Address, type Hex } from "viem"

type Config = {
  schedule: string
  chainName: string
  savings: Address
  will: Address
  watcher: Address
  notifyUrl: string
  ownersUrl: string
  gasLimit: string
}

const SAVINGS = parseAbi([
  "function planCount() view returns (uint256)",
  "function canCollect(uint256 id) view returns (bool)",
  "function planOf(uint256 id) view returns ((address parent, address child, address nominee, uint128 instalment, uint32 period, bool earn, bool mandateOn, bool closed, bool nomineeAgreesToClose, uint64 nextDue, uint64 maturity, uint64 createdAt, uint64 nomineeSince, uint32 paidCount, uint32 missedCount, uint256 units, uint256 paidIn, string name))",
])
const WILL = parseAbi([
  "function stateOf(address owner) view returns (uint8)",
  "function willOf(address owner) view returns ((uint64 version, uint64 lastSeen, uint64 claimOpenedAt, uint32 silence, uint32 window, address[] heirs, uint16[] shares, address[] tokens))",
])
const SILENT = 2

function reader(runtime: Runtime<Config>, evm: EVMClient) {
  return <T>(to: Address, abi: any, functionName: string, args: unknown[] = []): T => {
    const data = encodeFunctionData({ abi, functionName, args } as any)
    const res = evm.callContract(runtime, { call: encodeCallMsg({ from: zeroAddress, to, data }), blockNumber: LATEST_BLOCK_NUMBER }).result()
    return decodeFunctionResult({ abi, functionName, data: bytesToHex(res.data) } as any) as T
  }
}

// Owners with a will, as the server has seen them.
const fetchOwners = (node: NodeRuntime<Config>): string => {
  const res = new HTTPClient().sendRequest(node, { url: node.config.ownersUrl, method: "GET" }).result()
  if (!ok(res)) return "[]"
  return new TextDecoder().decode(res.body)
}

const notify = (token: string, to: string[], title: string, body: string) => (node: NodeRuntime<Config>): number => {
  const payload = new TextEncoder().encode(JSON.stringify({ to, title, body, kind: "will" }))
  const res = new HTTPClient()
    .sendRequest(node, {
      url: node.config.notifyUrl,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: Buffer.from(payload).toString("base64"),
      cacheSettings: { store: true, maxAge: "60s" },
    })
    .result()
  return res.statusCode
}

const onTick = (runtime: Runtime<Config>): string => {
  const c = runtime.config
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: c.chainName })
  if (!network) throw new Error(`unknown chain ${c.chainName}`)
  const evm = new EVMClient(network.chainSelector.selector)
  const read = reader(runtime, evm)
  const now = BigInt(Math.floor(runtime.now().getTime() / 1000))

  // Plans: due instalments and matured plans.
  const collect: bigint[] = []
  const release: bigint[] = []
  const count = read<bigint>(c.savings, SAVINGS, "planCount")
  for (let id = 0n; id < count; id++) {
    const p = read<any>(c.savings, SAVINGS, "planOf", [id])
    if (p.closed) continue
    if (now >= p.maturity) release.push(id)
    else if (read<boolean>(c.savings, SAVINGS, "canCollect", [id])) collect.push(id)
  }

  // Wills: owners silent long enough for a claim to open.
  const owners = JSON.parse(runtime.runInNodeMode(fetchOwners, consensusIdenticalAggregation<string>())().result()) as Address[]
  const open: Address[] = []
  for (const o of owners) {
    if (Number(read<number>(c.will, WILL, "stateOf", [o])) === SILENT) open.push(o)
  }

  runtime.log(`due: collect ${collect.length}, open claims ${open.length}, release ${release.length}`)
  if (!collect.length && !open.length && !release.length) return "nothing due"

  const report = encodeAbiParameters(parseAbiParameters("uint256[] collect, address[] openClaim, uint256[] release"), [collect, open, release])
  const signed = runtime.report({ encodedPayload: hexToBase64(report), encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" }).result()
  const write = evm.writeReport(runtime, { receiver: c.watcher, report: signed, gasConfig: { gasLimit: c.gasLimit } }).result()
  const tx = bytesToHex(write.txHash ?? new Uint8Array(32)) as Hex
  runtime.log(`report sent: https://sepolia.etherscan.io/tx/${tx}`)

  // Tell each family whose will just opened a claim.
  const token = open.length ? runtime.getSecret({ id: "NOTIFY_TOKEN" }).result().value : ""
  for (const o of open) {
    const w = read<any>(c.will, WILL, "willOf", [o])
    const to = [o, ...w.heirs]
    runtime.runInNodeMode(
      notify(token, to, "A claim has opened", "The owner has not checked in for a while. If they do not respond in the cancel window, each heir's share unlocks."),
      consensusIdenticalAggregation<number>(),
    )().result()
  }
  return `collected ${collect.length}, opened ${open.length}, released ${release.length}, tx ${tx}`
}

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onTick)]

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
