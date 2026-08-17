/** Package invariant companion. @module @dsh-rp/relationship/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'rp-relationship-invariant'
export const inject = ['invariants']
// No runtime invariant: edge identity, revisions, dimensions, and notes are validated before publication.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/relationship', install))
