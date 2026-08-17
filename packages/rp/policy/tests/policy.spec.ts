import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { RpCapabilityId } from '@dsh-rp/contracts'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import RpPolicyRuntime from '../src/index.ts'

async function createContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(RpCapabilityCatalog)
  await ctx.plugin(RpPolicyRuntime)
  return ctx
}

describe('@dsh-rp/policy', () => {
  it('intersects every authority layer and releases registrations', async () => {
    const ctx = await createContext()
    const dispose = ctx.rpPolicy.register({
      name: 'deployment', permissions: ['lore:read', 'memory:write'], maxTrust: 'L2',
      networkDomains: ['example.com'], budget: { timeoutMs: 500, maxAgents: 4 },
    })
    const decision = ctx.rpPolicy.resolve({
      requestedPermissions: ['memory:write', 'lore:read', 'shell'], requestedTrust: 'L1',
      networkDomains: ['api.example.com', 'example.com'], budget: { timeoutMs: 200, maxTokens: 1000 },
      layers: [{ name: 'user', permissions: ['lore:read'], networkDomains: ['example.com'], budget: { maxAgents: 2 } }],
    })
    expect(decision).toMatchObject({
      permissions: ['lore:read'], trust: 'L1', networkDomains: ['example.com'],
      budget: { timeoutMs: 200, maxTokens: 1000, maxAgents: 2 },
    })
    dispose()
    expect(ctx.rpPolicy.list()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('denies rather than downgrades a higher-trust operation', async () => {
    const ctx = await createContext()
    ctx.rpPolicy.register({ name: 'product', maxTrust: 'L1' })
    expect(() => ctx.rpPolicy.resolve({ requestedPermissions: [], requestedTrust: 'L2' }))
      .toThrow(/exceeds effective ceiling/)
  })

  it('narrows capability invocation through registered and per-call layers', async () => {
    const ctx = await createContext()
    ctx.rpPolicy.register({
      name: 'deployment', permissions: ['script.execute'], maxTrust: 'L1',
      budget: { timeoutMs: 300 },
    })
    const id = RpCapabilityId('pipeline.quickjs')
    ctx.rpCapabilities.register({
      descriptor: {
        id, kind: 'pipeline', version: '1', title: 'QuickJS', description: 'Sandboxed script',
        trust: 'L1', scopes: ['agent'], permissions: ['script.execute'], budget: { timeoutMs: 500 },
      },
      invoke: request => Promise.resolve({
        trust: request.effectiveAuthority.trust,
        timeoutMs: request.effectiveBudget.timeoutMs ?? 0,
        layers: [...request.effectiveAuthority.layers],
      }),
    })
    await expect(ctx.rpCapabilities.invoke(id, {
      scope: { kind: 'agent', id: 'actor' }, input: null,
      grantedPermissions: ['script.execute'], grantedTrust: 'L1', budget: { timeoutMs: 400 },
      policyLayers: [{ name: 'agent', permissions: ['script.execute'], maxTrust: 'L1' }],
    })).resolves.toEqual({ trust: 'L1', timeoutMs: 300, layers: ['deployment', 'agent'] })

    ctx.rpPolicy.register({ name: 'product-deny', permissions: [] })
    await expect(ctx.rpCapabilities.invoke(id, {
      scope: { kind: 'agent', id: 'actor' }, input: null,
      grantedPermissions: ['script.execute'], grantedTrust: 'L1',
    })).rejects.toMatchObject({ code: 'PERMISSION' })
  })

  it('preserves authority already narrowed by an earlier authorizer', async () => {
    const ctx = await createContext()
    ctx.rpCapabilities.registerAuthorizer({
      id: 'deployment-emergency-ceiling', priority: 2_000,
      authorize: request => ({ ...request.authority, trust: 'L0' }),
    })
    const id = RpCapabilityId('pipeline.quickjs.pre-narrowed')
    ctx.rpCapabilities.register({
      descriptor: {
        id, kind: 'pipeline', version: '1', title: 'QuickJS', description: 'Sandboxed script',
        trust: 'L1', scopes: ['agent'], permissions: ['script.execute'],
      },
      invoke: request => Promise.resolve(request.effectiveAuthority.trust),
    })
    await expect(ctx.rpCapabilities.invoke(id, {
      scope: { kind: 'agent', id: 'actor' }, input: null,
      grantedPermissions: ['script.execute'], grantedTrust: 'L1',
    })).rejects.toMatchObject({ code: 'TRUST' })
  })
})
