/** Package invariant companion. @module @dsh-rp/tool-capability/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-tool-capability-invariant'
export const inject = ['invariants']
// No runtime invariant: Tool Runtime owns lifecycle and every invocation passes through the catalog guard.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/tool-capability', install),
)
