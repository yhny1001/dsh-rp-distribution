import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { PersonaIR } from '@dsh-rp/contracts'
import RpPersonaRuntime from '../src/index.ts'

const persona = (id: string): PersonaIR => ({
  schemaVersion: 1,
  id,
  name: `Persona ${id}`,
  description: 'A visiting astronomer.',
  extensions: { endpoint: 'https://must-not-reach-model.invalid' },
  compatibility: {
    source: { format: 'test', importedAt: 1 },
    unknownFields: { code: 'TavernHelper.doAnything()' },
  },
})

describe('@dsh-rp/persona', () => {
  it('isolates exact scopes and lists detached personas deterministically', async () => {
    const ctx = new Context()
    await ctx.plugin(RpPersonaRuntime)
    const first = { kind: 'conversation' as const, id: 'first' }
    const second = { kind: 'conversation' as const, id: 'second' }
    const source = persona('zeta') as PersonaIR & { name: string }
    ctx.rpPersonas.register(first, source)
    ctx.rpPersonas.register(first, persona('alpha'))
    ctx.rpPersonas.register(second, persona('beta'))
    source.name = 'mutated'
    expect(ctx.rpPersonas.list(first).map(row => row.id)).toEqual(['alpha', 'zeta'])
    expect(ctx.rpPersonas.get(first, 'zeta')?.name).toBe('Persona zeta')
    expect(ctx.rpPersonas.get(first, 'beta')).toBeUndefined()
    expect(Object.isFrozen(ctx.rpPersonas.get(first, 'zeta')?.extensions)).toBe(true)
  })

  it('emits lifecycle changes and disposes registrations idempotently', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(RpPersonaRuntime)
    const scope = { kind: 'conversation' as const, id: 'events' }
    const changed = vi.fn()
    ctx.on('rp/personas-changed', changed)
    const dispose = ctx.rpPersonas.register(scope, persona('user'))
    expect(changed).toHaveBeenCalledTimes(1)
    dispose()
    dispose()
    expect(changed).toHaveBeenCalledTimes(2)
    expect(ctx.rpPersonas.list(scope)).toEqual([])
    await fiber.dispose()
    expect(ctx.rpPersonas).toBeUndefined()
  })

  it('projects only bounded model-safe fields', async () => {
    const ctx = new Context()
    await ctx.plugin(RpPersonaRuntime)
    const scope = { kind: 'conversation' as const, id: 'context' }
    ctx.rpPersonas.register(scope, persona('user'))
    const projected = ctx.rpPersonas.context(scope)
    expect(projected).toEqual([{
      id: 'user', name: 'Persona user', description: 'A visiting astronomer.',
    }])
    expect(JSON.stringify(projected)).not.toContain('must-not-reach-model')
    expect(JSON.stringify(projected)).not.toContain('TavernHelper')
    expect(Object.isFrozen(projected)).toBe(true)
    expect(ctx.rpPersonas.context(scope, { maxCharacters: 1 })).toEqual([])
    expect(() => ctx.rpPersonas.context(scope, { maxEntries: 0 })).toThrow(/entry bound/u)
  })

  it('rejects duplicates, lossy JSON, exotic objects, and oversized fields', async () => {
    const ctx = new Context()
    await ctx.plugin(RpPersonaRuntime)
    const scope = { kind: 'conversation' as const, id: 'invalid' }
    ctx.rpPersonas.register(scope, persona('user'))
    expect(() => ctx.rpPersonas.register(scope, persona('user'))).toThrow(/already exists/u)
    expect(() => ctx.rpPersonas.register(scope, {
      ...persona('negative-zero'), extensions: { value: -0 },
    })).toThrow(/lossy number/u)
    expect(() => ctx.rpPersonas.register(scope, {
      ...persona('date'), extensions: { value: new Date() as never },
    })).toThrow(/plain object/u)
    expect(() => ctx.rpPersonas.register(scope, {
      ...persona('large'), description: 'x'.repeat(1_000_001),
    })).toThrow(/description/u)
    let nested: Record<string, unknown> = {}
    for (let depth = 0; depth < 70; depth += 1) nested = { child: nested }
    expect(() => ctx.rpPersonas.register(scope, {
      ...persona('deep'), extensions: nested as never,
    })).toThrow(/structure budget/u)
  })
})
