/** Run publint against every built RP package. */

import { globSync } from 'node:fs'
import { execaSync } from 'execa'

for (const manifest of globSync('packages/rp/*/package.json').sort()) {
  const directory = manifest.slice(0, -'/package.json'.length)
  execaSync('publint', [directory], { stdio: 'inherit', preferLocal: true })
}
