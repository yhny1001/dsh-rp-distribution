/** Package invariant companion. @module @dsh-rp/registry-server/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-registry-server-invariant'
export const inject = ['invariants']
// No runtime invariant: the standalone server validates every storage and HTTP boundary directly.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/registry-server', install),
)
