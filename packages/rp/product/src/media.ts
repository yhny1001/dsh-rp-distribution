/** Bundled mount of the shared RP media Provider registry. */

import type { Context } from '@deepseek-ai/cordis'
import { RpMediaRuntime } from '@dsh-rp/media'

export const name = 'dsh-rp-product/media'

/** Mount the reusable media registry and its built-in L0 SVG scene-card Provider. */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(RpMediaRuntime)
}
