/** Package-owned Harness RP Agent Provider invariant companion. @module @dsh-rp/agent-provider-harness/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'rp-agent-provider-harness-invariant'
/** Invariant registry required by the companion. */
export const inject = ['invariants']

/** No runtime invariant: Harness Subagent and RP Agent runtimes own lifecycle pairing. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/agent-provider-harness', install),
)
