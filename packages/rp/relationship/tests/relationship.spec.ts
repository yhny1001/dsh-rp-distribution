import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { RpScopeRef } from '@dsh-rp/contracts'
import RpRelationshipRuntime, { RpRelationshipConflictError } from '../src/index.ts'

const scope: RpScopeRef = { kind: 'conversation', id: 'relationship-test' }

describe('RP relationship runtime', () => {
  it('commits directed edges with optimistic revisions and bounded dimensions', async () => {
    const ctx = new Context(); await ctx.plugin(RpRelationshipRuntime)
    const first = ctx.rpRelationships.replace(scope, {
      from: 'mira', to: 'user', dimensions: { trust: 20 }, notes: ['First meeting'],
    })
    expect(first).toMatchObject({ revision: 1, dimensions: { trust: 20 } })
    expect(() => ctx.rpRelationships.replace(scope, {
      from: 'mira', to: 'user', dimensions: { trust: 30 },
    }, 0)).toThrow(RpRelationshipConflictError)
    expect(() => ctx.rpRelationships.replace(scope, {
      from: 'mira', to: 'user', dimensions: { trust: 101 },
    }, 1)).toThrow('from -100 to 100')
    expect(ctx.rpRelationships.list(scope)).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
