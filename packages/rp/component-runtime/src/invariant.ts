/** Package-owned RP composition invariants. @module @dsh-rp/component-runtime/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { RpCompositionSnapshot } from './types.ts'

const PACKAGE_NAME = '@dsh-rp/component-runtime'

/** Cordis companion plugin name. */
export const name = 'rp-component-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one published composition's identity and uniqueness. */
function validateSnapshot(snapshot: RpCompositionSnapshot, fail: InvariantFailure): void {
  if (String(snapshot.id).length !== 64) fail('RP composition id must be a SHA-256 hex digest')
  const ids = snapshot.components.map(component => component.id)
  if (new Set(ids).size !== ids.length) fail('RP composition must not contain duplicate component ids')
  if (snapshot.components.length === 0) fail('RP composition must contain at least one component')
}

/** Install checks over every published immutable composition. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('rp/composition-resolved', (snapshot) => { validateSnapshot(snapshot, fail) }, { global: true })
}, { inject: ['rpComponents'] })

/** Register this package's invariant companion. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
