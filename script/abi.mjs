// Copies the ABIs the server and website need out of forge's build output.
import { readFileSync, writeFileSync } from 'node:fs'

const pick = (file, name) => JSON.parse(readFileSync(`out/${file}/${name}.json`, 'utf8')).abi
const abi = {
  will: pick('FamilyWill.sol', 'FamilyWill'),
  savings: pick('FamilySavings.sol', 'FamilySavings'),
  watcher: pick('FamilyWatcher.sol', 'FamilyWatcher'),
  calibur: pick('ICalibur.sol', 'ICalibur'),
  erc20: pick('IERC20.sol', 'IERC20'),
  comet: pick('IComet.sol', 'IComet'),
}
writeFileSync('shared/abi.json', JSON.stringify(abi, null, 1) + '\n')
console.log('wrote shared/abi.json:', Object.keys(abi).join(', '))
