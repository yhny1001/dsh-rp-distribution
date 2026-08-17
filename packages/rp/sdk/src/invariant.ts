/** Invariant companion for the pure RP SDK. @module @dsh-rp/sdk/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis plugin name. */
export const name = 'rp-sdk-invariant'
/** Registry dependency used only to reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: tooling is pure and registers no runtime resources to audit. */
const install: InvariantInstaller = () => {}

/** Register the empty, package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/sdk', install))
