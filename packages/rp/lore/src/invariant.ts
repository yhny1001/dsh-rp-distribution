/** Package invariant companion. @module @dsh-rp/lore/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-lore-invariant'
export const inject = ['invariants']

// No runtime invariant: scope isolation and budgets are enforced by RpLoreService.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/lore', install))
