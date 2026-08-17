import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CharacterIR } from '@dsh-rp/contracts'
import RpCharacterRuntime from '../src/index.ts'

const character = (id: string): CharacterIR => ({
  schemaVersion: 1,
  id,
  name: `Character ${id}`,
  description: 'A careful explorer.',
  personality: 'Patient and observant.',
  scenario: 'Inside the observatory.',
  firstMessages: ['Hello.'],
  examples: ['Checks the star chart.'],
  tags: ['explorer'],
  extensions: { secret: 'must-not-reach-model' },
  compatibility: {
    source: { format: 'test', importedAt: 1 },
    unknownFields: { script: 'shell.exe --danger' },
  },
})

describe('@dsh-rp/character', () => {
  it('isolates exact scopes and lists detached characters deterministically', async () => {
    const ctx = new Context()
    await ctx.plugin(RpCharacterRuntime)
    const first = { kind: 'conversation' as const, id: 'first' }
    const second = { kind: 'conversation' as const, id: 'second' }
    const source = character('zeta') as CharacterIR & { name: string }
    ctx.rpCharacters.register(first, source)
    ctx.rpCharacters.register(first, character('alpha'))
    ctx.rpCharacters.register(second, character('beta'))
    source.name = 'mutated'
    expect(ctx.rpCharacters.list(first).map(row => row.id)).toEqual(['alpha', 'zeta'])
    expect(ctx.rpCharacters.get(first, 'zeta')?.name).toBe('Character zeta')
    expect(ctx.rpCharacters.get(first, 'beta')).toBeUndefined()
    expect(Object.isFrozen(ctx.rpCharacters.get(first, 'zeta'))).toBe(true)
    expect(Object.isFrozen(ctx.rpCharacters.get(first, 'zeta')?.compatibility?.unknownFields)).toBe(true)
  })

  it('emits lifecycle changes and disposes registrations idempotently', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(RpCharacterRuntime)
    const scope = { kind: 'conversation' as const, id: 'events' }
    const changed = vi.fn()
    ctx.on('rp/characters-changed', changed)
    const dispose = ctx.rpCharacters.register(scope, character('hero'))
    expect(changed).toHaveBeenCalledTimes(1)
    dispose()
    dispose()
    expect(changed).toHaveBeenCalledTimes(2)
    expect(ctx.rpCharacters.list(scope)).toEqual([])
    await fiber.dispose()
    expect(ctx.rpCharacters).toBeUndefined()
  })

  it('projects only bounded model-safe fields', async () => {
    const ctx = new Context()
    await ctx.plugin(RpCharacterRuntime)
    const scope = { kind: 'conversation' as const, id: 'context' }
    ctx.rpCharacters.register(scope, character('hero'))
    const projected = ctx.rpCharacters.context(scope)
    expect(projected).toEqual([{
      id: 'hero', name: 'Character hero', description: 'A careful explorer.',
      personality: 'Patient and observant.', scenario: 'Inside the observatory.',
      examples: ['Checks the star chart.'], tags: ['explorer'],
    }])
    expect(JSON.stringify(projected)).not.toContain('must-not-reach-model')
    expect(JSON.stringify(projected)).not.toContain('shell.exe')
    expect(JSON.stringify(projected)).not.toContain('Hello.')
    expect(Object.isFrozen(projected)).toBe(true)
    expect(ctx.rpCharacters.context(scope, { maxCharacters: 1 })).toEqual([])
    expect(() => ctx.rpCharacters.context(scope, { maxEntries: 0 })).toThrow(/entry bound/u)
  })

  it('rejects duplicates, lossy JSON, exotic objects, and oversized fields', async () => {
    const ctx = new Context()
    await ctx.plugin(RpCharacterRuntime)
    const scope = { kind: 'conversation' as const, id: 'invalid' }
    ctx.rpCharacters.register(scope, character('hero'))
    expect(() => ctx.rpCharacters.register(scope, character('hero'))).toThrow(/already exists/u)
    expect(() => ctx.rpCharacters.register(scope, {
      ...character('negative-zero'), extensions: { value: -0 },
    })).toThrow(/lossy number/u)
    expect(() => ctx.rpCharacters.register(scope, {
      ...character('date'), extensions: { value: new Date() as never },
    })).toThrow(/plain object/u)
    expect(() => ctx.rpCharacters.register(scope, {
      ...character('large'), description: 'x'.repeat(1_000_001),
    })).toThrow(/description/u)
    let nested: Record<string, unknown> = {}
    for (let depth = 0; depth < 70; depth += 1) nested = { child: nested }
    expect(() => ctx.rpCharacters.register(scope, {
      ...character('deep'), extensions: nested as never,
    })).toThrow(/structure budget/u)
  })
})
