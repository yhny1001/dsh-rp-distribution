/** Package invariant companion. @module @dsh-rp/media-input-attachment/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-media-input-attachment-invariant'
export const inject = ['invariants', 'rpMedia']
// No runtime invariant: ctx.rpMedia validates Adapter output and the attachment backend validates every stored image.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@dsh-rp/media-input-attachment', install),
)
