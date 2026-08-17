/** Package invariant companion. @module @dsh-rp/library/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-library-invariant'
export const inject = ['invariants']

const install: InvariantInstaller = (target, report) => {
  target.on('rp/library-changed', () => {
    const library = target.get('rpLibrary')
    if (library === undefined) {
      report('library change emitted without a live RP library service')
      return
    }
    const ids = {
      character: new Set(library.listCharacters().map(record => record.asset.id)),
      persona: new Set(library.listPersonas().map(record => record.asset.id)),
      lore: new Set(library.listLorebooks().map(record => record.asset.id)),
    }
    for (const selection of library.listSelections()) {
      for (const id of selection.assetIds) {
        if (!ids[selection.kind].has(id)) report(`${selection.kind} selection references missing asset ${id}`)
      }
    }
  }, { global: true })
}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@dsh-rp/library', install))
