/** Package invariant companion. @module @dsh-rp/memory-basic/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-memory-basic-invariant'
export const inject = ['invariants']

// No runtime invariant: bounded storage and queries are enforced by RpMemoryService.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/memory-basic', install))
