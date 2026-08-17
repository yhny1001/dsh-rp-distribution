/** Package invariant companion. @module @dsh-rp/branches/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-branches-invariant'
export const inject = ['invariants']

// No runtime invariant: revision and graph checks are enforced by RpBranchService.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/branches', install))
