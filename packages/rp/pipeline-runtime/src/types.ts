/** RP pipeline definition and execution types. @module @dsh-rp/pipeline-runtime/types */

import type { JsonObject, JsonValue, RpBudget, RpPipelineId, RpScopeRef, RpTrustLevel } from '@dsh-rp/contracts'
import type { RpCapabilityPolicyLayer } from '@dsh-rp/capability-catalog'

/** The three independently routable RP pipeline families. */
export type RpPipelineKind = 'turn' | 'workflow' | 'sidecar'

/** Immutable data available to a stage. */
export interface RpPipelineFrame {
  readonly input: JsonValue
  readonly values: Readonly<Record<string, JsonValue>>
}

/** Stage authority and lifecycle. */
export interface RpPipelineStageContext {
  /** Exact execution identity shared by every Stage in this graph run. */
  readonly runId: string
  readonly scope: RpScopeRef
  readonly pipeline: RpPipelineSnapshot
  readonly stageId: string
  readonly attempt: number
  readonly signal: AbortSignal
  /** Host-owned trace data carried across nested Pipelines, never Stage output. */
  readonly metadata?: JsonObject
}

/** Named outputs merged into the frame after a parallel level settles. */
export type RpPipelineStageOutput = Readonly<Record<string, JsonValue>>

/** One executable DAG node. */
export interface RpPipelineStageDefinition {
  readonly id: string
  /** Declarative operation used by generic engines; `custom` calls `run`. */
  readonly operation?:
    | { readonly kind: 'custom' }
    | {
      readonly kind: 'invoke-capability'
      readonly capabilityId: string
      readonly inputKey?: string
      readonly grantedPermissions?: readonly string[]
      readonly grantedTrust?: RpTrustLevel
    }
    | { readonly kind: 'invoke-pipeline'; readonly pipelineId: RpPipelineId; readonly inputKey?: string }
    | { readonly kind: 'conditional'; readonly valueKey: string; readonly equals: JsonValue }
  readonly after?: readonly string[]
  readonly before?: readonly string[]
  readonly timeoutMs?: number
  readonly retries?: number
  readonly failure?: 'fatal' | 'continue'
  readonly run?: (
    frame: RpPipelineFrame,
    context: RpPipelineStageContext,
  ) => RpPipelineStageOutput | Promise<RpPipelineStageOutput>
}

/** A registered pipeline. */
export interface RpPipelineDefinition {
  readonly id: RpPipelineId
  readonly kind: RpPipelineKind
  readonly version: string
  readonly description: string
  /** Highest implementation trust required to execute this graph. */
  readonly trust: RpTrustLevel
  /** Permissions a constrained caller must hold before the graph starts. */
  readonly permissions: readonly string[]
  readonly stages: readonly RpPipelineStageDefinition[]
  readonly budget?: RpBudget
}

/** Immutable compiled graph captured for one run. */
export interface RpPipelineSnapshot {
  readonly id: RpPipelineId
  readonly kind: RpPipelineKind
  readonly version: string
  readonly trust: RpTrustLevel
  readonly permissions: readonly string[]
  readonly hash: string
  readonly levels: readonly (readonly string[])[]
  readonly budget?: RpBudget
}

/** Opaque executable graph captured with all nested Pipeline dependencies frozen. */
export interface RpPipelinePlan {
  readonly snapshot: RpPipelineSnapshot
}

/** Required synchronous lifecycle observer for durable or diagnostic run consumers. */
export interface RpPipelineRunObserver {
  /** Called after authority admission and before the first Stage starts. */
  started(info: RpPipelineRunInfo): void
  /** Called exactly once for every completed or non-fatally continued Stage. */
  stage(info: RpPipelineRunInfo, stageId: string, outcome: 'completed' | 'continued'): void
  /** Called once after every Stage and output merge succeeds. */
  completed(info: RpPipelineRunInfo): void
  /** Called once when an admitted execution fails. */
  failed(info: RpPipelineRunInfo, error: string): void
}

/** Runtime inputs that do not affect graph compilation. */
export interface RpPipelineRunRequest {
  readonly scope: RpScopeRef
  readonly input: JsonValue
  readonly signal?: AbortSignal
  readonly budget?: RpBudget
  readonly grantedPermissions?: readonly string[]
  readonly grantedTrust?: RpTrustLevel
  readonly networkDomains?: readonly string[]
  readonly fileRoots?: readonly string[]
  readonly policyLayers?: readonly RpCapabilityPolicyLayer[]
  readonly observer?: RpPipelineRunObserver
  /** Immutable Host trace identity available to custom Stages and nested Pipelines. */
  readonly metadata?: JsonObject
}

/** A non-fatal stage failure retained in the run result. */
export interface RpPipelineStageFailure {
  readonly stageId: string
  readonly message: string
}

/** Successful terminal result, including continued stage failures. */
export interface RpPipelineRunResult {
  readonly runId: string
  readonly snapshot: RpPipelineSnapshot
  readonly frame: RpPipelineFrame
  readonly failures: readonly RpPipelineStageFailure[]
}

/** Live lifecycle identity shared by pipeline events. */
export interface RpPipelineRunInfo {
  readonly runId: string
  readonly pipelineId: RpPipelineId
  readonly kind: RpPipelineKind
  readonly snapshotHash: string
}
