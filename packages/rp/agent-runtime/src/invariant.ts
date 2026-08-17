/** Package-owned RP Agent runtime invariant companion. @module @dsh-rp/agent-runtime/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'rp-agent-runtime-invariant'
/** Invariant registry required by the companion. */
export const inject = ['invariants']

/** No runtime invariant: registration, routing, and settlement are checked at their owning boundaries. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/agent-runtime', install),
)
