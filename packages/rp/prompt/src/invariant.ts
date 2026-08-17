/** Package invariant companion. @module @dsh-rp/prompt/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-prompt-invariant'
export const inject = ['invariants']

// No runtime invariant: prompt ordering is validated on every composition.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/prompt', install))
