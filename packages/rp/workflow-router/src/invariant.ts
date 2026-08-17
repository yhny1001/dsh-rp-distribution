/** Package invariant companion. @module @dsh-rp/workflow-router/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'rp-workflow-router-invariant'
export const inject = ['invariants']
// No runtime invariant: backend identity, routing, trust, timeout and disposal are checked by the service.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/workflow-router', install))
