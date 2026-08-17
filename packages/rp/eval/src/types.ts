/** Public RP evaluation records. @module @dsh-rp/eval/types */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@dsh-rp/contracts'
import type { RpJournalEventType } from '@dsh-rp/journal'
import type { RpSessionProjection } from '@dsh-rp/projection'

/** Bounded counters available to a golden replay assertion. */
export interface RpEvalExpectedCounts {
  readonly turns?: number
  readonly aborted?: number
  readonly pipelines?: number
  readonly agents?: number
  readonly memories?: number
  readonly branches?: number
  readonly media?: number
  readonly capabilityInvocations?: number
}

/** Expected deterministic result for one Session Event fixture. */
export interface RpEvalExpectation {
  readonly projectionSha256?: string
  readonly eventLogSha256?: string
  readonly projection?: JsonValue
  readonly counts?: RpEvalExpectedCounts
  readonly assistantMessages?: readonly string[]
  readonly state?: JsonValue
  readonly activeBranchId?: string | null
  /** Defaults to true. False explicitly expects at least one open lifecycle. */
  readonly settled?: boolean
}

/** One exact Session Event log and its golden assertions. */
export interface RpEvalScenario {
  readonly schemaVersion: 1
  readonly id: string
  readonly events: readonly SessionEvent<RpJournalEventType>[]
  readonly expected: RpEvalExpectation
}

/** Versioned file consumed by the evaluation API and `dsh rp test`. */
export interface RpEvalSuite {
  readonly schemaVersion: 1
  readonly scenarios: readonly RpEvalScenario[]
}

/** Path-addressed evaluation failure safe to print in CI. */
export interface RpEvalDiagnostic {
  readonly path: string
  readonly message: string
}

/** Result of validating and replaying one scenario twice. */
export interface RpEvalScenarioResult {
  readonly id: string
  readonly passed: boolean
  readonly projectionSha256?: string
  readonly eventLogSha256?: string
  readonly projection?: RpSessionProjection
  readonly diagnostics: readonly RpEvalDiagnostic[]
}

/** Aggregate result returned without throwing for fixture or assertion failures. */
export interface RpEvalReport {
  readonly valid: boolean
  readonly passed: boolean
  readonly scenarios: readonly RpEvalScenarioResult[]
  readonly diagnostics: readonly RpEvalDiagnostic[]
}
