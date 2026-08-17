import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, {
  type ResolvedSubagentStartRequest,
  type SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import RpAgentRuntime from '@dsh-rp/agent-runtime'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import { RpCapabilityId } from '@dsh-rp/contracts'
import RpJournal from '@dsh-rp/journal'
import * as HarnessProvider from '../src/index.ts'

async function bench(stopReason: 'completed' | 'aborted' | 'rejected' = 'completed') {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(RpCapabilityCatalog)
  await ctx.plugin(RpAgentRuntime)
  await ctx.plugin(RpJournal)
  const disposed = vi.fn(async () => {})
  const start = vi.fn(async (_request: ResolvedSubagentStartRequest) => ({
    id: SessionId('child-1'),
    localAgent: undefined,
    result: stopReason === 'rejected' ? Promise.reject(new Error('transport failed')) : Promise.resolve({
      output: [{ type: 'text', text: 'child answer' }] as ContentBlock[],
      stopReason,
    }),
    dispose: disposed,
  }))
  const provider: SubagentProvider = {
    name: 'fork',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: true,
    start,
  }
  ctx.subagents.registerProvider(provider)
  const fiber = await ctx.plugin(HarnessProvider, { subagentProviders: ['fork'] })
  ctx.rpAgents.registerRole({
    id: 'actor', capabilityId: RpCapabilityId('rp.agent.actor'), version: '1.0.0',
    title: 'Actor', description: 'Act one turn.', instructions: 'Stay in character.',
    trust: 'L2', scopes: ['agent'], permissions: ['agent:spawn'], capabilityKinds: ['tool', 'skill'],
  })
  const events: Array<{ type: string; data: unknown }> = []
  const session = {
    id: SessionId('parent'),
    events,
    append(type: string, data: unknown) {
      const event = { seq: events.length, type, data }
      events.push(event)
      return event
    },
  }
  const parent = {
    id: SessionId('parent'), options: {}, session, status: 'running', ctx,
    inbox: {}, cancel() {}, followup() {}, steer() {}, inject() {}, send() {},
    whenIdle: async () => {},
    runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) =>
      await task(new AbortController().signal),
  } as unknown as Agent
  return { ctx, parent, events, start, disposed, fiber }
}

describe('@dsh-rp/agent-provider-harness', () => {
  it('delegates through the selected Harness Provider and journals the concrete lifecycle', async () => {
    const b = await bench()
    const result = await b.ctx.agents.withInitiator(b.parent, async () => await b.ctx.rpCapabilities.invoke(
      RpCapabilityId('rp.agent.actor'),
      {
        scope: { kind: 'agent', id: 'parent' },
        input: {
          turnId: 'turn-1', text: 'hello',
          content: [{
            type: 'image',
            attachment: {
              attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png',
              bytes: 68, width: 1, height: 1, name: 'scene.png',
            },
          }],
        },
        grantedPermissions: ['agent:spawn'], grantedTrust: 'L2', budget: { timeoutMs: 1_000, maxTokens: 256 },
      },
    ))

    expect(result).toMatchObject({ agentId: 'child-1', role: 'actor', transport: 'fork', stopReason: 'completed' })
    expect(b.start).toHaveBeenCalledOnce()
    const request = b.start.mock.calls[0]?.[0]
    expect(request).toMatchObject({ label: 'rp:actor', maxDepth: 4, agentOptions: { maxTokens: 256 } })
    expect(request?.prompt[0]).toMatchObject({
      type: 'image', attachment: { mediaType: 'image/png', name: 'scene.png' },
    })
    expect(request?.prompt[1]).toMatchObject({ type: 'text' })
    expect(request?.persona).toContain('Stay in character.')
    expect(b.events.map(event => event.type)).toEqual([
      'rp/agent-started', 'rp/agent-delegated', 'rp/agent-completed',
    ])
    expect(b.events[0]?.data).toMatchObject({
      turnId: 'turn-1', agentId: 'child-1', parentAgentId: 'parent',
      detail: { input: { turnId: 'turn-1', text: 'hello' } },
    })
    expect(b.events[2]?.data).toMatchObject({
      detail: { output: { output: [{ type: 'text', text: 'child answer' }] } },
    })
    expect(b.disposed).toHaveBeenCalledOnce()
    await b.fiber.dispose()
    expect(b.ctx.rpAgents.listProviders()).toEqual([])
  })

  it('fails closed without an initiating Agent', async () => {
    const b = await bench()
    await expect(b.ctx.rpCapabilities.invoke(RpCapabilityId('rp.agent.actor'), {
      scope: { kind: 'agent', id: 'parent' }, input: null,
      grantedPermissions: ['agent:spawn'], grantedTrust: 'L2',
    })).rejects.toThrow(/active Harness Agent/)
    expect(b.start).not.toHaveBeenCalled()
  })

  it('records interruption and rejects non-completed child outcomes', async () => {
    const b = await bench('aborted')
    await expect(b.ctx.agents.withInitiator(b.parent, async () => await b.ctx.rpCapabilities.invoke(
      RpCapabilityId('rp.agent.actor'),
      {
        scope: { kind: 'agent', id: 'parent' }, input: { turnId: 'turn-2' },
        grantedPermissions: ['agent:spawn'], grantedTrust: 'L2',
      },
    ))).rejects.toThrow(/ended with aborted/)
    expect(b.events.map(event => event.type)).toEqual([
      'rp/agent-started', 'rp/agent-delegated', 'rp/agent-interrupted',
    ])
    expect(b.disposed).toHaveBeenCalledOnce()
  })

  it('records one terminal interruption when a started child transport rejects', async () => {
    const b = await bench('rejected')
    await expect(b.ctx.agents.withInitiator(b.parent, async () => await b.ctx.rpCapabilities.invoke(
      RpCapabilityId('rp.agent.actor'),
      {
        scope: { kind: 'agent', id: 'parent' }, input: { turnId: 'turn-3' },
        grantedPermissions: ['agent:spawn'], grantedTrust: 'L2',
      },
    ))).rejects.toThrow(/transport failed/)
    expect(b.events.map(event => event.type)).toEqual([
      'rp/agent-started', 'rp/agent-delegated', 'rp/agent-interrupted',
    ])
    expect(b.disposed).toHaveBeenCalledOnce()
  })
})
