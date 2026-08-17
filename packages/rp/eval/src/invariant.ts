/** Invariant companion for the pure RP evaluation package. @module @dsh-rp/eval/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis plugin name. */
export const name = 'rp-eval-invariant'
/** Registry dependency used only to reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: evaluation is pure build-time tooling and registers no runtime resources. */
const install: InvariantInstaller = () => {}

/** Register the empty, package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/eval', install))
