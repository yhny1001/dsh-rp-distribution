/** Package-owned invariant companion for the RP journal. @module @dsh-rp/journal/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-rp/journal'

/** Cordis companion plugin name. */
export const name = 'rp-journal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: Session validates event JSON and publication; Turn Runtime owns commit-versus-abort exclusivity. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
