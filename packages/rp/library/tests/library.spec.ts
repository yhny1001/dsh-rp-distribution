import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import * as Library from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function createLibrary(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(Library)
  return ctx
}

const character = {
  schemaVersion: 1 as const,
  id: 'hero',
  name: 'Hero',
  description: 'Watches the observatory.',
  firstMessages: ['Welcome.'],
  extensions: { secret: 'inert' },
}
const persona = {
  schemaVersion: 1 as const,
  id: 'visitor',
  name: 'Visitor',
  description: 'An astronomer.',
}
const lore = {
  schemaVersion: 1 as const,
  id: 'observatory',
  name: 'Observatory',
  entries: [{ id: 'dome', content: 'The dome is open.', keys: ['dome'], enabled: true, priority: 10 }],
}

describe('@dsh-rp/library', () => {
  it('persists independent nearest-scope selections and stable Turn snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-library-'))
    roots.push(root)
    const deployment = { kind: 'deployment' as const, id: 'default' }
    const profile = { kind: 'profile' as const, id: 'profile', parent: deployment }
    const conversation = { kind: 'conversation' as const, id: 'session', parent: profile }
    const first = await createLibrary(root)
    await first.rpLibrary.saveCharacter(character)
    await first.rpLibrary.savePersona(persona)
    await first.rpLibrary.saveLore(lore)
    await first.rpLibrary.activate(profile, 'character', character.id)
    await first.rpLibrary.activate(profile, 'persona', persona.id)
    await first.rpLibrary.activate(deployment, 'lore', lore.id)

    const snapshot = first.rpLibrary.capture({ kind: 'turn', id: 'turn-1', parent: conversation })
    expect(snapshot).toMatchObject({
      characters: [{ id: 'hero' }], personas: [{ id: 'visitor' }], lorebooks: [{ id: 'observatory' }],
      bindingScopes: { character: profile, persona: profile, lore: deployment },
    })
    expect(snapshot?.snapshotHash).toMatch(/^[a-f0-9]{64}$/u)
    await first.fiber.dispose()

    const restarted = await createLibrary(root)
    expect(restarted.rpLibrary.capture(conversation)).toMatchObject({ snapshotHash: snapshot?.snapshotHash })
    expect(restarted.rpLibrary.listCharacters()).toHaveLength(1)
    expect(restarted.rpLibrary.listSelections()).toHaveLength(3)
    await restarted.fiber.dispose()
  })

  it('replaces Persona selection and prunes removed assets without dangling references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-library-prune-'))
    roots.push(root)
    const ctx = await createLibrary(root)
    const scope = { kind: 'conversation' as const, id: 'session' }
    await ctx.rpLibrary.saveCharacter(character)
    await ctx.rpLibrary.savePersona(persona)
    await ctx.rpLibrary.savePersona({ ...persona, id: 'second', name: 'Second' })
    await ctx.rpLibrary.activate(scope, 'character', character.id)
    await ctx.rpLibrary.activate(scope, 'persona', persona.id)
    await ctx.rpLibrary.activate(scope, 'persona', 'second')
    expect(ctx.rpLibrary.capture(scope)?.personas).toMatchObject([{ id: 'second' }])
    await expect(ctx.rpLibrary.remove('character', character.id)).resolves.toBe(true)
    expect(ctx.rpLibrary.capture(scope)?.characters).toEqual([])
    expect(ctx.rpLibrary.listSelections().some(selection => selection.kind === 'character')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('serializes concurrent activation and deactivation without losing selected assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-library-concurrent-'))
    roots.push(root)
    const ctx = await createLibrary(root)
    const scope = { kind: 'conversation' as const, id: 'session' }
    await ctx.rpLibrary.saveBundle({
      characters: [character, { ...character, id: 'second', name: 'Second' }],
    })
    await Promise.all([
      ctx.rpLibrary.activate(scope, 'character', character.id),
      ctx.rpLibrary.activate(scope, 'character', 'second'),
    ])
    expect(ctx.rpLibrary.capture(scope)?.characters.map(asset => asset.id)).toEqual(['hero', 'second'])
    await Promise.all([
      ctx.rpLibrary.deactivate(scope, 'character', character.id),
      ctx.rpLibrary.deactivate(scope, 'character', 'second'),
    ])
    expect(ctx.rpLibrary.capture(scope)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
