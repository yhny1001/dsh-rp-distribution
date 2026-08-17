/** Package-owned invariant companion for the standalone RP CLI. @module @dsh-rp/cli/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'rp-cli-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the CLI runs outside a Cordis application. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's empty invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns Registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/cli', install))
