/** Package invariant companion. @module @dsh-rp/character/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis plugin name. */
export const name = 'rp-character-invariant'
/** Required invariant registry service. */
export const inject = ['invariants']

// No runtime invariant: scope isolation, safe projection, and hard bounds are enforced by RpCharacterRuntime.
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. @param ctx - Cordis context. @returns Disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/character', install))
