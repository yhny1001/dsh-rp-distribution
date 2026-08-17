/** Package invariant companion. @module @dsh-rp/outbox/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'rp-outbox-invariant'; export const inject = ['invariants']
// No runtime invariant: idempotency, retries, ownership and compensation are enforced at operation boundaries.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/outbox', install))
