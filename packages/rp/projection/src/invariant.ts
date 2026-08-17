/** Package-owned invariant companion for RP projection. @module @dsh-rp/projection/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-rp/projection'

/** Cordis companion plugin name. */
export const name = 'rp-projection-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the pure fold rejects duplicate terminal events and owns no mutable cache. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
