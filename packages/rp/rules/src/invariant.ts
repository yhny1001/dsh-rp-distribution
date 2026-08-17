/** Package invariant companion. @module @dsh-rp/rules/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'rp-rules-invariant'
export const inject = ['invariants']
// No runtime invariant: Provider uniqueness and bounded evaluation inputs are enforced synchronously by the service.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/rules', install))
