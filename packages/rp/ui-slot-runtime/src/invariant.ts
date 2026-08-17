/** Package-owned installable UI Slot invariants. @module @dsh-rp/ui-slot-runtime/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const validate = (): void => {
    const keys = ctx.rpUiSlots.list().map(slot => `${String(slot.packageId)}:${slot.id}`)
    if (new Set(keys).size !== keys.length) fail('RP UI Slot identities must be unique')
    if (ctx.rpUiSlots.list().some(slot => slot.script !== 'none')) {
      fail('Runtime v1 RP UI Slots must not execute script')
    }
  }
  ctx.on('rp/ui-slots-changed', validate, { global: true })
}, { inject: ['rpUiSlots'] })

export const name = 'rp-ui-slot-runtime-invariant'
export const inject = ['invariants']
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/ui-slot-runtime', install))
