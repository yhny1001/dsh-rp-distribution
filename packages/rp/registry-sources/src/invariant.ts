/** Package invariant companion. @module @dsh-rp/registry-sources/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-registry-sources-invariant'
export const inject = ['invariants']
// No runtime invariant: registry ownership and source authority are validated at registration and acquisition boundaries.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/registry-sources', install),
)
