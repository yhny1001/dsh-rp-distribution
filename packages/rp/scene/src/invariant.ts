/** Package invariant companion. @module @dsh-rp/scene/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'rp-scene-invariant'
export const inject = ['invariants']
// No runtime invariant: revision checks and complete-scene validation occur before each projection commit.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/scene', install))
