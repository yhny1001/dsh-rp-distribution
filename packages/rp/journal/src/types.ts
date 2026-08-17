/** Durable RP session-event data. @module @dsh-rp/journal/types */

import type {
  JsonObject,
  JsonValue,
  MediaArtifact,
  MemoryEvent,
  RpBudget,
  RelationshipIR,
  RpCompositionId,
  RpPipelineId,
  RpScopeRef,
  RpModelMediaInput,
  RpTurnId,
  RpTrustLevel,
  SceneIR,
  StateDocument,
  StatePatch,
} from '@dsh-rp/contracts'

/** Durable composition identity captured before a turn executes. */
export interface RpCompositionRecord {
  readonly turnId: RpTurnId
  readonly compositionId: RpCompositionId
  readonly componentIds: readonly string[]
  readonly scope: RpScopeRef
}

/** Durable pipeline graph identity captured before execution. */
export interface RpPipelineRecord {
  readonly turnId: RpTurnId
  readonly pipelineId: RpPipelineId
  readonly snapshotHash: string
  readonly kind: 'turn' | 'workflow' | 'sidecar'
}

/** Durable settlement of one Stage in one exact frozen Pipeline execution. */
export interface RpPipelineStageRecord extends RpPipelineRecord {
  readonly stageId: string
  readonly outcome: 'completed' | 'continued'
}

/** Exact user input and Host context activated for one prepared turn. */
export interface RpContextRecord {
  readonly schemaVersion: 1
  readonly turnId: RpTurnId
  readonly input: JsonValue
  readonly context: JsonObject
  /** Byte-free artifacts with exact ingress provenance. */
  readonly media?: readonly MediaArtifact[]
  /** Generic model-input carrier also used by Session attachment authorization. */
  readonly content?: readonly RpModelMediaInput[]
}

/** One durable agent lifecycle record. */
export interface RpAgentRecord {
  readonly turnId: RpTurnId
  readonly agentId: string
  readonly role: string
  readonly operation: 'started' | 'delegated' | 'completed' | 'interrupted'
  readonly parentAgentId?: string
  readonly detail?: JsonObject
}

/** One branch candidate committed by a turn. */
export interface RpBranchRecord {
  readonly id: string
  readonly parentId?: string
  readonly active: boolean
  readonly message: string
}

/** Token and cost facts reported by adapters. */
export interface RpUsageRecord {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly costUsd?: number
  readonly durationMs?: number
}

/** Least-authority snapshot recorded before one Agent capability adapter runs. */
export interface RpCapabilityAuthorizedRecord {
  readonly schemaVersion: 1
  readonly callId: string
  readonly capabilityId: string
  readonly agentId: string
  readonly scope: RpScopeRef
  readonly authority: {
    readonly permissions: readonly string[]
    readonly trust: RpTrustLevel
    readonly budget: RpBudget
    readonly networkDomains: readonly string[]
    readonly fileRoots: readonly string[]
    readonly layers: readonly string[]
  }
  readonly authorizedAt: number
}

/** Terminal capability audit fact paired to one model-visible tool call. */
export interface RpCapabilitySettlementRecord {
  readonly schemaVersion: 1
  readonly callId: string
  readonly capabilityId: string
  readonly agentId: string
  readonly status: 'completed' | 'failed' | 'denied'
  readonly error?: string
  readonly finishedAt: number
}

/** Complete atomic post-turn state. */
export interface RpTurnCommitRecord {
  readonly schemaVersion: 1
  readonly turnId: RpTurnId
  readonly composition: RpCompositionRecord
  readonly pipeline: RpPipelineRecord
  readonly assistantMessage: string
  readonly state?: StateDocument
  readonly statePatch?: StatePatch
  readonly memories?: readonly MemoryEvent[]
  readonly relationships?: readonly RelationshipIR[]
  readonly scene?: SceneIR
  readonly branch?: RpBranchRecord
  readonly agentTrace?: readonly RpAgentRecord[]
  readonly pipelineTrace?: readonly JsonObject[]
  readonly usage?: RpUsageRecord
  readonly metadata?: JsonObject
  readonly committedAt: number
}

/** Durable abort record for a prepared but uncommitted RP turn. */
export interface RpTurnAbortRecord {
  readonly schemaVersion: 1
  readonly turnId: RpTurnId
  readonly reason: string
  readonly abortedAt: number
}

/** Event data owned by the RP journal. */
export interface RpJournalEventMap {
  'rp/capability-authorized': RpCapabilityAuthorizedRecord
  'rp/capability-settled': RpCapabilitySettlementRecord
  'rp/composition-resolved': RpCompositionRecord
  'rp/context-activated': RpContextRecord
  'rp/pipeline-started': RpPipelineRecord
  'rp/pipeline-stage': RpPipelineStageRecord
  'rp/pipeline-completed': RpPipelineRecord
  'rp/pipeline-failed': RpPipelineRecord & { readonly error: string }
  'rp/agent-started': RpAgentRecord
  'rp/agent-delegated': RpAgentRecord
  'rp/agent-completed': RpAgentRecord
  'rp/agent-interrupted': RpAgentRecord
  'rp/state-proposed': { readonly turnId: RpTurnId; readonly patch: StatePatch }
  'rp/state-committed': { readonly turnId: RpTurnId; readonly state: StateDocument }
  'rp/state-rejected': { readonly turnId: RpTurnId; readonly reason: string }
  'rp/branch-created': { readonly turnId: RpTurnId; readonly branch: RpBranchRecord }
  'rp/branch-activated': { readonly turnId: RpTurnId; readonly branchId: string }
  'rp/branch-removed': { readonly turnId: RpTurnId; readonly branchId: string }
  'rp/memory-proposed': { readonly turnId: RpTurnId; readonly memory: MemoryEvent }
  'rp/memory-accepted': { readonly turnId: RpTurnId; readonly memory: MemoryEvent }
  'rp/memory-compacted': { readonly turnId: RpTurnId; readonly memoryIds: readonly string[]; readonly summary: string }
  'rp/media-requested': { readonly turnId: RpTurnId; readonly request: JsonObject }
  'rp/media-completed': { readonly turnId: RpTurnId; readonly artifact: JsonValue }
  'rp/media-failed': { readonly turnId: RpTurnId; readonly error: string }
  'rp/turn-committed': RpTurnCommitRecord
  'rp/turn-aborted': RpTurnAbortRecord
}

/** Durable RP event names. */
export type RpJournalEventType = keyof RpJournalEventMap

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Least authority resolved before one model-requested RP capability runs. */
    'rp/capability-authorized': RpCapabilityAuthorizedRecord
    /** Terminal completion, failure, or denial for one RP capability call. */
    'rp/capability-settled': RpCapabilitySettlementRecord
    /** Frozen component topology for a prepared RP turn. */
    'rp/composition-resolved': RpCompositionRecord
    /** Context selected for a prepared RP turn. */
    'rp/context-activated': RpContextRecord
    /** Frozen pipeline topology at the start of execution. */
    'rp/pipeline-started': RpPipelineRecord
    /** Durable settlement of one pipeline stage. */
    'rp/pipeline-stage': RpPipelineStageRecord
    /** Successful completion of a pipeline execution. */
    'rp/pipeline-completed': RpPipelineRecord
    /** Failed pipeline execution with its rendered diagnostic. */
    'rp/pipeline-failed': RpPipelineRecord & { readonly error: string }
    /** Start of an RP Agent lifecycle. */
    'rp/agent-started': RpAgentRecord
    /** Delegation from one RP Agent to another. */
    'rp/agent-delegated': RpAgentRecord
    /** Successful completion of an RP Agent lifecycle. */
    'rp/agent-completed': RpAgentRecord
    /** Interrupted RP Agent lifecycle. */
    'rp/agent-interrupted': RpAgentRecord
    /** State patch proposed before validation. */
    'rp/state-proposed': { readonly turnId: RpTurnId; readonly patch: StatePatch }
    /** State document accepted at the turn commit boundary. */
    'rp/state-committed': { readonly turnId: RpTurnId; readonly state: StateDocument }
    /** State proposal rejected before commit. */
    'rp/state-rejected': { readonly turnId: RpTurnId; readonly reason: string }
    /** Branch candidate created by a turn. */
    'rp/branch-created': { readonly turnId: RpTurnId; readonly branch: RpBranchRecord }
    /** Existing branch selected as the active continuation. */
    'rp/branch-activated': { readonly turnId: RpTurnId; readonly branchId: string }
    /** Existing branch removed from the conversation projection. */
    'rp/branch-removed': { readonly turnId: RpTurnId; readonly branchId: string }
    /** Memory candidate proposed before acceptance. */
    'rp/memory-proposed': { readonly turnId: RpTurnId; readonly memory: MemoryEvent }
    /** Memory accepted into durable projection. */
    'rp/memory-accepted': { readonly turnId: RpTurnId; readonly memory: MemoryEvent }
    /** Multiple memories compacted into a durable summary. */
    'rp/memory-compacted': { readonly turnId: RpTurnId; readonly memoryIds: readonly string[]; readonly summary: string }
    /** External media work requested through an outbox-capable provider. */
    'rp/media-requested': { readonly turnId: RpTurnId; readonly request: JsonObject }
    /** External media work completed with a durable artifact descriptor. */
    'rp/media-completed': { readonly turnId: RpTurnId; readonly artifact: JsonValue }
    /** External media work failed with a rendered diagnostic. */
    'rp/media-failed': { readonly turnId: RpTurnId; readonly error: string }
    /** Complete atomic local RP turn commit. */
    'rp/turn-committed': RpTurnCommitRecord
    /** Terminal abort of a prepared RP turn. */
    'rp/turn-aborted': RpTurnAbortRecord
  }
}
