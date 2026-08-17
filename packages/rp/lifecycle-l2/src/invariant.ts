/** Package invariant companion. @module @dsh-rp/lifecycle-l2/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-lifecycle-l2-invariant'
export const inject = ['invariants']
// No runtime invariant: Registry evidence and per-invocation authority are checked at every native boundary.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/lifecycle-l2', install),
)
