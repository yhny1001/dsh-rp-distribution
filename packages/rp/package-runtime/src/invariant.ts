/** Package invariant companion. @module @dsh-rp/package-runtime/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-package-runtime-invariant'
export const inject = ['invariants']
// No runtime invariant: every parse validates the complete archive and descriptor at the typed boundary.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/package-runtime', install),
)
