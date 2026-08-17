/** Package invariant companion. @module @dsh-rp/media/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'rp-media-invariant'
export const inject = ['invariants']
// No runtime invariant: Provider authority metadata and complete artifact bounds are validated at registration and generation.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/media', install))
