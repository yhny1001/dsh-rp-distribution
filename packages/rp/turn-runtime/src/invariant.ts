/** Package-owned RP turn transaction invariants. @module @dsh-rp/turn-runtime/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { RpTurnId } from '@dsh-rp/contracts'

const PACKAGE_NAME = '@dsh-rp/turn-runtime'

/** Cordis companion plugin name. */
export const name = 'rp-turn-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Install prepared-to-one-terminal lifecycle checks. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const active = new Set<RpTurnId>()
  ctx.on('rp/turn-transaction-prepared', (draft) => {
    if (active.has(draft.id)) fail(`RP turn ${JSON.stringify(draft.id)} prepared twice`)
    active.add(draft.id)
  }, { global: true })
  const settle = (id: RpTurnId): void => {
    if (!active.delete(id)) fail(`RP turn ${JSON.stringify(id)} settled without prepare`)
  }
  ctx.on('rp/turn-transaction-committed', (outcome) => { settle(outcome.draft.id) }, { global: true })
  ctx.on('rp/turn-transaction-aborted', settle, { global: true })
}, { inject: ['rpTurn'] })

/** Register this package's invariant companion. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
