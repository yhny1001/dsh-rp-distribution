/** Package invariant companion. @module @dsh-rp/web/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-web-invariant'
export const inject = ['invariants']

// No runtime invariant: the web plugin owns stateless, bounded HTTP projections.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/web', install))
