import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Inbox } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import { RpCapabilityId } from '@dsh-rp/contracts'
import RpPolicyRuntime from '@dsh-rp/policy'
import * as ToolCapability from '../src/index.ts'

function stubAgent(id: string): Agent {
  const session = Session.create(SessionId(id))
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

describe('@dsh-rp/tool-capability', () => {
  it('lets an Agent discover and invoke only configured authority and journals the decision', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPolicyRuntime)
    ctx.rpCapabilities.register({
      descriptor: {
        id: RpCapabilityId('workflow-backend:fixture'), kind: 'pipeline', version: '1',
        title: 'Fixture sandbox', description: 'Test L1 backend.', trust: 'L1', scopes: ['agent'],
        permissions: ['script.execute'],
      },
      invoke: request => Promise.resolve({ trust: request.effectiveAuthority.trust, input: request.input }),
    })
    const fiber = await ctx.plugin(ToolCapability, {
      maxTrust: 'L1', permissions: ['script.execute'], timeoutMs: 200,
    })
    const agent = stubAgent('rp-capability-agent')
    const signal = new AbortController().signal
    const listed = await ctx.tools.execute({
      signal, callId: CallId('list'), name: 'rp_capability', arguments: { action: 'list' }, agent,
    })
    expect(listed.isError).toBe(false)
    expect(listed.isError ? null : listed.value).toMatchObject([{ id: 'workflow-backend:fixture', trust: 'L1' }])

    const invoked = await ctx.tools.execute({
      signal, callId: CallId('invoke'), name: 'rp_capability',
      arguments: { action: 'invoke', capability_id: 'workflow-backend:fixture', input: { value: 42 } },
      agent,
    })
    expect(invoked.isError).toBe(false)
    expect(invoked.isError ? null : invoked.value).toEqual({ trust: 'L1', input: { value: 42 } })
    expect(agent.session.events.filter(event => event.type.startsWith('rp/capability-')).map(event => event.type))
      .toEqual(['rp/capability-authorized', 'rp/capability-settled'])
    expect(agent.session.events.find(event => event.type === 'rp/capability-authorized')?.data)
      .toMatchObject({ capabilityId: 'workflow-backend:fixture', authority: { trust: 'L1' } })

    ctx.rpPolicy.register({ name: 'deny-script', permissions: [] })
    const denied = await ctx.tools.execute({
      signal, callId: CallId('denied'), name: 'rp_capability',
      arguments: { action: 'invoke', capability_id: 'workflow-backend:fixture', input: null },
      agent,
    })
    expect(denied.isError).toBe(true)
    expect(agent.session.events.find(event =>
      event.type === 'rp/capability-settled' && event.data.callId === 'denied')?.data)
      .toMatchObject({ status: 'denied' })
    await fiber.dispose()
    expect(ctx.tools.get('rp_capability')).toBeUndefined()
  })
})
