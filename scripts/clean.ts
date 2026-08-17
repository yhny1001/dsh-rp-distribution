/** Remove generated output owned by RP packages. */

import { globSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

for (const directory of globSync('packages/rp/*/lib')) {
  rmSync(resolve(directory), { recursive: true, force: true })
}
