/** Package invariant companion. @module @dsh-rp/lifecycle-l0/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-lifecycle-l0-invariant'
export const inject = ['invariants']
// No runtime invariant: Registry preparation and the deterministic router validate every activation and call.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/lifecycle-l0', install),
)
