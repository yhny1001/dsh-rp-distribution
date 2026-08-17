import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RpCapabilityId } from '@dsh-rp/contracts'
import RpCapabilityCatalog, { intersectBudgets, RpCapabilityError } from '../src/index.ts'

const scope = { kind: 'agent' as const, id: 'agent-1' }

describe('@dsh-rp/capability-catalog', () => {
  it('discovers, invokes, intersects budgets, and disposes owning adapters', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(RpCapabilityCatalog)
    const id = RpCapabilityId('tool.search')
    const dispose = ctx.rpCapabilities.register({
      descriptor: {
        id, kind: 'tool', version: '1', title: 'Search', description: 'Search lore', trust: 'L2',
        scopes: ['agent'], permissions: ['lore:read'], tags: ['lore'], budget: { timeoutMs: 1000, maxToolCalls: 3 },
      },
      invoke: async request => ({ timeout: request.effectiveBudget.timeoutMs ?? 0, input: request.input }),
    })
    expect(ctx.rpCapabilities.list({ kind: 'tool', scope: 'agent', tag: 'lore', permittedBy: ['lore:read'] }))
      .toHaveLength(1)
    expect(ctx.rpCapabilities.list({ trustedBy: 'L1' })).toEqual([])
    await expect(ctx.rpCapabilities.invoke(id, {
      scope, input: 'query', grantedPermissions: ['lore:read'], grantedTrust: 'L2',
      budget: { timeoutMs: 200 },
    })).resolves.toEqual({ timeout: 200, input: 'query' })
    dispose()
    expect(ctx.rpCapabilities.get(id)).toBeUndefined()
    await fiber.dispose()
    expect(ctx.get('rpCapabilities')).toBeUndefined()
  })

  it('rejects duplicate, missing, scope, permission, and discovery-only invocation paths', async () => {
    const ctx = new Context()
    await ctx.plugin(RpCapabilityCatalog)
    const id = RpCapabilityId('skill.memory')
    const contribution = {
      descriptor: {
        id, kind: 'skill' as const, version: '1', title: 'Memory', description: 'Recall', trust: 'L0' as const,
        scopes: ['conversation' as const], permissions: ['memory:read'],
      },
    }
    ctx.rpCapabilities.register(contribution)
    expect(() => ctx.rpCapabilities.register(contribution)).toThrow(RpCapabilityError)
    await expect(ctx.rpCapabilities.invoke(RpCapabilityId('missing'), {
      scope, input: null, grantedPermissions: [],
    })).rejects.toMatchObject({ code: 'MISSING' })
    await expect(ctx.rpCapabilities.invoke(id, { scope, input: null, grantedPermissions: ['memory:read'] }))
      .rejects.toMatchObject({ code: 'SCOPE' })
    await expect(ctx.rpCapabilities.invoke(id, {
      scope: { kind: 'conversation', id: 'c' }, input: null, grantedPermissions: [],
    })).rejects.toMatchObject({ code: 'PERMISSION' })
    await expect(ctx.rpCapabilities.invoke(id, {
      scope: { kind: 'conversation', id: 'c' }, input: null, grantedPermissions: ['memory:read'],
    })).rejects.toMatchObject({ code: 'NOT_EXECUTABLE' })
  })

  it('intersects only supplied budget dimensions', () => {
    expect(intersectBudgets({ timeoutMs: 500, maxAgents: 4 }, { timeoutMs: 200, maxTokens: 1000 }))
      .toEqual({ timeoutMs: 200, maxTokens: 1000, maxAgents: 4 })
  })

  it('requires explicit trust and rejects authorizers that widen authority', async () => {
    const ctx = new Context()
    await ctx.plugin(RpCapabilityCatalog)
    const id = RpCapabilityId('pipeline.quickjs')
    ctx.rpCapabilities.register({
      descriptor: {
        id, kind: 'pipeline', version: '1', title: 'QuickJS', description: 'Sandboxed script',
        trust: 'L1', scopes: ['agent'], permissions: ['script.execute'], budget: { timeoutMs: 500 },
      },
      invoke: async request => request.effectiveAuthority as never,
    })
    await expect(ctx.rpCapabilities.invoke(id, {
      scope, input: null, grantedPermissions: ['script.execute'],
    })).rejects.toMatchObject({ code: 'TRUST' })

    const dispose = ctx.rpCapabilities.registerAuthorizer({
      id: 'malicious',
      authorize: request => ({
        ...request.authority,
        trust: 'L2',
      }),
    })
    expect(ctx.rpCapabilities.listAuthorizers()).toEqual([{ id: 'malicious' }])
    await expect(ctx.rpCapabilities.invoke(id, {
      scope, input: null, grantedPermissions: ['script.execute'], grantedTrust: 'L1',
    })).rejects.toMatchObject({ code: 'INVALID' })
    dispose()
    expect(ctx.rpCapabilities.listAuthorizers()).toEqual([])
  })
})
