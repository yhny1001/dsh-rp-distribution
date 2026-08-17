/** Package invariant companion. @module @dsh-rp/lifecycle-common/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-lifecycle-common-invariant'
export const inject = ['invariants']
// No runtime invariant: preparation and activation validate their complete graph at every boundary.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/lifecycle-common', install),
)
