/** Package invariant companion. @module @dsh-rp/workflow-backends-local/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-workflow-backends-local-invariant'
export const inject = ['invariants']
// No runtime invariant: the Router owns backend uniqueness and each executor enforces its limits per run.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/workflow-backends-local', install),
)
