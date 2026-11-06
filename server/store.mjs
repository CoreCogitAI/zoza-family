// A small JSON file: notifications, what the watcher has already seen, and
// who got test money. Nothing here is needed to move funds.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './config.mjs'

const dir = process.env.DATA_DIR ?? join(root, 'server', 'data')
const file = join(dir, 'state.json')
mkdirSync(dir, { recursive: true })

const empty = () => ({ inbox: {}, seen: { plans: {}, wills: {} }, owners: [], faucet: {}, invites: {}, scannedTo: null, startupPolicies: {}, startupProposals: [], startupAudit: [] })
export const db = existsSync(file) ? { ...empty(), ...JSON.parse(readFileSync(file, 'utf8')) } : empty()

let pending
export function save() {
  clearTimeout(pending)
  pending = setTimeout(() => {
    writeFileSync(file + '.tmp', JSON.stringify(db, null, 1))
    renameSync(file + '.tmp', file)
  }, 50)
}

/// Add a message to each address's inbox.
export function notify(to, msg) {
  const at = Date.now()
  for (const who of new Set(to.map((a) => a.toLowerCase()))) {
    const box = (db.inbox[who] ??= [])
    box.unshift({ id: `${at}-${Math.random().toString(36).slice(2, 8)}`, at, ...msg })
    box.length = Math.min(box.length, 100)
  }
  save()
}
