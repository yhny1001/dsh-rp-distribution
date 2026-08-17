/** Package-owned capability lifecycle invariants. @module @dsh-rp/capability-catalog/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { RpCapabilityDescriptor } from './types.ts'

const PACKAGE_NAME = '@dsh-rp/capability-catalog'

/** Cordis companion plugin name. */
export const name = 'rp-capability-catalog-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Install completion pairing checks keyed by the immutable descriptor object. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const active = new Set<RpCapabilityDescriptor>()
  ctx.on('rp/capability-started', (descriptor) => {
    if (active.has(descriptor)) fail(`RP capability ${JSON.stringify(descriptor.id)} started twice without settlement`)
    active.add(descriptor)
  }, { global: true })
  const settle = (descriptor: RpCapabilityDescriptor): void => {
    if (!active.delete(descriptor)) fail(`RP capability ${JSON.stringify(descriptor.id)} settled without a start`)
  }
  ctx.on('rp/capability-completed', settle, { global: true })
  ctx.on('rp/capability-failed', settle, { global: true })
}, { inject: ['rpCapabilities'] })

/** Register this package's invariant companion. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
