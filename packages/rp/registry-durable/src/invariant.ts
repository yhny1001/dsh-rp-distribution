/** Package invariant companion. @module @dsh-rp/registry-durable/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-registry-durable-invariant'
export const inject = ['invariants']
// No runtime invariant: Storage Domain validates records and Registry verifies sources and hashes before activation.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/registry-durable', install),
)
