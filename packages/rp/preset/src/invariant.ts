/** Package invariant companion. @module @dsh-rp/preset/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-preset-invariant'
export const inject = ['invariants']

const install: InvariantInstaller = (target, report) => {
  target.on('rp/preset-changed', () => {
    const presets = target.get('rpPresets')
    if (presets === undefined) {
      report('preset change emitted without a live RP preset service')
      return
    }
    for (const binding of presets.listBindings()) {
      if (presets.get(binding.presetId) === undefined) {
        report(`binding ${binding.scope.kind}:${binding.scope.id} references missing preset ${binding.presetId}`)
      }
    }
  }, { global: true })
}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/preset', install))
