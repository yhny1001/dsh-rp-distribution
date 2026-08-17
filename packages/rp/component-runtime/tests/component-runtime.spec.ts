import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RpComponentId, RpPackageId } from '@dsh-rp/contracts'
import RpComponentRegistry, { RpComponentError } from '../src/index.ts'

const scope = { kind: 'conversation' as const, id: 'conversation-1' }

describe('@dsh-rp/component-runtime', () => {
  it('resolves dependencies before roots and keeps equivalent composition ids stable', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRegistry)
    ctx.rpComponents.register({
      id: RpComponentId('memory'),
      packageId: RpPackageId('rp.memory'),
      version: '1.0.0',
      trust: 'L0',
      scopes: ['conversation'],
      requires: ['memory:read'],
    })
    ctx.rpComponents.register({
      id: RpComponentId('actor'),
      packageId: RpPackageId('rp.actor'),
      version: '1.0.0',
      trust: 'L2',
      scopes: ['conversation'],
      dependencies: [{ id: RpComponentId('memory'), version: '1.0.0' }],
    })
    const request = {
      scope,
      components: [RpComponentId('actor')],
      grantedCapabilities: ['memory:read'],
    }
    const first = ctx.rpComponents.resolve(request)
    const second = ctx.rpComponents.resolve(request)
    expect(first.components.map(component => component.id)).toEqual(['memory', 'actor'])
    expect(first.id).toBe(second.id)
    expect(Object.isFrozen(first)).toBe(true)
  })

  it('removes an effect-scoped registration through its disposer', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(RpComponentRegistry)
    const dispose = ctx.rpComponents.register({
      id: RpComponentId('actor'),
      packageId: RpPackageId('rp.actor'),
      version: '1.0.0',
      trust: 'L2',
      scopes: ['conversation'],
    })
    expect(ctx.rpComponents.list()).toHaveLength(1)
    dispose()
    dispose()
    expect(ctx.rpComponents.list()).toHaveLength(0)
    await fiber.dispose()
    expect(ctx.get('rpComponents')).toBeUndefined()
  })

  it('rejects duplicate, missing, cyclic, denied, version, and scope-invalid compositions', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRegistry)
    const actor = {
      id: RpComponentId('actor'),
      packageId: RpPackageId('rp.actor'),
      version: '1.0.0',
      trust: 'L2' as const,
      scopes: ['conversation' as const],
      dependencies: [{ id: RpComponentId('memory'), version: '2.0.0' }],
      requires: ['agent:spawn'],
    }
    ctx.rpComponents.register(actor)
    expect(() => { ctx.rpComponents.register(actor) }).toThrow(RpComponentError)
    expect(() => ctx.rpComponents.resolve({ scope, components: [actor.id], grantedCapabilities: [] }))
      .toThrow(/denied capability/)
    expect(() => ctx.rpComponents.resolve({ scope, components: [actor.id], grantedCapabilities: ['agent:spawn'] }))
      .toThrow(/not registered/)
    ctx.rpComponents.register({
      id: RpComponentId('memory'),
      packageId: RpPackageId('rp.memory'),
      version: '1.0.0',
      trust: 'L0',
      scopes: ['conversation'],
    })
    expect(() => ctx.rpComponents.resolve({ scope, components: [actor.id], grantedCapabilities: ['agent:spawn'] }))
      .toThrow(/has version/)
    const ctx2 = new Context()
    await ctx2.plugin(RpComponentRegistry)
    ctx2.rpComponents.register({
      id: RpComponentId('a'), packageId: RpPackageId('a'), version: '1', trust: 'L0', scopes: ['conversation'],
      dependencies: [{ id: RpComponentId('b') }],
    })
    ctx2.rpComponents.register({
      id: RpComponentId('b'), packageId: RpPackageId('b'), version: '1', trust: 'L0', scopes: ['conversation'],
      dependencies: [{ id: RpComponentId('a') }],
    })
    expect(() => ctx2.rpComponents.resolve({ scope, components: [RpComponentId('a')], grantedCapabilities: [] }))
      .toThrow(/dependency cycle/)
    expect(() => ctx2.rpComponents.resolve({
      scope: { kind: 'scene', id: 'scene' }, components: [RpComponentId('a')], grantedCapabilities: [],
    })).toThrow(/does not support scope/)
  })
})
