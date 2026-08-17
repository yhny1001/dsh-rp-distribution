/** Package invariant companion. @module @dsh-rp/lifecycle-l1/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-lifecycle-l1-invariant'
export const inject = ['invariants']
// No runtime invariant: package preparation and sandbox backends enforce evidence, authority, and bounds per call.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/lifecycle-l1', install),
)
