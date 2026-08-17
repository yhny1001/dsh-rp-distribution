/** Package invariant companion. @module @dsh-rp/registry/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'rp-registry-invariant'
export const inject = ['invariants']
// No runtime invariant: manifests, graph locks, integrity and revocations are checked at each registry boundary.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/registry', install))
