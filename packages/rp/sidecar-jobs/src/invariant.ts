/** Package-owned RP Sidecar Jobs invariant companion. @module @dsh-rp/sidecar-jobs/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'rp-sidecar-jobs-invariant'
/** Invariant registry required by the companion. */
export const inject = ['invariants']

/** No runtime invariant: Pipeline, Job, Agent, and Journal owners validate every public boundary. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/sidecar-jobs', install),
)
