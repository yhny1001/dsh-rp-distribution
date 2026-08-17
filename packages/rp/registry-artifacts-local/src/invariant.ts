/** Package invariant companion. @module @dsh-rp/registry-artifacts-local/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-registry-artifacts-local-invariant'
export const inject = ['invariants']
// No runtime invariant: every get and put verifies its content-addressed identity.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/registry-artifacts-local', install),
)
