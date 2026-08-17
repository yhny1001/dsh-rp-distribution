/** Invariant companion for controlled STscript compatibility. @module @dsh-rp/compat-stscript/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'rp-compat-stscript-invariant'
export const inject = ['invariants']
// No runtime invariant: bounds and permission enforcement are exercised at every invocation boundary.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/compat-stscript', install))
