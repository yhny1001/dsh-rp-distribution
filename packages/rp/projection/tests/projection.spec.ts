import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { RpCompositionId, RpPipelineId, RpTurnId } from '@dsh-rp/contracts'
import type { RpTurnCommitRecord } from '@dsh-rp/journal'
import RpProjectionService, { projectRpScope, projectRpSession } from '../src/index.ts'

function commitRecord(): RpTurnCommitRecord {
  const turnId = RpTurnId('turn-1')
  return {
    schemaVersion: 1,
    turnId,
    composition: {
      turnId,
      compositionId: RpCompositionId('c'.repeat(64)),
      componentIds: ['actor'],
      scope: { kind: 'conversation', id: 'conversation-1' },
    },
    pipeline: {
      turnId,
      pipelineId: RpPipelineId('turn.default'),
      snapshotHash: 'p'.repeat(64),
      kind: 'turn',
    },
    assistantMessage: 'Hello',
    state: { schemaVersion: 1, revision: 1, owner: 'state', value: { mood: 'calm' } },
    memories: [{ schemaVersion: 1, id: 'm1', owner: 'character', content: 'Met the user', salience: 0.8, createdAt: 1 }],
    branch: { id: 'b1', active: true, message: 'Hello' },
    committedAt: 2,
  }
}

describe('@dsh-rp/projection', () => {
  it('reconstructs current state using only durable Session events', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(RpProjectionService)
    const session = Session.create(SessionId('rp-projection'))
    session.append('rp/turn-committed', commitRecord())

    const projection = ctx.rpProjection.project(session)
    expect(projection.state?.value).toEqual({ mood: 'calm' })
    expect(projection.states).toMatchObject([{ owner: 'state', revision: 1 }])
    expect(projection.memories.map(memory => memory.id)).toEqual(['m1'])
    expect(projection.activeBranchId).toBe('b1')

    await fiber.dispose()
    expect(ctx.get('rpProjection')).toBeUndefined()
  })

  it('materializes committed effects and dialogue for one exact scope boundary', () => {
    const session = Session.create(SessionId('rp-scope-projection'))
    const first = commitRecord()
    session.append('rp/context-activated', {
      schemaVersion: 1,
      turnId: first.turnId,
      input: { text: 'Hello there' },
      context: {},
      media: [{
        schemaVersion: 1, id: 'input-image', kind: 'image', mimeType: 'image/png',
        uri: 'attachment:sha256:image',
      }],
    })
    session.append('rp/turn-committed', first)
    const foreignTurnId = RpTurnId('turn-foreign')
    session.append('rp/turn-committed', {
      ...first,
      turnId: foreignTurnId,
      composition: {
        ...first.composition,
        turnId: foreignTurnId,
        scope: { kind: 'conversation', id: 'conversation-2' },
      },
      pipeline: { ...first.pipeline, turnId: foreignTurnId },
      assistantMessage: 'Foreign',
      state: { schemaVersion: 1, revision: 0, owner: 'foreign', value: { hidden: true } },
      memories: [],
      branch: { id: 'foreign', active: true, message: 'Foreign' },
      committedAt: 3,
    })

    const projection = projectRpScope(session.events, { kind: 'conversation', id: 'conversation-1' })
    expect(projection.throughEventSeq).toBe(session.events.at(-1)?.seq)
    expect(projection.states).toMatchObject([{ owner: 'state', revision: 1 }])
    expect(projection.memories.map(memory => memory.id)).toEqual(['m1'])
    expect(projection.branches.map(branch => branch.id)).toEqual(['b1'])
    expect(projection.history).toEqual([{
      turnId: first.turnId,
      input: { text: 'Hello there' },
      media: [{
        schemaVersion: 1, id: 'input-image', kind: 'image', mimeType: 'image/png',
        uri: 'attachment:sha256:image',
      }],
      assistantMessage: 'Hello',
      committedAt: 2,
    }])
    expect(Object.isFrozen(projection.history)).toBe(true)
  })

  it('replays capability authority and settlement by tool-call id', () => {
    const session = Session.create(SessionId('rp-capability-projection'))
    session.append('rp/capability-authorized', {
      schemaVersion: 1,
      callId: 'call-1',
      capabilityId: 'workflow-backend:quickjs-isolated',
      agentId: 'actor',
      scope: { kind: 'agent', id: 'actor' },
      authority: {
        permissions: ['script.execute'], trust: 'L1', budget: { timeoutMs: 200 },
        networkDomains: [], fileRoots: [], layers: ['deployment', 'agent'],
      },
      authorizedAt: 1,
    })
    session.append('rp/capability-settled', {
      schemaVersion: 1,
      callId: 'call-1',
      capabilityId: 'workflow-backend:quickjs-isolated',
      agentId: 'actor',
      status: 'completed',
      finishedAt: 2,
    })
    session.append('rp/capability-settled', {
      schemaVersion: 1,
      callId: 'call-denied',
      capabilityId: 'workflow-backend:native',
      agentId: 'actor',
      status: 'denied',
      error: 'trust ceiling exceeded',
      finishedAt: 3,
    })
    expect(projectRpSession(session.events).capabilityInvocations).toMatchObject([
      { callId: 'call-1', status: 'completed', authorization: { authority: { trust: 'L1' } } },
      { callId: 'call-denied', status: 'denied', error: 'trust ceiling exceeded' },
    ])
  })

  it('reconstructs every RP lifecycle from the Session log', () => {
    const session = Session.create(SessionId('rp-complete-projection'))
    const initial = commitRecord()
    const turnId = RpTurnId('turn-2')
    const pipeline = {
      turnId,
      pipelineId: RpPipelineId('workflow.directed'),
      snapshotHash: 'w'.repeat(64),
      kind: 'workflow' as const,
    }
    const concurrentSidecar = {
      turnId,
      pipelineId: RpPipelineId('sidecar.memory'),
      snapshotHash: 's'.repeat(64),
      kind: 'sidecar' as const,
    }
    session.append('rp/turn-committed', initial)
    session.append('rp/context-activated', {
      schemaVersion: 1,
      turnId,
      input: { text: 'continue' },
      context: { experience: 'rp-directed' },
    })
    session.append('rp/pipeline-started', pipeline)
    session.append('rp/pipeline-started', concurrentSidecar)
    session.append('rp/pipeline-stage', { ...pipeline, stageId: 'director', outcome: 'completed' })
    session.append('rp/pipeline-completed', pipeline)
    session.append('rp/pipeline-completed', concurrentSidecar)
    session.append('rp/agent-started', {
      turnId, agentId: 'child-1', role: 'director', operation: 'started', parentAgentId: 'root',
    })
    session.append('rp/agent-delegated', {
      turnId, agentId: 'child-1', role: 'director', operation: 'delegated', parentAgentId: 'root',
    })
    session.append('rp/agent-completed', {
      turnId, agentId: 'child-1', role: 'director', operation: 'completed', parentAgentId: 'root',
      detail: { stopReason: 'completed' },
    })
    session.append('rp/state-proposed', {
      turnId,
      patch: { baseRevision: 1, owner: 'state', operations: [{ op: 'replace', path: '/mood', value: 'focused' }] },
    })
    session.append('rp/state-committed', {
      turnId,
      state: { schemaVersion: 1, revision: 2, owner: 'state', value: { mood: 'focused' } },
    })
    session.append('rp/branch-created', {
      turnId,
      branch: { id: 'b2', parentId: 'b1', active: false, message: 'Alternate' },
    })
    session.append('rp/branch-activated', { turnId, branchId: 'b2' })
    const memory = {
      schemaVersion: 1 as const,
      id: 'm2',
      owner: 'character',
      content: 'The director chose the alternate branch.',
      salience: 0.7,
      createdAt: 3,
    }
    session.append('rp/memory-proposed', { turnId, memory })
    session.append('rp/memory-accepted', { turnId, memory })
    session.append('rp/memory-compacted', { turnId, memoryIds: ['m1'], summary: 'The first meeting was summarized.' })
    session.append('rp/media-requested', { turnId, request: { kind: 'portrait' } })
    session.append('rp/media-completed', { turnId, artifact: { id: 'portrait-1', mime: 'image/png' } })

    const projection = projectRpSession(session.events)
    expect(projection.contexts).toEqual([{
      schemaVersion: 1,
      turnId,
      input: { text: 'continue' },
      context: { experience: 'rp-directed' },
    }])
    expect(projection.pipelines).toMatchObject([
      { pipelineId: 'turn.default', status: 'completed' },
      { pipelineId: 'workflow.directed', status: 'completed', stages: [{ stageId: 'director' }] },
      { pipelineId: 'sidecar.memory', status: 'completed', stages: [] },
    ])
    expect(projection.agents).toMatchObject([{
      agentId: 'child-1', role: 'director', delegated: true, status: 'completed',
    }])
    expect(projection.stateChanges.at(-1)).toMatchObject({ turnId, status: 'committed', state: { revision: 2 } })
    expect(projection.activeBranchId).toBe('b2')
    expect(projection.branches).toMatchObject([{ id: 'b1', active: false }, { id: 'b2', active: true }])
    expect(projection.memories.map(item => item.id)).toEqual(['m2'])
    expect(projection.memoryCompactions).toEqual([{
      turnId, memoryIds: ['m1'], summary: 'The first meeting was summarized.',
    }])
    expect(projection.media).toMatchObject([{
      turnId, status: 'completed', request: { kind: 'portrait' }, artifact: { id: 'portrait-1' },
    }])
  })

  it('rejects unmatched lifecycle terminals instead of inventing missing history', () => {
    const session = Session.create(SessionId('rp-invalid-lifecycle'))
    session.append('rp/agent-completed', {
      turnId: RpTurnId('turn-invalid'),
      agentId: 'missing',
      role: 'actor',
      operation: 'completed',
    })
    expect(() => projectRpSession(session.events)).toThrow(/without one open start/)
  })

  it('rejects a log with duplicate terminal events for one turn', () => {
    const record = commitRecord()
    const session = Session.create(SessionId('rp-duplicate'))
    session.append('rp/turn-committed', record)
    session.append('rp/turn-aborted', {
      schemaVersion: 1,
      turnId: record.turnId,
      reason: 'stopped',
      abortedAt: 3,
    })

    expect(() => projectRpSession(session.events)).toThrow(/more than one terminal event/)
  })
})
