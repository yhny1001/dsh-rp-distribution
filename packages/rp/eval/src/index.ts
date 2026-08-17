/** Deterministic RP golden-log evaluation. @module @dsh-rp/eval */

import { createHash } from 'node:crypto'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { RP_JOURNAL_EVENT_TYPES } from '@dsh-rp/journal'
import { projectRpSession, type RpSessionProjection } from '@dsh-rp/projection'
import type {
  RpEvalDiagnostic,
  RpEvalExpectedCounts,
  RpEvalExpectation,
  RpEvalReport,
  RpEvalScenario,
  RpEvalScenarioResult,
  RpEvalSuite,
} from './types.ts'

export type * from './types.ts'

const MAX_SCENARIOS = 256
const MAX_EVENTS_PER_SCENARIO = 100_000
const SHA256 = /^[a-f0-9]{64}$/u
const SCENARIO_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u
const SUITE_KEYS: readonly string[] = Object.freeze(['schemaVersion', 'scenarios'])
const SCENARIO_KEYS: readonly string[] = Object.freeze(['schemaVersion', 'id', 'events', 'expected'])
const EVENT_KEYS: readonly string[] = Object.freeze([
  'type', 'seq', 'time', 'data', 'ignorable', 'surfaceOp', 'sourceEventSeqs',
])
const EXPECTATION_KEYS: readonly string[] = Object.freeze([
  'projectionSha256', 'eventLogSha256', 'projection', 'counts', 'assistantMessages', 'state',
  'activeBranchId', 'settled',
])
const COUNT_KEYS: readonly (keyof RpEvalExpectedCounts)[] = Object.freeze([
  'turns', 'aborted', 'pipelines', 'agents', 'memories', 'branches', 'media', 'capabilityInvocations',
])

/**
 * Validate, replay twice, and compare every scenario in one suite.
 * @param value - Untrusted JSON value, usually parsed from `rp.eval.json`.
 * @returns A report; malformed suites and failed assertions never throw.
 */
export function evaluateRpSuite(value: unknown): RpEvalReport {
  const diagnostics: RpEvalDiagnostic[] = []
  const suite = parseSuite(value, diagnostics)
  if (suite === undefined) {
    return Object.freeze({ valid: false, passed: false, scenarios: Object.freeze([]), diagnostics: Object.freeze(diagnostics) })
  }
  const scenarios = suite.scenarios.map(evaluateRpScenario)
  return Object.freeze({
    valid: true,
    passed: scenarios.every(item => item.passed),
    scenarios: Object.freeze(scenarios),
    diagnostics: Object.freeze([]),
  })
}

/**
 * Replay one already validated scenario through independent Session instances.
 * @param scenario - Versioned exact event-log fixture.
 * @returns Projection hashes and path-addressed assertion diagnostics.
 */
export function evaluateRpScenario(scenario: RpEvalScenario): RpEvalScenarioResult {
  const diagnostics: RpEvalDiagnostic[] = []
  try {
    const first = replay(scenario.id, scenario.events)
    const second = replay(`${scenario.id}.determinism`, scenario.events)
    const projectionSha256 = hashRpEvalValue(first)
    const secondHash = hashRpEvalValue(second)
    const eventLogSha256 = hashRpEvalValue(scenario.events)
    if (projectionSha256 !== secondHash) {
      diagnostics.push({ path: 'events', message: `replay is nondeterministic (${projectionSha256} != ${secondHash})` })
    }
    assertExpectation(first, projectionSha256, eventLogSha256, scenario.expected, diagnostics)
    return Object.freeze({
      id: scenario.id,
      passed: diagnostics.length === 0,
      projectionSha256,
      eventLogSha256,
      projection: first,
      diagnostics: Object.freeze(diagnostics),
    })
  } catch (error: unknown) {
    diagnostics.push({ path: 'events', message: renderError(error) })
    return Object.freeze({ id: scenario.id, passed: false, diagnostics: Object.freeze(diagnostics) })
  }
}

/**
 * Hash any losslessly JSON-serializable value with sorted object keys.
 * @param value - JSON value or JSON-shaped public record.
 * @returns Lowercase SHA-256 content address.
 */
export function hashRpEvalValue(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value, new Set(), '$')).digest('hex')
}

function replay(id: string, events: readonly SessionEvent[]): RpSessionProjection {
  const session = Session.create(SessionId(`rp-eval:${id}`), events)
  return projectRpSession(session.events)
}

function assertExpectation(
  projection: RpSessionProjection,
  projectionSha256: string,
  eventLogSha256: string,
  expected: RpEvalExpectation,
  diagnostics: RpEvalDiagnostic[],
): void {
  if (expected.projectionSha256 !== undefined && expected.projectionSha256 !== projectionSha256) {
    mismatch(diagnostics, 'expected.projectionSha256', expected.projectionSha256, projectionSha256)
  }
  if (expected.eventLogSha256 !== undefined && expected.eventLogSha256 !== eventLogSha256) {
    mismatch(diagnostics, 'expected.eventLogSha256', expected.eventLogSha256, eventLogSha256)
  }
  if (expected.projection !== undefined && hashRpEvalValue(expected.projection) !== projectionSha256) {
    diagnostics.push({ path: 'expected.projection', message: 'projection does not equal the replayed golden projection' })
  }
  if (expected.assistantMessages !== undefined) {
    assertCanonicalEqual(
      diagnostics,
      'expected.assistantMessages',
      expected.assistantMessages,
      projection.turns.map(turn => turn.assistantMessage),
    )
  }
  if (expected.state !== undefined) {
    assertCanonicalEqual(diagnostics, 'expected.state', expected.state, projection.state?.value ?? null)
  }
  if (expected.activeBranchId !== undefined) {
    assertCanonicalEqual(diagnostics, 'expected.activeBranchId', expected.activeBranchId, projection.activeBranchId ?? null)
  }
  if (expected.counts !== undefined) {
    for (const key of COUNT_KEYS) {
      const count = expected.counts[key]
      if (count !== undefined && projection[key].length !== count) {
        mismatch(diagnostics, `expected.counts.${key}`, count, projection[key].length)
      }
    }
  }
  const open = openLifecycles(projection)
  const settled = open.length === 0
  const expectedSettled = expected.settled ?? true
  if (settled !== expectedSettled) {
    diagnostics.push({
      path: 'expected.settled',
      message: expectedSettled
        ? `expected a settled Session; open lifecycles: ${open.join(', ')}`
        : 'expected at least one open lifecycle, but the Session is settled',
    })
  }
}

function openLifecycles(projection: RpSessionProjection): string[] {
  const open: string[] = []
  for (const pipeline of projection.pipelines) {
    if (pipeline.status === 'running') open.push(`pipeline:${pipeline.pipelineId}`)
  }
  for (const agent of projection.agents) {
    if (agent.status === 'running') open.push(`agent:${agent.agentId}`)
  }
  for (const call of projection.capabilityInvocations) {
    if (call.status === 'authorized') open.push(`capability:${call.callId}`)
  }
  for (const state of projection.stateChanges) {
    if (state.status === 'proposed') open.push(`state:${state.turnId}`)
  }
  for (const memory of projection.memoryProposals) open.push(`memory:${memory.turnId}:${memory.memory.id}`)
  for (const media of projection.media) {
    if (media.status === 'requested') open.push(`media:${media.turnId}`)
  }
  return open
}

function parseSuite(value: unknown, diagnostics: RpEvalDiagnostic[]): RpEvalSuite | undefined {
  if (!isRecord(value)) {
    diagnostics.push({ path: '$', message: 'suite must be a JSON object' })
    return undefined
  }
  rejectUnknownKeys(value, SUITE_KEYS, '$', diagnostics)
  if (value.schemaVersion !== 1) diagnostics.push({ path: 'schemaVersion', message: 'must equal 1' })
  if (!Array.isArray(value.scenarios)) {
    diagnostics.push({ path: 'scenarios', message: 'must be an array' })
    return undefined
  }
  if (value.scenarios.length === 0 || value.scenarios.length > MAX_SCENARIOS) {
    diagnostics.push({ path: 'scenarios', message: `must contain between 1 and ${MAX_SCENARIOS} scenarios` })
  }
  const ids = new Set<string>()
  for (const [index, scenario] of value.scenarios.entries()) validateScenario(scenario, index, ids, diagnostics)
  return diagnostics.length === 0 ? value as unknown as RpEvalSuite : undefined
}

function validateScenario(
  value: unknown,
  index: number,
  ids: Set<string>,
  diagnostics: RpEvalDiagnostic[],
): void {
  const path = `scenarios[${index}]`
  if (!isRecord(value)) {
    diagnostics.push({ path, message: 'must be a JSON object' })
    return
  }
  rejectUnknownKeys(value, SCENARIO_KEYS, path, diagnostics)
  if (value.schemaVersion !== 1) diagnostics.push({ path: `${path}.schemaVersion`, message: 'must equal 1' })
  if (typeof value.id !== 'string' || !SCENARIO_ID.test(value.id)) {
    diagnostics.push({ path: `${path}.id`, message: 'must be a lowercase dot/dash/underscore identifier of 1-128 characters' })
  } else if (ids.has(value.id)) diagnostics.push({ path: `${path}.id`, message: 'must be unique' })
  else ids.add(value.id)
  if (!Array.isArray(value.events)) diagnostics.push({ path: `${path}.events`, message: 'must be an array' })
  else {
    if (value.events.length > MAX_EVENTS_PER_SCENARIO) {
      diagnostics.push({ path: `${path}.events`, message: `must contain at most ${MAX_EVENTS_PER_SCENARIO} events` })
    }
    for (const [eventIndex, event] of value.events.entries()) validateEvent(event, eventIndex, `${path}.events[${eventIndex}]`, diagnostics)
  }
  validateExpectation(value.expected, `${path}.expected`, diagnostics)
}

function validateEvent(value: unknown, index: number, path: string, diagnostics: RpEvalDiagnostic[]): void {
  if (!isRecord(value)) {
    diagnostics.push({ path, message: 'must be a Session Event object' })
    return
  }
  for (const key of Object.keys(value)) {
    if (!EVENT_KEYS.includes(key)) diagnostics.push({ path: `${path}.${key}`, message: 'is not a Session Event envelope field' })
  }
  if (value.seq !== index) diagnostics.push({ path: `${path}.seq`, message: `must equal contiguous index ${index}` })
  if (!Number.isSafeInteger(value.time) || (value.time as number) < 0) {
    diagnostics.push({ path: `${path}.time`, message: 'must be a non-negative safe integer' })
  }
  if (typeof value.type !== 'string' || value.type.length === 0) {
    diagnostics.push({ path: `${path}.type`, message: 'must be a non-empty string' })
  } else {
    const known = (RP_JOURNAL_EVENT_TYPES as readonly string[]).includes(value.type)
    if (known && value.ignorable === true) diagnostics.push({ path: `${path}.ignorable`, message: 'known RP facts are required and cannot be ignorable' })
    if (!known && value.ignorable !== true) diagnostics.push({ path: `${path}.type`, message: 'unknown events must declare ignorable: true' })
  }
  if (!isJsonValue(value.data) || !isRecord(value.data)) {
    diagnostics.push({ path: `${path}.data`, message: 'must be a finite JSON object' })
  }
  if (value.ignorable !== undefined && value.ignorable !== true) {
    diagnostics.push({ path: `${path}.ignorable`, message: 'must be true when present' })
  }
}

function validateExpectation(value: unknown, path: string, diagnostics: RpEvalDiagnostic[]): void {
  if (!isRecord(value)) {
    diagnostics.push({ path, message: 'must be a JSON object' })
    return
  }
  const keys = Object.keys(value)
  if (keys.length === 0) diagnostics.push({ path, message: 'must contain at least one assertion' })
  for (const key of keys) {
    if (!EXPECTATION_KEYS.includes(key)) diagnostics.push({ path: `${path}.${key}`, message: 'is not a supported assertion' })
  }
  for (const key of ['projectionSha256', 'eventLogSha256'] as const) {
    const hash = value[key]
    if (hash !== undefined && (typeof hash !== 'string' || !SHA256.test(hash))) {
      diagnostics.push({ path: `${path}.${key}`, message: 'must be a lowercase SHA-256 hash' })
    }
  }
  if (value.projection !== undefined && !isJsonValue(value.projection)) diagnostics.push({ path: `${path}.projection`, message: 'must be finite JSON data' })
  if (value.state !== undefined && !isJsonValue(value.state)) diagnostics.push({ path: `${path}.state`, message: 'must be finite JSON data' })
  if (value.activeBranchId !== undefined && value.activeBranchId !== null && typeof value.activeBranchId !== 'string') {
    diagnostics.push({ path: `${path}.activeBranchId`, message: 'must be a string or null' })
  }
  if (value.settled !== undefined && typeof value.settled !== 'boolean') diagnostics.push({ path: `${path}.settled`, message: 'must be boolean' })
  if (value.assistantMessages !== undefined && (!Array.isArray(value.assistantMessages) || value.assistantMessages.some(item => typeof item !== 'string'))) {
    diagnostics.push({ path: `${path}.assistantMessages`, message: 'must be an array of strings' })
  }
  if (value.counts !== undefined) validateCounts(value.counts, `${path}.counts`, diagnostics)
}

function validateCounts(value: unknown, path: string, diagnostics: RpEvalDiagnostic[]): void {
  if (!isRecord(value)) {
    diagnostics.push({ path, message: 'must be a JSON object' })
    return
  }
  for (const [key, count] of Object.entries(value)) {
    if (!COUNT_KEYS.includes(key as keyof RpEvalExpectedCounts)) diagnostics.push({ path: `${path}.${key}`, message: 'is not a supported counter' })
    else if (!Number.isSafeInteger(count) || (count as number) < 0) diagnostics.push({ path: `${path}.${key}`, message: 'must be a non-negative safe integer' })
  }
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  diagnostics: RpEvalDiagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) diagnostics.push({ path: `${path}.${key}`, message: 'is not a supported field' })
  }
}

function assertCanonicalEqual(
  diagnostics: RpEvalDiagnostic[],
  path: string,
  expected: unknown,
  actual: unknown,
): void {
  if (hashRpEvalValue(expected) !== hashRpEvalValue(actual)) mismatch(diagnostics, path, expected, actual)
}

function mismatch(diagnostics: RpEvalDiagnostic[], path: string, expected: unknown, actual: unknown): void {
  diagnostics.push({ path, message: `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}` })
}

function canonicalJson(value: unknown, ancestors: Set<object>, path: string): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error(`${path} is not losslessly JSON-serializable`)
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') throw new Error(`${path} is not losslessly JSON-serializable`)
  if (ancestors.has(value)) throw new Error(`${path} contains a cycle`)
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new Error(`${path}[${index}] is a sparse array slot`)
      }
      return `[${value.map((item, index) => canonicalJson(item, ancestors, `${path}[${index}]`)).join(',')}]`
    }
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} is not a plain JSON object`)
    return `{${Object.keys(value).sort().map((key) => {
      const child = (value as Record<string, unknown>)[key]
      return `${JSON.stringify(key)}:${canonicalJson(child, ancestors, `${path}.${key}`)}`
    }).join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isJsonValue(value: unknown): boolean {
  try {
    canonicalJson(value, new Set(), '$')
    return true
  } catch {
    return false
  }
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
