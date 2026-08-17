import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  RpComponentId,
  RpPackageId,
  RpPipelineId,
} from '@dsh-rp/contracts'
import RpComponentRegistry from '@dsh-rp/component-runtime'
import RpJournal from '@dsh-rp/journal'
import RpMediaRuntime from '@dsh-rp/media'
import RpPipelineRuntime from '@dsh-rp/pipeline-runtime'
import RpProjectionService from '@dsh-rp/projection'
import RpTurnRuntime from '../src/index.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(RpComponentRegistry)
  await ctx.plugin(RpPipelineRuntime)
  await ctx.plugin(RpJournal)
  await ctx.plugin(RpProjectionService)
  await ctx.plugin(RpMediaRuntime)
  await ctx.plugin(RpTurnRuntime)
  ctx.rpComponents.register({
    id: RpComponentId('actor'), packageId: RpPackageId('rp.actor'), version: '1', trust: 'L2', scopes: ['conversation'],
  })
  ctx.rpPipelines.register({
    id: RpPipelineId('turn.default'), kind: 'turn', version: '1', description: 'Default', trust: 'L0', permissions: [],
    stages: [{ id: 'actor', run: async () => ({ generated: true }) }],
  })
  return ctx
}

const experience = {
  schemaVersion: 1 as const,
  id: 'rp-adaptive',
  name: 'Adaptive',
  components: [RpComponentId('actor')],
  agents: [],
  pipelines: { turn: RpPipelineId('turn.default') },
}

describe('@dsh-rp/turn-runtime', () => {
  it('freezes, executes, and commits a complete turn once', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('turn-commit'))
    const draft = ctx.rpTurn.prepare({
      session, experience, scope: { kind: 'conversation', id: 'c' }, input: 'hello', grantedCapabilities: [],
    })
    const outcome = await ctx.rpTurn.execute(draft, { assistantMessage: 'Hi' })
    const commit = ctx.rpTurn.commit(outcome)
    expect(commit.record.assistantMessage).toBe('Hi')
    expect(commit.record.composition.compositionId).toBe(draft.composition.id)
    expect(commit.record.pipeline.snapshotHash).toBe(draft.pipeline.hash)
    expect(session.events.filter(event => event.type === 'rp/turn-committed')).toHaveLength(1)
    expect(() => ctx.rpTurn.commit(outcome)).toThrow(/already terminal/)
  })

  it('resolves a late-mounted optional preset service at each prepare boundary', async () => {
    const ctx = await setup()
    ctx.provide('rpPresets', {
      capture: () => ({
        schemaVersion: 1,
        id: 'preset:late',
        name: 'Late preset',
        promptDefinitions: [{
          schemaVersion: 1, id: 'main', name: 'Main', role: 'system', content: 'Preset canary', marker: false,
        }],
        promptOrders: [{ id: '100001', entries: [{ identifier: 'main', enabled: true }] }],
        selectedPromptOrderId: '100001',
        prompts: [{ schemaVersion: 1, id: 'main', role: 'system', content: 'Preset canary', priority: 0 }],
        generation: {},
        savedAt: 1,
        snapshotHash: 'b'.repeat(64),
        bindingScope: { kind: 'conversation', id: 'c' },
      }),
    } as unknown as Context['rpPresets'])
    ctx.provide('rpLibrary', {
      capture: () => ({
        schemaVersion: 1,
        characters: [{ schemaVersion: 1, id: 'hero', name: 'Hero', firstMessages: ['Hello'] }],
        personas: [],
        lorebooks: [],
        bindingScopes: { character: { kind: 'conversation', id: 'c' } },
        snapshotHash: 'c'.repeat(64),
      }),
    } as unknown as Context['rpLibrary'])
    const session = Session.create(SessionId('turn-late-preset'))
    const draft = ctx.rpTurn.prepare({
      session, experience, scope: { kind: 'conversation', id: 'c' }, input: 'hello', grantedCapabilities: [],
    })

    expect(draft.context.preset).toMatchObject({
      id: 'preset:late', selectedPromptOrderId: '100001', snapshotHash: 'b'.repeat(64),
    })
    expect(draft.context.library).toMatchObject({
      characters: [{ id: 'hero' }], snapshotHash: 'c'.repeat(64),
    })
    expect(session.events.find(event => event.type === 'rp/context-activated')?.data).toMatchObject({
      context: {
        preset: { id: 'preset:late', snapshotHash: 'b'.repeat(64) },
        library: { characters: [{ id: 'hero' }], snapshotHash: 'c'.repeat(64) },
      },
    })
  })

  it('aborts without publishing a partial commit', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('turn-abort'))
    const draft = ctx.rpTurn.prepare({
      session, experience, scope: { kind: 'conversation', id: 'c' }, input: null, grantedCapabilities: [],
    })
    ctx.rpTurn.abort(draft, 'user stopped')
    expect(session.events.some(event => event.type === 'rp/turn-committed')).toBe(false)
    expect(session.events.some(event => event.type === 'rp/turn-aborted')).toBe(true)
    await expect(ctx.rpTurn.execute(draft, { assistantMessage: 'late' })).rejects.toThrow(/already terminal/)
  })

  it('executes the captured graph after a hot replacement and journals its exact Stages', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('turn-hot-snapshot'))
    const pipelineId = RpPipelineId('turn.hot')
    const releaseOld = ctx.rpPipelines.register({
      id: pipelineId, kind: 'turn', version: '1', description: 'Old', trust: 'L0', permissions: [],
      stages: [{ id: 'old-stage', run: async () => ({ version: 'old' }) }],
    })
    const selected = { ...experience, pipelines: { turn: pipelineId } }
    const draft = ctx.rpTurn.prepare({
      session, experience: selected, scope: { kind: 'conversation', id: 'c' }, input: null, grantedCapabilities: [],
    })
    releaseOld()
    ctx.rpPipelines.register({
      id: pipelineId, kind: 'turn', version: '2', description: 'New', trust: 'L0', permissions: [],
      stages: [{ id: 'new-stage', run: async () => ({ version: 'new' }) }],
    })

    const outcome = await ctx.rpTurn.execute(draft, { assistantMessage: 'old graph won' })
    expect(outcome.pipeline.frame.values).toEqual({ version: 'old' })
    expect(outcome.pipeline.snapshot.hash).toBe(draft.pipeline.hash)
    expect(ctx.rpPipelines.snapshot(pipelineId).hash).not.toBe(draft.pipeline.hash)
    expect(session.events.filter(event => event.type.startsWith('rp/pipeline-')).map(event => event.type)).toEqual([
      'rp/pipeline-started',
      'rp/pipeline-stage',
      'rp/pipeline-completed',
    ])
    expect(session.events.find(event => event.type === 'rp/pipeline-stage')?.data).toMatchObject({
      pipelineId,
      snapshotHash: draft.pipeline.hash,
      stageId: 'old-stage',
    })
  })

  it('rejects empty output and inconsistent state revisions before pipeline execution', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('turn-invalid'))
    const draft = ctx.rpTurn.prepare({
      session, experience, scope: { kind: 'conversation', id: 'c' }, input: null, grantedCapabilities: [],
    })
    await expect(ctx.rpTurn.execute(draft, { assistantMessage: ' ' })).rejects.toMatchObject({ code: 'INVALID_OUTPUT' })
    await expect(ctx.rpTurn.execute(draft, {
      assistantMessage: 'ok',
      statePatch: { baseRevision: 1, owner: 'state', operations: [] },
      state: { schemaVersion: 1, revision: 4, owner: 'state', value: {} },
    })).rejects.toMatchObject({ code: 'INVALID_STATE' })
  })

  it('derives effects from Pipeline output and runs the complete atomic transaction', async () => {
    const ctx = await setup()
    const pipelineId = RpPipelineId('turn.pipeline-effects')
    ctx.rpPipelines.register({
      id: pipelineId, kind: 'turn', version: '1', description: 'Pipeline effects', trust: 'L0', permissions: [],
      stages: [{
        id: 'actor',
        run: (_frame, stage) => ({
          'turn.effects': {
            assistantMessage: 'Pipeline owns the reply.',
            metadata: { runId: stage.runId, turnId: stage.metadata?.turnId ?? null },
          },
        }),
      }],
    })
    const session = Session.create(SessionId('turn-pipeline-effects'))
    const commit = await ctx.rpTurn.run({
      session,
      experience: { ...experience, pipelines: { turn: pipelineId } },
      scope: { kind: 'conversation', id: 'c' },
      input: { text: 'hello' },
      grantedCapabilities: [],
    })

    expect(commit.record.assistantMessage).toBe('Pipeline owns the reply.')
    expect(commit.record.metadata?.turnId).toBe(commit.record.turnId)
    expect(session.events.filter(event => event.type === 'rp/turn-committed')).toHaveLength(1)
    expect(session.events.filter(event => event.type === 'rp/turn-aborted')).toHaveLength(0)
    expect(session.events.find(event => event.type === 'rp/context-activated')?.data).toMatchObject({
      schemaVersion: 1,
      input: { text: 'hello' },
    })
  })

  it('automatically aborts a failed Pipeline without a partial commit', async () => {
    const ctx = await setup()
    const pipelineId = RpPipelineId('turn.no-effects')
    ctx.rpPipelines.register({
      id: pipelineId, kind: 'turn', version: '1', description: 'Missing effects', trust: 'L0', permissions: [],
      stages: [{ id: 'actor', run: () => ({ generated: true }) }],
    })
    const session = Session.create(SessionId('turn-auto-abort'))

    await expect(ctx.rpTurn.run({
      session,
      experience: { ...experience, pipelines: { turn: pipelineId } },
      scope: { kind: 'conversation', id: 'c' },
      input: null,
      grantedCapabilities: [],
    })).rejects.toMatchObject({ code: 'INVALID_OUTPUT' })
    expect(session.events.filter(event => event.type === 'rp/turn-committed')).toHaveLength(0)
    expect(session.events.filter(event => event.type === 'rp/turn-aborted')).toHaveLength(1)
  })

  it('feeds committed effects and dialogue into the next frozen turn context', async () => {
    const ctx = await setup()
    const pipelineId = RpPipelineId('turn.replay-context')
    const seen: unknown[] = []
    ctx.rpPipelines.register({
      id: pipelineId,
      kind: 'turn',
      version: '1',
      description: 'Replay context',
      trust: 'L0',
      permissions: [],
      stages: [{
        id: 'actor',
        run: (_frame, stage) => {
          seen.push(stage.metadata?.turnContext)
          return seen.length === 1
            ? {
              'turn.effects': {
                assistantMessage: 'I will remember.',
                state: { schemaVersion: 1, revision: 0, owner: 'world', value: { weather: 'rain' } },
                memories: [{
                  schemaVersion: 1,
                  id: 'memory-1',
                  owner: 'actor',
                  content: 'It started raining.',
                  salience: 0.8,
                  createdAt: 1,
                }],
                relationships: [{
                  schemaVersion: 1,
                  from: 'actor',
                  to: 'user',
                  revision: 1,
                  dimensions: { trust: 5 },
                }],
                scene: { schemaVersion: 1, id: 'street', title: 'Rainy street', participants: ['actor', 'user'] },
                branch: { id: 'main', active: true, message: 'I will remember.' },
              },
            }
            : { 'turn.effects': { assistantMessage: 'The prior turn is visible.' } }
        },
      }],
    })
    const session = Session.create(SessionId('turn-replay-context'))
    const request = {
      session,
      experience: { ...experience, pipelines: { turn: pipelineId } },
      scope: { kind: 'conversation' as const, id: 'c' },
      grantedCapabilities: [] as string[],
    }
    await ctx.rpTurn.run({ ...request, input: { text: 'Remember this' }, context: { source: 'test' } })
    await ctx.rpTurn.run({ ...request, input: { text: 'What happened?' } })

    expect(seen[1]).toMatchObject({
      schemaVersion: 1,
      supplied: {},
      session: {
        states: [{ owner: 'world', revision: 0, value: { weather: 'rain' } }],
        memories: [{ id: 'memory-1' }],
        relationships: [{ from: 'actor', to: 'user', revision: 1 }],
        scene: { id: 'street' },
        branches: [{ id: 'main', active: true }],
        history: [{ input: { text: 'Remember this' }, assistantMessage: 'I will remember.' }],
      },
    })
    expect(ctx.rpProjection.projectScope(session, request.scope).history).toHaveLength(2)
  })
})
