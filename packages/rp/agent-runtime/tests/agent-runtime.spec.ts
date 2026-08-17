import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import type { RpAgentProviderRequest } from '../src/index.ts'
import { RpCapabilityId, type JsonObject } from '@dsh-rp/contracts'
import RpAgentRuntime from '../src/index.ts'

function role(provider?: string) {
  return {
    id: 'actor',
    capabilityId: RpCapabilityId('rp.agent.actor'),
    version: '1.0.0',
    title: 'Actor',
    description: 'Acts one RP turn.',
    instructions: 'Stay in character.',
    trust: 'L2' as const,
    scopes: ['agent' as const],
    permissions: ['agent:spawn'],
    ...(provider === undefined ? {} : { provider }),
  }
}

describe('@dsh-rp/agent-runtime', () => {
  it('publishes executable roles, chooses Providers deterministically, and releases the whole role', async () => {
    const ctx = new Context()
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpAgentRuntime)
    const slow = vi.fn(async () => ({ value: { provider: 'slow' } }))
    const fast = vi.fn(async (request: RpAgentProviderRequest) => ({
      value: { provider: 'fast', input: request.invocation.input },
    }))
    const releaseSlow = ctx.rpAgents.registerProvider({ id: 'z-slow', priority: 1, supports: () => true, run: slow })
    const releaseFast = ctx.rpAgents.registerProvider({ id: 'a-fast', priority: 10, supports: () => true, run: fast })
    const releaseRole = ctx.rpAgents.registerRole(role())

    expect(ctx.rpAgents.listProviders()).toEqual(['a-fast', 'z-slow'])
    expect(ctx.rpCapabilities.isExecutable(RpCapabilityId('rp.agent.actor'))).toBe(true)
    await expect(ctx.rpCapabilities.invoke(RpCapabilityId('rp.agent.actor'), {
      scope: { kind: 'agent', id: 'parent' },
      input: { text: 'hello' },
      grantedPermissions: ['agent:spawn'],
      grantedTrust: 'L2',
    })).resolves.toEqual({ provider: 'fast', input: { text: 'hello' } })
    expect(fast).toHaveBeenCalledOnce()
    expect(slow).not.toHaveBeenCalled()

    releaseRole()
    expect(ctx.rpCapabilities.get(RpCapabilityId('rp.agent.actor'))).toBeUndefined()
    releaseFast()
    releaseSlow()
  })

  it('honors an exact role Provider pin and fails closed when it disappears', async () => {
    const ctx = new Context()
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpAgentRuntime)
    const releaseProvider = ctx.rpAgents.registerProvider({
      id: 'remote', supports: () => true, run: async () => ({ value: null }),
    })
    ctx.rpAgents.registerRole(role('remote'))
    releaseProvider()

    await expect(ctx.rpCapabilities.invoke(RpCapabilityId('rp.agent.actor'), {
      scope: { kind: 'agent', id: 'parent' }, input: null,
      grantedPermissions: ['agent:spawn'], grantedTrust: 'L2',
    })).rejects.toMatchObject({ code: 'NO_PROVIDER' })
  })

  it('rejects a role before Provider dispatch when authority lacks agent:spawn', async () => {
    const ctx = new Context()
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpAgentRuntime)
    const run = vi.fn(async () => ({ value: null }))
    ctx.rpAgents.registerProvider({ id: 'provider', supports: () => true, run })
    ctx.rpAgents.registerRole(role())

    await expect(ctx.rpCapabilities.invoke(RpCapabilityId('rp.agent.actor'), {
      scope: { kind: 'agent', id: 'parent' }, input: null,
      grantedPermissions: [], grantedTrust: 'L2',
    })).rejects.toMatchObject({ code: 'PERMISSION' })
    expect(run).not.toHaveBeenCalled()
  })

  it('deep-freezes role schemas and rejects lossy JSON numbers', async () => {
    const ctx = new Context()
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpAgentRuntime)
    ctx.rpAgents.registerRole({
      ...role(),
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    })

    const stored = ctx.rpAgents.getRole('actor')
    expect(Object.isFrozen(stored?.inputSchema)).toBe(true)
    expect(Object.isFrozen((stored?.inputSchema?.properties as JsonObject).text)).toBe(true)
    expect(() => ctx.rpAgents.registerRole({
      ...role(), id: 'invalid', capabilityId: RpCapabilityId('rp.agent.invalid'),
      inputSchema: { type: 'number', maximum: Number.NaN },
    })).toThrow(/finite JSON/)
  })
})
