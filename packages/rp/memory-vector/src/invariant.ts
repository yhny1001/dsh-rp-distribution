/** Package invariant companion. @module @dsh-rp/memory-vector/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'rp-memory-vector-invariant'
export const inject = ['invariants']
// No runtime invariant: bounded deterministic scoring is enforced by the Provider and canonical memory service.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/memory-vector', install))
