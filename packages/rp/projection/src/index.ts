/** Pure and service-backed projection of durable RP turn commits. @module @dsh-rp/projection */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  JsonObject,
  JsonValue,
  MediaArtifact,
  MemoryEvent,
  RelationshipIR,
  RpScopeRef,
  RpTurnId,
  SceneIR,
  StateDocument,
  StatePatch,
} from '@dsh-rp/contracts'
import type {
  RpAgentRecord,
  RpBranchRecord,
  RpCapabilityAuthorizedRecord,
  RpCompositionRecord,
  RpContextRecord,
  RpPipelineRecord,
  RpTurnAbortRecord,
  RpTurnCommitRecord,
} from '@dsh-rp/journal'

/** Replay view of one Agent-requested capability invocation. */
export interface RpCapabilityInvocationProjection {
  readonly callId: string
  readonly capabilityId: string
  readonly agentId: string
  readonly status: 'authorized' | 'completed' | 'failed' | 'denied'
  readonly authorization?: RpCapabilityAuthorizedRecord
  readonly error?: string
  readonly finishedAt?: number
}

/** Replayed lifecycle of one exact frozen Pipeline execution. */
export interface RpPipelineExecutionProjection extends RpPipelineRecord {
  readonly status: 'running' | 'completed' | 'failed'
  readonly stages: readonly {
    readonly stageId: string
    readonly outcome: 'completed' | 'continued'
  }[]
  readonly error?: string
}

/** Replayed lifecycle of one concrete delegated RP Agent. */
export interface RpAgentExecutionProjection {
  readonly turnId: RpTurnId
  readonly agentId: string
  readonly role: string
  readonly parentAgentId?: string
  readonly status: 'running' | 'completed' | 'interrupted'
  readonly delegated: boolean
  readonly detail?: JsonObject
  readonly history: readonly RpAgentRecord[]
}

/** Replayed proposal and terminal validation result for one turn's state. */
export interface RpStateChangeProjection {
  readonly turnId: RpTurnId
  readonly status: 'proposed' | 'committed' | 'rejected'
  readonly patch?: StatePatch
  readonly state?: StateDocument
  readonly reason?: string
}

/** Durable memory-compaction fact after its source memories leave the live projection. */
export interface RpMemoryCompactionProjection {
  readonly turnId: RpTurnId
  readonly memoryIds: readonly string[]
  readonly summary: string
}

/** Replayed external media lifecycle owned by one turn. */
export interface RpMediaExecutionProjection {
  readonly turnId: RpTurnId
  readonly status: 'requested' | 'completed' | 'failed'
  readonly request: JsonObject
  readonly artifact?: JsonValue
  readonly error?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    rpProjection: RpProjectionService
  }
}

/** Reconstructed RP state after folding the full Session log. */
export interface RpSessionProjection {
  readonly turns: readonly RpTurnCommitRecord[]
  readonly aborted: readonly RpTurnAbortRecord[]
  readonly compositions: readonly RpCompositionRecord[]
  readonly contexts: readonly RpContextRecord[]
  readonly pipelines: readonly RpPipelineExecutionProjection[]
  readonly agents: readonly RpAgentExecutionProjection[]
  /** Current state documents keyed by owner; `state` remains the latest-write compatibility view. */
  readonly states: readonly StateDocument[]
  readonly state?: StateDocument
  readonly stateChanges: readonly RpStateChangeProjection[]
  readonly memories: readonly MemoryEvent[]
  readonly memoryProposals: readonly { readonly turnId: RpTurnId; readonly memory: MemoryEvent }[]
  readonly memoryCompactions: readonly RpMemoryCompactionProjection[]
  readonly relationships: readonly RelationshipIR[]
  readonly scene?: SceneIR
  readonly branches: readonly RpBranchRecord[]
  readonly activeBranchId?: string
  readonly media: readonly RpMediaExecutionProjection[]
  readonly capabilityInvocations: readonly RpCapabilityInvocationProjection[]
}

/** One committed conversational exchange reconstructed without retaining nested prior snapshots. */
export interface RpTurnHistoryProjection {
  readonly turnId: RpTurnId
  readonly input: JsonValue
  readonly media?: readonly MediaArtifact[]
  readonly assistantMessage: string
  readonly committedAt: number
}

/** Authoritative live context for one exact RP scope at one Session event boundary. */
export interface RpScopeProjection {
  readonly schemaVersion: 1
  readonly scope: RpScopeRef
  readonly throughEventSeq: number
  readonly states: readonly StateDocument[]
  readonly memories: readonly MemoryEvent[]
  readonly relationships: readonly RelationshipIR[]
  readonly scene?: SceneIR
  readonly branches: readonly RpBranchRecord[]
  readonly activeBranchId?: string
  readonly history: readonly RpTurnHistoryProjection[]
}

/**
 * Fold durable commits and aborts without process-local state.
 * @param events - Complete ordered Session log.
 * @returns Detached immutable RP projection.
 */
export function projectRpSession(events: readonly SessionEvent[]): RpSessionProjection {
  const turns: RpTurnCommitRecord[] = []
  const aborted: RpTurnAbortRecord[] = []
  const compositions = new Map<RpTurnId, RpCompositionRecord>()
  const contexts = new Map<RpTurnId, RpContextRecord>()
  const pipelines = new Map<string, RpPipelineExecutionProjection>()
  const agents = new Map<string, RpAgentExecutionProjection>()
  const stateChanges = new Map<RpTurnId, RpStateChangeProjection>()
  const memories = new Map<string, MemoryEvent>()
  const memoryProposals = new Map<string, { readonly turnId: RpTurnId; readonly memory: MemoryEvent }>()
  const memoryCompactions: RpMemoryCompactionProjection[] = []
  const relationships = new Map<string, RelationshipIR>()
  const branches = new Map<string, RpBranchRecord>()
  const media = new Map<RpTurnId, RpMediaExecutionProjection>()
  const terminal = new Set<RpTurnId>()
  const capabilityInvocations = new Map<string, RpCapabilityInvocationProjection>()
  const states = new Map<string, StateDocument>()
  let state: StateDocument | undefined
  let scene: SceneIR | undefined
  let activeBranchId: string | undefined

  for (const event of events) {
    if (event.type === 'rp/capability-authorized') {
      const record = event.data
      if (capabilityInvocations.has(record.callId)) {
        throw new Error(`RP capability call ${JSON.stringify(record.callId)} was authorized more than once`)
      }
      capabilityInvocations.set(record.callId, Object.freeze({
        callId: record.callId,
        capabilityId: record.capabilityId,
        agentId: record.agentId,
        status: 'authorized',
        authorization: record,
      }))
    } else if (event.type === 'rp/capability-settled') {
      const record = event.data
      const current = capabilityInvocations.get(record.callId)
      if (current === undefined && record.status === 'denied') {
        capabilityInvocations.set(record.callId, Object.freeze({
          callId: record.callId,
          capabilityId: record.capabilityId,
          agentId: record.agentId,
          status: 'denied',
          ...(record.error === undefined ? {} : { error: record.error }),
          finishedAt: record.finishedAt,
        }))
        continue
      }
      if (current === undefined || current.status !== 'authorized') {
        throw new Error(`RP capability call ${JSON.stringify(record.callId)} settled without one open authorization`)
      }
      if (current.capabilityId !== record.capabilityId || current.agentId !== record.agentId) {
        throw new Error(`RP capability call ${JSON.stringify(record.callId)} settled with a different owner or capability`)
      }
      capabilityInvocations.set(record.callId, Object.freeze({
        callId: record.callId,
        capabilityId: record.capabilityId,
        agentId: record.agentId,
        status: record.status,
        ...(current.authorization === undefined ? {} : { authorization: current.authorization }),
        ...(record.error === undefined ? {} : { error: record.error }),
        finishedAt: record.finishedAt,
      }))
    } else if (event.type === 'rp/composition-resolved') {
      putStable(compositions, event.data.turnId, event.data, 'composition')
    } else if (event.type === 'rp/context-activated') {
      putStable(contexts, event.data.turnId, event.data, 'context')
    } else if (event.type === 'rp/pipeline-started') {
      const key = pipelineKey(event.data)
      if (pipelines.has(key)) throw new Error(`RP pipeline execution ${JSON.stringify(key)} started more than once`)
      pipelines.set(key, pipelineProjection(event.data, 'running'))
    } else if (event.type === 'rp/pipeline-stage') {
      const key = pipelineKey(event.data)
      const pipeline = pipelines.get(key)
      if (pipeline?.status !== 'running') {
        throw new Error(`RP pipeline stage ${JSON.stringify(event.data.stageId)} has no matching open execution`)
      }
      if (pipeline.stages.some(stage => stage.stageId === event.data.stageId)) {
        throw new Error(`RP pipeline stage ${JSON.stringify(event.data.stageId)} settled more than once`)
      }
      pipelines.set(key, Object.freeze({
        ...pipeline,
        stages: Object.freeze([...pipeline.stages, Object.freeze({
          stageId: event.data.stageId,
          outcome: event.data.outcome,
        })]),
      }))
    } else if (event.type === 'rp/pipeline-completed' || event.type === 'rp/pipeline-failed') {
      settlePipeline(pipelines, event.data, event.type === 'rp/pipeline-completed' ? 'completed' : 'failed')
    } else if (event.type === 'rp/agent-started') {
      startAgent(agents, event.data)
    } else if (event.type === 'rp/agent-delegated') {
      updateAgent(agents, event.data, 'running', true)
    } else if (event.type === 'rp/agent-completed') {
      updateAgent(agents, event.data, 'completed')
    } else if (event.type === 'rp/agent-interrupted') {
      updateAgent(agents, event.data, 'interrupted')
    } else if (event.type === 'rp/state-proposed') {
      if (stateChanges.has(event.data.turnId)) throw new Error(`RP state for turn ${JSON.stringify(event.data.turnId)} was proposed more than once`)
      stateChanges.set(event.data.turnId, Object.freeze({
        turnId: event.data.turnId,
        status: 'proposed',
        patch: event.data.patch,
      }))
    } else if (event.type === 'rp/state-committed') {
      const current = requireStateProposal(stateChanges, event.data.turnId, 'commit')
      state = event.data.state
      states.set(state.owner, state)
      stateChanges.set(event.data.turnId, Object.freeze({ ...current, status: 'committed', state }))
    } else if (event.type === 'rp/state-rejected') {
      const current = requireStateProposal(stateChanges, event.data.turnId, 'reject')
      stateChanges.set(event.data.turnId, Object.freeze({
        ...current,
        status: 'rejected',
        reason: event.data.reason,
      }))
    } else if (event.type === 'rp/branch-created') {
      if (branches.has(event.data.branch.id)) throw new Error(`RP branch ${JSON.stringify(event.data.branch.id)} was created more than once`)
      branches.set(event.data.branch.id, event.data.branch)
      if (event.data.branch.active) activeBranchId = activateBranch(branches, event.data.branch.id)
    } else if (event.type === 'rp/branch-activated') {
      activeBranchId = activateBranch(branches, event.data.branchId)
    } else if (event.type === 'rp/branch-removed') {
      if (!branches.delete(event.data.branchId)) throw new Error(`RP branch ${JSON.stringify(event.data.branchId)} was removed before creation`)
      if (activeBranchId === event.data.branchId) activeBranchId = undefined
    } else if (event.type === 'rp/memory-proposed') {
      const key = memoryKey(event.data.turnId, event.data.memory.id)
      if (memoryProposals.has(key)) throw new Error(`RP memory proposal ${JSON.stringify(key)} was repeated`)
      memoryProposals.set(key, event.data)
    } else if (event.type === 'rp/memory-accepted') {
      const key = memoryKey(event.data.turnId, event.data.memory.id)
      if (!memoryProposals.delete(key)) throw new Error(`RP memory ${JSON.stringify(key)} was accepted without a proposal`)
      memories.set(event.data.memory.id, event.data.memory)
    } else if (event.type === 'rp/memory-compacted') {
      for (const id of event.data.memoryIds) {
        if (!memories.delete(id)) throw new Error(`RP memory ${JSON.stringify(id)} was compacted before acceptance`)
      }
      memoryCompactions.push(Object.freeze({
        turnId: event.data.turnId,
        memoryIds: Object.freeze([...event.data.memoryIds]),
        summary: event.data.summary,
      }))
    } else if (event.type === 'rp/media-requested') {
      if (media.has(event.data.turnId)) throw new Error(`RP media for turn ${JSON.stringify(event.data.turnId)} was requested more than once`)
      media.set(event.data.turnId, Object.freeze({
        turnId: event.data.turnId,
        status: 'requested',
        request: event.data.request,
      }))
    } else if (event.type === 'rp/media-completed') {
      settleMedia(media, event.data.turnId, { status: 'completed', artifact: event.data.artifact })
    } else if (event.type === 'rp/media-failed') {
      settleMedia(media, event.data.turnId, { status: 'failed', error: event.data.error })
    } else if (event.type === 'rp/turn-committed') {
      const record = event.data
      if (terminal.has(record.turnId)) throw new Error(`RP turn ${JSON.stringify(record.turnId)} has more than one terminal event`)
      terminal.add(record.turnId)
      turns.push(record)
      putStable(compositions, record.turnId, record.composition, 'composition')
      const committedPipeline = pipelines.get(pipelineKey(record.pipeline))
      if (committedPipeline === undefined) {
        pipelines.set(pipelineKey(record.pipeline), pipelineProjection(record.pipeline, 'completed'))
      } else if (committedPipeline.status === 'running') {
        pipelines.set(pipelineKey(record.pipeline), Object.freeze({ ...committedPipeline, status: 'completed' }))
      } else if (committedPipeline.status !== 'completed') {
        throw new Error(`RP turn ${JSON.stringify(record.turnId)} committed before its Pipeline completed`)
      }
      for (const agent of record.agentTrace ?? []) upsertCommittedAgent(agents, agent)
      if (record.state !== undefined) {
        state = record.state
        states.set(state.owner, state)
      }
      if (record.state !== undefined || record.statePatch !== undefined) {
        const current = stateChanges.get(record.turnId)
        if (current !== undefined && current.status === 'rejected') {
          throw new Error(`RP turn ${JSON.stringify(record.turnId)} committed rejected state`)
        }
        stateChanges.set(record.turnId, Object.freeze({
          turnId: record.turnId,
          status: 'committed',
          ...(record.statePatch === undefined ? {} : { patch: record.statePatch }),
          ...(record.state === undefined ? {} : { state: record.state }),
        }))
      }
      for (const memory of record.memories ?? []) {
        memoryProposals.delete(memoryKey(record.turnId, memory.id))
        memories.set(memory.id, memory)
      }
      for (const relationship of record.relationships ?? []) {
        relationships.set(`${relationship.from}\u0000${relationship.to}`, relationship)
      }
      if (record.scene !== undefined) scene = record.scene
      if (record.branch !== undefined) {
        branches.set(record.branch.id, record.branch)
        if (record.branch.active) activeBranchId = activateBranch(branches, record.branch.id)
      }
    } else if (event.type === 'rp/turn-aborted') {
      const record = event.data
      if (terminal.has(record.turnId)) throw new Error(`RP turn ${JSON.stringify(record.turnId)} has more than one terminal event`)
      terminal.add(record.turnId)
      aborted.push(record)
    }
  }

  return Object.freeze({
    turns: Object.freeze([...turns]),
    aborted: Object.freeze([...aborted]),
    compositions: Object.freeze([...compositions.values()]),
    contexts: Object.freeze([...contexts.values()]),
    pipelines: Object.freeze([...pipelines.values()]),
    agents: Object.freeze([...agents.values()]),
    states: Object.freeze([...states.values()].sort((left, right) => left.owner.localeCompare(right.owner))),
    ...(state === undefined ? {} : { state }),
    stateChanges: Object.freeze([...stateChanges.values()]),
    memories: Object.freeze([...memories.values()]),
    memoryProposals: Object.freeze([...memoryProposals.values()]),
    memoryCompactions: Object.freeze([...memoryCompactions]),
    relationships: Object.freeze([...relationships.values()]),
    ...(scene === undefined ? {} : { scene }),
    branches: Object.freeze([...branches.values()]),
    ...(activeBranchId === undefined ? {} : { activeBranchId }),
    media: Object.freeze([...media.values()]),
    capabilityInvocations: Object.freeze([...capabilityInvocations.values()]),
  })
}

/**
 * Rebuild the current domain context for one scope from committed Session facts.
 * The fold is process-independent: no domain Store has to be mutated or caught up.
 * @param events - Complete ordered Session log.
 * @param scope - Exact RP lifecycle scope to materialize.
 * @returns Immutable scope context at the last included event sequence.
 */
export function projectRpScope(events: readonly SessionEvent[], scope: RpScopeRef): RpScopeProjection {
  const turnScopes = new Map<RpTurnId, RpScopeRef>()
  const contexts = new Map<RpTurnId, RpContextRecord>()
  for (const event of events) {
    if (event.type === 'rp/composition-resolved') putTurnScope(turnScopes, event.data.turnId, event.data.scope)
    else if (event.type === 'rp/context-activated') putStable(contexts, event.data.turnId, event.data, 'context')
    else if (event.type === 'rp/turn-committed') {
      putTurnScope(turnScopes, event.data.turnId, event.data.composition.scope)
    }
  }

  const states = new Map<string, StateDocument>()
  const memories = new Map<string, MemoryEvent>()
  const relationships = new Map<string, RelationshipIR>()
  const branches = new Map<string, RpBranchRecord>()
  const history: RpTurnHistoryProjection[] = []
  let scene: SceneIR | undefined
  let activeBranchId: string | undefined

  for (const event of events) {
    if (event.type === 'rp/state-committed' && turnInScope(turnScopes, event.data.turnId, scope)) {
      states.set(event.data.state.owner, event.data.state)
    } else if (event.type === 'rp/memory-accepted' && turnInScope(turnScopes, event.data.turnId, scope)) {
      putMemory(memories, event.data.memory)
    } else if (event.type === 'rp/memory-compacted' && turnInScope(turnScopes, event.data.turnId, scope)) {
      for (const memoryId of event.data.memoryIds) memories.delete(memoryId)
    } else if (event.type === 'rp/branch-created' && turnInScope(turnScopes, event.data.turnId, scope)) {
      putBranch(branches, event.data.branch)
      if (event.data.branch.active) activeBranchId = activateBranch(branches, event.data.branch.id)
    } else if (event.type === 'rp/branch-activated' && turnInScope(turnScopes, event.data.turnId, scope)) {
      activeBranchId = activateBranch(branches, event.data.branchId)
    } else if (event.type === 'rp/branch-removed' && turnInScope(turnScopes, event.data.turnId, scope)) {
      branches.delete(event.data.branchId)
      if (activeBranchId === event.data.branchId) activeBranchId = undefined
    } else if (event.type === 'rp/turn-committed' && sameScope(event.data.composition.scope, scope)) {
      const record = event.data
      if (record.state !== undefined) states.set(record.state.owner, record.state)
      for (const memory of record.memories ?? []) putMemory(memories, memory)
      for (const relationship of record.relationships ?? []) {
        relationships.set(`${relationship.from}\u0000${relationship.to}`, relationship)
      }
      if (record.scene !== undefined) scene = record.scene
      if (record.branch !== undefined) {
        putBranch(branches, record.branch)
        if (record.branch.active) activeBranchId = activateBranch(branches, record.branch.id)
      }
      const context = contexts.get(record.turnId)
      history.push(Object.freeze({
        turnId: record.turnId,
        input: context?.input ?? null,
        ...(context?.media === undefined ? {} : { media: context.media }),
        assistantMessage: record.assistantMessage,
        committedAt: record.committedAt,
      }))
    }
  }

  const throughEventSeq = events.at(-1)?.seq ?? 0
  return Object.freeze({
    schemaVersion: 1,
    scope: freezeScope(scope),
    throughEventSeq,
    states: Object.freeze([...states.values()].sort((left, right) => left.owner.localeCompare(right.owner))),
    memories: Object.freeze([...memories.values()].sort((left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id))),
    relationships: Object.freeze([...relationships.values()].sort((left, right) =>
      left.from.localeCompare(right.from) || left.to.localeCompare(right.to))),
    ...(scene === undefined ? {} : { scene }),
    branches: Object.freeze([...branches.values()].sort((left, right) => left.id.localeCompare(right.id))),
    ...(activeBranchId === undefined ? {} : { activeBranchId }),
    history: Object.freeze(history),
  })
}

function pipelineKey(record: RpPipelineRecord): string {
  return `${record.turnId}\u0000${record.pipelineId}\u0000${record.snapshotHash}`
}

function pipelineProjection(
  record: RpPipelineRecord,
  status: RpPipelineExecutionProjection['status'],
): RpPipelineExecutionProjection {
  return Object.freeze({ ...record, status, stages: Object.freeze([]) })
}

function settlePipeline(
  pipelines: Map<string, RpPipelineExecutionProjection>,
  record: RpPipelineRecord & { readonly error?: string },
  status: 'completed' | 'failed',
): void {
  const key = pipelineKey(record)
  const current = pipelines.get(key)
  if (current === undefined || current.status !== 'running') {
    throw new Error(`RP pipeline execution ${JSON.stringify(key)} settled without one open start`)
  }
  pipelines.set(key, Object.freeze({
    ...current,
    status,
    ...(status === 'failed' ? { error: record.error ?? 'unknown pipeline failure' } : {}),
  }))
}

function agentKey(record: Pick<RpAgentRecord, 'turnId' | 'agentId'>): string {
  return `${record.turnId}\u0000${record.agentId}`
}

function startAgent(agents: Map<string, RpAgentExecutionProjection>, record: RpAgentRecord): void {
  const key = agentKey(record)
  if (agents.has(key)) throw new Error(`RP Agent execution ${JSON.stringify(key)} started more than once`)
  agents.set(key, Object.freeze({
    turnId: record.turnId,
    agentId: record.agentId,
    role: record.role,
    ...(record.parentAgentId === undefined ? {} : { parentAgentId: record.parentAgentId }),
    status: 'running',
    delegated: false,
    ...(record.detail === undefined ? {} : { detail: record.detail }),
    history: Object.freeze([record]),
  }))
}

function updateAgent(
  agents: Map<string, RpAgentExecutionProjection>,
  record: RpAgentRecord,
  status: RpAgentExecutionProjection['status'],
  delegated?: boolean,
): void {
  const key = agentKey(record)
  const current = agents.get(key)
  if (current === undefined || current.status !== 'running') {
    throw new Error(`RP Agent execution ${JSON.stringify(key)} updated without one open start`)
  }
  if (current.role !== record.role || current.parentAgentId !== record.parentAgentId) {
    throw new Error(`RP Agent execution ${JSON.stringify(key)} changed role or parent`)
  }
  if (delegated === true && current.delegated) {
    throw new Error(`RP Agent execution ${JSON.stringify(key)} was delegated more than once`)
  }
  agents.set(key, Object.freeze({
    ...current,
    status,
    delegated: current.delegated || delegated === true,
    ...(record.detail === undefined ? {} : { detail: record.detail }),
    history: Object.freeze([...current.history, record]),
  }))
}

function upsertCommittedAgent(agents: Map<string, RpAgentExecutionProjection>, record: RpAgentRecord): void {
  const current = agents.get(agentKey(record))
  if (current === undefined) {
    startAgent(agents, { ...record, operation: 'started' })
    if (record.operation !== 'started') applyCommittedAgentUpdate(agents, record)
    return
  }
  if (record.operation === 'started') return
  if (record.operation === 'delegated' && current.delegated) return
  if (record.operation === 'completed' && current.status === 'completed') return
  if (record.operation === 'interrupted' && current.status === 'interrupted') return
  applyCommittedAgentUpdate(agents, record)
}

function applyCommittedAgentUpdate(agents: Map<string, RpAgentExecutionProjection>, record: RpAgentRecord): void {
  updateAgent(
    agents,
    record,
    record.operation === 'interrupted' ? 'interrupted' : record.operation === 'completed' ? 'completed' : 'running',
    record.operation === 'delegated',
  )
}

function requireStateProposal(
  changes: Map<RpTurnId, RpStateChangeProjection>,
  turnId: RpTurnId,
  action: string,
): RpStateChangeProjection {
  const current = changes.get(turnId)
  if (current?.status !== 'proposed') {
    throw new Error(`RP state for turn ${JSON.stringify(turnId)} cannot ${action} without one open proposal`)
  }
  return current
}

function activateBranch(branches: Map<string, RpBranchRecord>, id: string): string {
  const branch = branches.get(id)
  if (branch === undefined) throw new Error(`RP branch ${JSON.stringify(id)} was activated before creation`)
  for (const [branchId, current] of branches) {
    const active = branchId === id
    if (current.active !== active) branches.set(branchId, Object.freeze({ ...current, active }))
  }
  return id
}

function memoryKey(turnId: RpTurnId, memoryId: string): string {
  return `${turnId}\u0000${memoryId}`
}

function settleMedia(
  media: Map<RpTurnId, RpMediaExecutionProjection>,
  turnId: RpTurnId,
  terminal: { readonly status: 'completed'; readonly artifact: JsonValue }
    | { readonly status: 'failed'; readonly error: string },
): void {
  const current = media.get(turnId)
  if (current?.status !== 'requested') {
    throw new Error(`RP media for turn ${JSON.stringify(turnId)} settled without one open request`)
  }
  media.set(turnId, Object.freeze({ ...current, ...terminal }))
}

function putStable<K, V>(map: Map<K, V>, key: K, value: V, label: string): void {
  const current = map.get(key)
  if (current !== undefined && JSON.stringify(current) !== JSON.stringify(value)) {
    throw new Error(`RP ${label} ${JSON.stringify(key)} changed after it was frozen`)
  }
  if (current === undefined) map.set(key, value)
}

function putTurnScope(scopes: Map<RpTurnId, RpScopeRef>, turnId: RpTurnId, scope: RpScopeRef): void {
  const current = scopes.get(turnId)
  if (current !== undefined && !sameScope(current, scope)) {
    throw new Error(`RP turn ${JSON.stringify(turnId)} changed scope after composition`)
  }
  if (current === undefined) scopes.set(turnId, scope)
}

function turnInScope(scopes: Map<RpTurnId, RpScopeRef>, turnId: RpTurnId, scope: RpScopeRef): boolean {
  const owned = scopes.get(turnId)
  return owned !== undefined && sameScope(owned, scope)
}

function sameScope(left: RpScopeRef, right: RpScopeRef): boolean {
  return left.kind === right.kind && left.id === right.id
}

function putMemory(memories: Map<string, MemoryEvent>, memory: MemoryEvent): void {
  const current = memories.get(memory.id)
  if (current !== undefined && JSON.stringify(current) !== JSON.stringify(memory)) {
    throw new Error(`RP memory ${JSON.stringify(memory.id)} changed after acceptance`)
  }
  if (current === undefined) memories.set(memory.id, memory)
}

function putBranch(branches: Map<string, RpBranchRecord>, branch: RpBranchRecord): void {
  const current = branches.get(branch.id)
  if (current !== undefined && (current.parentId !== branch.parentId || current.message !== branch.message)) {
    throw new Error(`RP branch ${JSON.stringify(branch.id)} changed identity after creation`)
  }
  branches.set(branch.id, branch)
}

function freezeScope(scope: RpScopeRef): RpScopeRef {
  return Object.freeze({
    ...scope,
    ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }),
  })
}

/** Cordis service wrapper around the pure replay fold. */
export class RpProjectionService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'rpProjection')
  }

  /**
   * Project one live or restored Session.
   * @param session - Session whose complete log is authoritative.
   * @returns Immutable RP state.
   */
  project(session: Session): RpSessionProjection {
    return projectRpSession(session.events)
  }

  /**
   * Materialize one exact scope at the Session's current event boundary.
   * @param session - Session whose event log is authoritative.
   * @param scope - Exact lifecycle scope to reconstruct.
   * @returns Immutable live context used by the next turn.
   */
  projectScope(session: Session, scope: RpScopeRef): RpScopeProjection {
    return projectRpScope(session.events, scope)
  }
}

export default RpProjectionService
