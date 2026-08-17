import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import RpAgentRuntime from '@dsh-rp/agent-runtime'
import RpBranchRuntime from '@dsh-rp/branches'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import RpCharacterRuntime from '@dsh-rp/character'
import RpComponentRegistry from '@dsh-rp/component-runtime'
import RpExperienceRegistry from '@dsh-rp/experience-registry'
import * as FirstParty from '@dsh-rp/first-party'
import RpJournal from '@dsh-rp/journal'
import RpLoreRuntime from '@dsh-rp/lore'
import RpMediaRuntime from '@dsh-rp/media'
import RpMediaInputAttachment from '@dsh-rp/media-input-attachment'
import RpMemoryBasic from '@dsh-rp/memory-basic'
import RpOutbox from '@dsh-rp/outbox'
import RpPersonaRuntime from '@dsh-rp/persona'
import RpPipelineRuntime from '@dsh-rp/pipeline-runtime'
import RpPolicyRuntime from '@dsh-rp/policy'
import RpProjectionService from '@dsh-rp/projection'
import RpPromptRuntime from '@dsh-rp/prompt'
import RpRegistry from '@dsh-rp/registry'
import RpRelationshipRuntime from '@dsh-rp/relationship'
import RpRulesRuntime from '@dsh-rp/rules'
import RpSceneRuntime from '@dsh-rp/scene'
import RpStateRuntime from '@dsh-rp/state'
import RpTurnRuntime from '@dsh-rp/turn-runtime'
import RpUiSlotRegistry from '@dsh-rp/ui-slot-runtime'
import RpWorkflowRouter from '@dsh-rp/workflow-router'
import { executeRpTurn, type RpWebTurnApiConfig } from '../src/turn-api.ts'
import * as RpWeb from '../src/index.ts'

const deployment: RpWebTurnApiConfig = Object.freeze({
  enabled: true,
  defaultExperience: 'rp-adaptive',
  allowedExperiences: Object.freeze(['rp-adaptive', 'rp-fast']),
  permissions: Object.freeze(['rp.pipeline.execute', 'agent:spawn', 'attachment.write']),
  maxTrust: 'L2',
  grantedCapabilities: Object.freeze([]),
  budget: Object.freeze({ timeoutMs: 60_000, maxTokens: 4_096, maxToolCalls: 8, maxAgents: 2 }),
  networkDomains: Object.freeze([]),
  fileRoots: Object.freeze([]),
  maxRequestBytes: 256 * 1024,
})

class TestAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = Object.freeze({
    maxImageBytes: 1024,
    maxImagesPerMessage: 2,
    maxMessageImageBytes: 2048,
    maxImagePixels: 100,
    mediaTypes: Object.freeze(['image/png'] as const),
  })
  readonly saved: SaveImageAttachment[] = []

  validateImage(): Promise<void> { return Promise.resolve() }
  saveImage(input: SaveImageAttachment) {
    this.saved.push(input)
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...(input.name === undefined ? {} : { name: input.name }),
    })
  }
  readImage(): Promise<never> { return Promise.reject(new Error('unused')) }
}

async function runtime(
  provider: Parameters<Context['rpAgents']['registerProvider']>[0]['run'],
  durable = true,
) {
  const ctx = new Context()
  await ctx.plugin(TestAttachmentStore)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(RpComponentRegistry)
  await ctx.plugin(RpCapabilityCatalog)
  await ctx.plugin(RpPolicyRuntime)
  await ctx.plugin(RpAgentRuntime)
  await ctx.plugin(RpPipelineRuntime)
  await ctx.plugin(RpExperienceRegistry)
  await ctx.plugin(RpStateRuntime)
  await ctx.plugin(RpMemoryBasic)
  await ctx.plugin(RpCharacterRuntime)
  await ctx.plugin(RpPersonaRuntime)
  await ctx.plugin(RpLoreRuntime)
  await ctx.plugin(RpPromptRuntime)
  await ctx.plugin(RpBranchRuntime)
  await ctx.plugin(RpRegistry)
  await ctx.plugin(RpWorkflowRouter)
  await ctx.plugin(RpOutbox)
  await ctx.plugin(RpSceneRuntime)
  await ctx.plugin(RpRelationshipRuntime)
  await ctx.plugin(RpRulesRuntime)
  await ctx.plugin(RpMediaRuntime)
  await ctx.plugin(RpMediaInputAttachment)
  await ctx.plugin(RpJournal)
  await ctx.plugin(RpProjectionService)
  await ctx.plugin(RpTurnRuntime)
  ctx.rpAgents.registerProvider({ id: 'web-turn-test', supports: () => true, run: provider })
  await ctx.plugin(FirstParty)
  const session = ctx.sessions.create(SessionId('web-turn-session'))
  let maintenance = false
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted() {}, discarded() {}, claimed() {} }),
    status: 'idle',
    ctx,
    send() {},
    followup() {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject() {},
    cancel() {},
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (maintenance) throw new Error(`agent "${session.id}" already has active work`)
      maintenance = true
      return task(new AbortController().signal).finally(() => { maintenance = false })
    },
    whenIdle: async () => {},
  }
  ctx.agents.register(agent)
  if (durable) ctx.on('session/flush', () => {})
  return { ctx, agent, session }
}

function request(requestId: string, input = 'Open the observatory door') {
  return {
    schemaVersion: 1,
    requestId,
    sessionId: 'web-turn-session',
    agentId: 'web-turn-session',
    experienceId: 'rp-fast',
    input: { text: input },
    context: { client: 'test' },
  }
}

describe('RP Headless/Web Turn API', () => {
  it('runs under the exact live initiator, flushes one commit, and idempotently replays it', async () => {
    let calls = 0
    const inputs: unknown[] = []
    const { ctx, session } = await runtime(async (call) => {
      calls += 1
      inputs.push(call.invocation.input)
      expect(ctx.agents.requireInitiator()).toBe(ctx.agents.get(SessionId('web-turn-session')))
      return { value: { assistantMessage: `Reply ${calls}` } }
    })

    const first = await executeRpTurn(ctx, request('request-1'), deployment)
    expect(first).toMatchObject({
      requestId: 'request-1', replayed: false, assistantMessage: 'Reply 1', experienceId: 'rp-fast',
      authority: { trust: 'L2', permissions: ['agent:spawn', 'attachment.write', 'rp.pipeline.execute'] },
      projection: { history: [{ assistantMessage: 'Reply 1' }] },
    })
    const replay = await executeRpTurn(ctx, request('request-1'), deployment)
    expect(replay).toMatchObject({
      requestId: 'request-1', replayed: true, turnId: first.turnId, eventSeq: first.eventSeq,
      assistantMessage: 'Reply 1',
    })
    expect(calls).toBe(1)
    expect(session.events.filter(event => event.type === 'rp/turn-committed')).toHaveLength(1)
    expect(session.events.filter(event => event.type === 'user/message').map(event => event.data.content))
      .toMatchObject([[{ type: 'text', text: 'Open the observatory door' }]])
    expect(session.events.filter(event => event.type === 'assistant/message').map(event => event.data.message))
      .toMatchObject([{ content: [{ type: 'text', text: 'Reply 1' }], source: { provider: 'dsh-rp', model: 'rp-fast' } }])

    await executeRpTurn(ctx, request('request-2', 'What happened next?'), deployment)
    expect(calls).toBe(2)
    expect(inputs.at(-1)).toMatchObject({
      context: { history: [{ input: { text: 'Open the observatory door' }, assistantMessage: 'Reply 1' }] },
    })
    expect(session.events.filter(event => event.type === 'turn/start').map(event => event.data.turn)).toEqual([1, 2])
    await ctx.fiber.dispose()
  })

  it('ingests image bytes once, journals only durable references, and replays without another write', async () => {
    const calls: unknown[] = []
    const { ctx, session } = await runtime((call) => {
      calls.push(call.invocation.input)
      return Promise.resolve({ value: { assistantMessage: 'I can see the scene.' } })
    })
    const withImage = {
      ...request('media-input'),
      media: [{
        schemaVersion: 1,
        kind: 'image',
        mediaType: 'image/png',
        data: 'AQ==',
        name: 'scene.png',
      }],
    }
    const first = await executeRpTurn(ctx, withImage, deployment)
    expect(first.assistantMessage).toBe('I can see the scene.')
    expect(calls[0]).toMatchObject({
      media: [{ metadata: { inputAdapter: 'dsh-attachment' } }],
      content: [{ type: 'image', attachment: { mediaType: 'image/png', name: 'scene.png' } }],
    })
    const activated = session.events.find(event => event.type === 'rp/context-activated')
    expect(activated?.data).toMatchObject({
      media: [{ uri: `attachment:sha256:${'a'.repeat(64)}` }],
      content: [{ type: 'image', attachment: { attachmentId: `sha256:${'a'.repeat(64)}` } }],
    })
    expect(JSON.stringify(activated)).not.toContain('AQ==')
    expect((ctx.attachments as TestAttachmentStore).saved).toHaveLength(1)
    await expect(executeRpTurn(ctx, withImage, deployment)).resolves.toMatchObject({ replayed: true })
    expect((ctx.attachments as TestAttachmentStore).saved).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('rejects client authority, identity mismatch, payload drift, and denied deployment trust', async () => {
    let calls = 0
    const { ctx } = await runtime(async () => {
      calls += 1
      return { value: { assistantMessage: 'accepted' } }
    })
    await expect(executeRpTurn(ctx, { ...request('authority'), authority: { maxTrust: 'L2' } }, deployment))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(executeRpTurn(ctx, { ...request('identity'), agentId: 'another-agent' }, deployment))
      .rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(executeRpTurn(ctx, {
      ...request('scope-escape'),
      scope: { kind: 'deployment', id: 'global' },
    }, deployment)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(executeRpTurn(ctx, request('oversized', 'x'.repeat(2_000)), {
      ...deployment,
      maxRequestBytes: 1_024,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    let accessorInvoked = false
    const accessorRequest = request('accessor')
    Object.defineProperty(accessorRequest, 'input', {
      enumerable: true,
      get() {
        accessorInvoked = true
        return { text: 'must not execute' }
      },
    })
    await expect(executeRpTurn(ctx, accessorRequest, deployment))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(accessorInvoked).toBe(false)
    await executeRpTurn(ctx, request('stable'), deployment)
    await expect(executeRpTurn(ctx, request('stable', 'different payload'), deployment))
      .rejects.toMatchObject({ code: 'CONFLICT' })
    const release = ctx.rpPolicy.register({ name: 'deployment-low-trust', maxTrust: 'L1' })
    await expect(executeRpTurn(ctx, request('denied'), deployment))
      .rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    release()
    expect(calls).toBe(1)
    await ctx.fiber.dispose()
  })

  it('rejects concurrent work and records cancellation without a partial commit', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let calls = 0
    const { ctx, session } = await runtime(async (call) => {
      calls += 1
      if (calls === 1) await gate
      else await new Promise<never>((_resolve, reject) => {
        const signal = call.invocation.signal
        if (signal?.aborted === true) reject(new Error('test operation cancelled'))
        else signal?.addEventListener('abort', () => { reject(new Error('test operation cancelled')) }, { once: true })
      })
      return { value: { assistantMessage: 'after gate' } }
    })
    const first = executeRpTurn(ctx, request('concurrent-1'), deployment)
    await Promise.resolve()
    await expect(executeRpTurn(ctx, request('concurrent-2'), deployment))
      .rejects.toMatchObject({ code: 'BUSY' })
    release()
    await expect(first).resolves.toMatchObject({ assistantMessage: 'after gate' })

    const controller = new AbortController()
    const cancelled = executeRpTurn(ctx, request('cancelled'), deployment, controller.signal)
    await Promise.resolve()
    controller.abort('client-left')
    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(session.events.filter(event => event.type === 'rp/turn-committed')).toHaveLength(1)
    expect(session.events.filter(event => event.type === 'rp/turn-aborted')).toHaveLength(1)
    await expect(executeRpTurn(ctx, request('cancelled'), deployment))
      .rejects.toMatchObject({ code: 'CONFLICT' })
    await ctx.fiber.dispose()
  })

  it('requires a real durability participant and replays the same committed request after recovery', async () => {
    let calls = 0
    const { ctx, session } = await runtime(async () => {
      calls += 1
      return { value: { assistantMessage: 'durability reply' } }
    }, false)
    await expect(executeRpTurn(ctx, request('durability'), deployment))
      .rejects.toMatchObject({ code: 'DURABILITY' })
    expect(session.events.filter(event => event.type === 'rp/turn-committed')).toHaveLength(1)

    ctx.on('session/flush', () => {})
    await expect(executeRpTurn(ctx, request('durability'), deployment))
      .resolves.toMatchObject({ replayed: true, assistantMessage: 'durability reply' })
    expect(calls).toBe(1)
    await ctx.fiber.dispose()
  })

  it('serves the same contract over HTTP with bearer, origin, and route-lifecycle enforcement', async () => {
    const { ctx, session } = await runtime(async () => ({ value: { assistantMessage: 'HTTP reply' } }))
    await ctx.plugin(RpUiSlotRegistry)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const web = await ctx.plugin(RpWeb, {
      turnApi: {
        bearerToken: 'deployment-secret',
        defaultExperience: 'rp-fast',
        allowedExperiences: ['rp-fast'],
      },
    })
    const url = `http://127.0.0.1:${ctx.httpServer.port}/api/rp/v1/turn`
    const post = async (headers: Record<string, string> = {}) => await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(request('http-request')),
    })
    const unauthenticated = await post()
    expect(unauthenticated.status).toBe(403)
    await expect(unauthenticated.json()).resolves.toMatchObject({ error: { code: 'ACCESS_DENIED' } })
    const crossOrigin = await post({ authorization: 'Bearer deployment-secret', origin: 'https://attacker.invalid' })
    expect(crossOrigin.status).toBe(403)
    const invalidContentType = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer deployment-secret', 'content-type': 'text/plain' },
      body: '{}',
    })
    expect(invalidContentType.status).toBe(400)
    await expect(invalidContentType.json()).resolves.toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    const committed = await post({ authorization: 'Bearer deployment-secret' })
    const committedBody: unknown = await committed.json()
    expect(session.events.filter(event => event.type === 'rp/turn-aborted')).toEqual([])
    expect(session.events.filter(event => event.type === 'rp/turn-committed')).toHaveLength(1)
    expect(committedBody).toMatchObject({
      requestId: 'http-request', assistantMessage: 'HTTP reply', replayed: false,
    })
    expect(committed.status).toBe(200)
    await web.dispose()
    expect((await post({ authorization: 'Bearer deployment-secret' })).status).toBe(404)
    await ctx.fiber.dispose()
  })

  it('fails loud on inconsistent deployment configuration', async () => {
    const { ctx } = await runtime(async () => ({ value: { assistantMessage: 'unused' } }))
    await ctx.plugin(RpUiSlotRegistry)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await expect(ctx.plugin(RpWeb, {
      turnApi: { defaultExperience: 'rp-fast', allowedExperiences: ['rp-adaptive'] },
    })).rejects.toThrow(/defaultExperience must appear/)
    await expect(ctx.plugin(RpWeb, {
      turnApi: { bearerToken: 'short' },
    })).rejects.toThrow(/between 16 and 4096/)
    await ctx.fiber.dispose()
  })
})
