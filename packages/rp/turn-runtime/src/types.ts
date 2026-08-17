/** RP turn transaction types. @module @dsh-rp/turn-runtime/types */

import type { Session } from '@deepseek-ai/dsh-session'
import type {
  JsonObject,
  JsonValue,
  MediaArtifact,
  MemoryEvent,
  RelationshipIR,
  RpExperienceManifest,
  RpModelMediaInput,
  RpScopeRef,
  RpTurnId,
  SceneIR,
  StateDocument,
  StatePatch,
} from '@dsh-rp/contracts'
import type { RpCompositionSnapshot } from '@dsh-rp/component-runtime'
import type { RpBranchRecord, RpTurnCommitRecord, RpUsageRecord } from '@dsh-rp/journal'
import type { RpPipelineRunRequest, RpPipelineRunResult, RpPipelineSnapshot } from '@dsh-rp/pipeline-runtime'
import type { RpScopeProjection } from '@dsh-rp/projection'
import type { RpPresetSnapshot } from '@dsh-rp/preset'
import type { RpLibrarySnapshot } from '@dsh-rp/library'

/** Capability, policy, and resource ceilings applied to one turn Pipeline. */
export type RpTurnAuthority = Pick<
  RpPipelineRunRequest,
  'budget' | 'grantedPermissions' | 'grantedTrust' | 'networkDomains' | 'fileRoots' | 'policyLayers'
>

/** Inputs required before a turn can freeze its runtime composition. */
export interface RpTurnRequest {
  readonly session: Session
  readonly experience: RpExperienceManifest
  readonly scope: RpScopeRef
  readonly input: JsonValue
  /** Durable input artifacts resolved before the turn snapshot is frozen. */
  readonly media?: readonly MediaArtifact[]
  /** Model references atomically materialized with `media` by the owning ingress boundary. */
  readonly content?: readonly RpModelMediaInput[]
  readonly grantedCapabilities: readonly string[]
  readonly signal?: AbortSignal
  readonly context?: JsonObject
  /** Omission denotes a trusted Host call; remote and Agent callers supply explicit ceilings. */
  readonly authority?: RpTurnAuthority
}

/** Frozen caller and Event Log context visible to every Stage in one exact turn. */
export interface RpTurnContextSnapshot {
  readonly schemaVersion: 1
  /** Caller context remains namespaced so it cannot overwrite authoritative replay state. */
  readonly supplied: JsonObject
  /** Scope materialization at the Session event boundary before this turn was admitted. */
  readonly session: RpScopeProjection
  /** Byte-free durable artifacts attached to this exact turn. */
  readonly media: readonly MediaArtifact[]
  /** Model-visible immutable references derived by the owning media-input Adapters. */
  readonly content: readonly RpModelMediaInput[]
  /** Active scoped preset frozen before Pipeline execution. */
  readonly preset?: RpPresetSnapshot
  /** Active scoped Character, Persona, and Lore assets frozen before Pipeline execution. */
  readonly library?: RpLibrarySnapshot
}

/** Prepared but unexecuted turn with frozen component and pipeline snapshots. */
export interface RpTurnDraft {
  readonly id: RpTurnId
  readonly request: RpTurnRequest
  readonly composition: RpCompositionSnapshot
  readonly pipeline: RpPipelineSnapshot
  readonly context: RpTurnContextSnapshot
  readonly preparedAt: number
}

/** Caller-supplied typed domain effects derived from the pipeline output. */
export interface RpTurnEffects {
  readonly assistantMessage: string
  readonly state?: StateDocument
  readonly statePatch?: StatePatch
  readonly memories?: readonly MemoryEvent[]
  readonly relationships?: readonly RelationshipIR[]
  readonly scene?: SceneIR
  readonly branch?: RpBranchRecord
  readonly usage?: RpUsageRecord
  readonly metadata?: JsonObject
}

/** Executed turn awaiting validation and commit. */
export interface RpTurnOutcome {
  readonly draft: RpTurnDraft
  readonly pipeline: RpPipelineRunResult
  readonly effects: RpTurnEffects
}

/** Terminal committed outcome. */
export interface RpTurnCommit {
  readonly record: RpTurnCommitRecord
  readonly eventSeq: number
}
