/** Package invariant companion. @module @dsh-rp/memory-durable/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-memory-durable-invariant'
export const inject = ['invariants']
// No runtime invariant: Storage Domain validates records at open and rpMemory validates events again at hydration.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/memory-durable', install),
)
