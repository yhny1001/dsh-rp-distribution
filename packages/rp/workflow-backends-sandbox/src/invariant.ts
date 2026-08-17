/** Package invariant companion. @module @dsh-rp/workflow-backends-sandbox/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-workflow-backends-sandbox-invariant'
export const inject = ['invariants']
// No runtime invariant: backend registration and every execution boundary validate independently.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/workflow-backends-sandbox', install),
)
