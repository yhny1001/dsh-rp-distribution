/** Lifecycle audit for RP policy registrations. @module @dsh-rp/policy/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-policy-invariant'
export const inject = ['invariants']

/** No runtime invariant: policy registrations are process-local metadata covered by idempotent disposal tests. */
const install: InvariantInstaller = () => {}

/** The runtime's idempotent disposer is covered by package HMR tests. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/policy', install))
