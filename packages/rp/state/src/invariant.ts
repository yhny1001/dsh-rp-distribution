/** Package invariant companion. @module @dsh-rp/state/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'rp-state-invariant'
export const inject = ['invariants']
// No runtime invariant: all mutable state is owned and validated by RpStateService.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/state', install))
