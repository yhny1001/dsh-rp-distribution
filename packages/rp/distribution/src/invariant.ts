/** Package-owned invariant companion for the RP distribution bundle. @module @dsh-rp/distribution/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-rp/distribution'

/** Cordis companion plugin name. */
export const name = 'rp-distribution-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the bundle is a static patch carrier and each inserted package owns its checks. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
