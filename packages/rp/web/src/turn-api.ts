/** Policy-bound Headless/Web entrypoint for one atomic RP turn. @module @dsh-rp/web/turn-api */

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  JsonObject,
  JsonValue,
  MediaArtifact,
  RpBudget,
  RpModelMediaInput,
  RpScopeKind,
  RpScopeRef,
  RpTrustLevel,
} from '@dsh-rp/contracts'
import type { RpAuthorityDecision } from '@dsh-rp/policy'
import { RpMediaInputError } from '@dsh-rp/media'
import type { RpTurnCommit } from '@dsh-rp/turn-runtime'
import type {
  RpWebMediaInput,
  RpWebTurnResponse,
} from './types.ts'

/** Deployment-owned authority and admission policy for the public Turn API. */
export interface RpWebTurnApiConfig {
  /** Whether the executor admits work. */
  readonly enabled: boolean
  /** Experience selected when a request omits `experienceId`. */
  readonly defaultExperience: string
  /** Experiences remote callers may select. */
  readonly allowedExperiences: readonly string[]
  /** Permission ceiling supplied to RP Policy. */
  readonly permissions: readonly string[]
  /** Trust ceiling supplied to RP Policy. */
  readonly maxTrust: RpTrustLevel
  /** Composition capabilities granted by deployment. */
  readonly grantedCapabilities: readonly string[]
  /** Per-Turn resource ceiling. */
  readonly budget: RpBudget
  /** Exact network domains deployment grants. */
  readonly networkDomains: readonly string[]
  /** Exact filesystem roots deployment grants. */
  readonly fileRoots: readonly string[]
  /** Optional transport bearer secret. */
  readonly bearerToken?: string
  /** Maximum accepted raw HTTP JSON body size. */
  readonly maxRequestBytes: number
}

/** Stable public failure taxonomy used by both in-process and HTTP clients. */
export class RpWebTurnError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_REQUEST'
      | 'ACCESS_DENIED'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'BUSY'
      | 'CANCELLED'
      | 'DURABILITY'
      | 'EXECUTION_FAILED',
    readonly detail?: unknown,
  ) {
    super(message, detail === undefined ? undefined : { cause: detail })
    this.name = 'RpWebTurnError'
  }
}

interface NormalizedTurnRequest {
  readonly requestId: string
  readonly sessionId: string
  readonly agentId: string
  readonly experienceId: string
  readonly scope: RpScopeRef
  readonly input: JsonValue
  readonly media: readonly RpWebMediaInput[]
  readonly context: JsonObject
  readonly fingerprint: string
}

interface ExistingTurn {
  readonly turnId: string
  readonly fingerprint: string
  readonly commit?: RpTurnCommit
  readonly aborted: boolean
}

interface RpTurnHostServices {
  readonly sessions: Context['sessions']
  readonly agents: Context['agents']
  readonly experiences: Context['rpExperiences']
  readonly policy: Context['rpPolicy']
  readonly projection: Context['rpProjection']
  readonly turn: Context['rpTurn']
  readonly media: Context['rpMedia']
}

/** One apply-scoped Turn executor with all required Cordis services captured. */
export interface RpWebTurnExecutor {
  /**
   * Execute one untrusted JSON request.
   * @param raw - Parsed request body.
   * @param signal - Optional transport cancellation.
   * @returns Durable committed response or an idempotent replay after the
   * live Session crosses its persistence barrier.
   * @throws {RpWebTurnError} Before commit for invalid input, admission,
   * concurrency, cancellation, or execution failures. `DURABILITY` means the
   * Turn committed in memory but persistence is uncertain; only the identical
   * payload with the same `requestId` is a supported retry.
   */
  (raw: unknown, signal?: AbortSignal): Promise<RpWebTurnResponse>
}

/**
 * Capture the required Host services while the owning plugin's injections are active.
 * @param ctx - Injected Host plugin Context.
 * @param config - Deployment-owned Turn API policy.
 * @returns Executor safe to retain in an HTTP handler.
 */
export function createRpTurnExecutor(ctx: Context, config: RpWebTurnApiConfig): RpWebTurnExecutor {
  const host: RpTurnHostServices = Object.freeze({
    sessions: ctx.sessions,
    agents: ctx.agents,
    experiences: ctx.rpExperiences,
    policy: ctx.rpPolicy,
    projection: ctx.rpProjection,
    turn: ctx.rpTurn,
    media: ctx.rpMedia,
  })
  return async (raw, signal) => await executeWithHost(host, raw, config, signal)
}

/**
 * Execute one remote request through a real live Harness Agent and its Session.
 * The caller cannot provide authority: every ceiling comes from `config` and
 * registered deployment/product policy layers.
 * @param ctx - Fully composed Host Context.
 * @param raw - Untrusted parsed JSON request.
 * @param config - Deployment-owned API policy.
 * @param signal - Transport cancellation.
 * @returns Durable committed response or an idempotent replay after the
 * Session persistence barrier.
 * @throws {RpWebTurnError} With the same failure and durability distinctions
 * as {@link RpWebTurnExecutor}.
 */
export async function executeRpTurn(
  ctx: Context,
  raw: unknown,
  config: RpWebTurnApiConfig,
  signal?: AbortSignal,
): Promise<RpWebTurnResponse> {
  return await createRpTurnExecutor(ctx, config)(raw, signal)
}

async function executeWithHost(
  host: RpTurnHostServices,
  raw: unknown,
  config: RpWebTurnApiConfig,
  signal?: AbortSignal,
): Promise<RpWebTurnResponse> {
  if (!config.enabled) throw new RpWebTurnError('RP Turn API is disabled by deployment policy', 'ACCESS_DENIED')
  const request = normalizeRequest(raw, config)
  if (request.sessionId !== request.agentId) {
    throw new RpWebTurnError('agentId must identify the same live identity as sessionId', 'CONFLICT')
  }
  const sessionId = SessionId(request.sessionId)
  const session = host.sessions.get(sessionId)
  if (session === undefined) throw new RpWebTurnError('The requested Session is not live', 'NOT_FOUND')
  const agent = host.agents.get(SessionId(request.agentId))
  if (agent === undefined) throw new RpWebTurnError('The requested Agent is not live', 'NOT_FOUND')
  if (agent.id !== session.id || agent.session !== session) {
    throw new RpWebTurnError('The requested Agent does not own the requested live Session', 'CONFLICT')
  }

  let experience
  try {
    experience = host.experiences.select({
      requested: request.experienceId,
      allowed: config.allowedExperiences,
    }).experience
  } catch (error: unknown) {
    const code = isRecord(error) ? error.code : undefined
    if (code === 'DENIED') throw new RpWebTurnError('The requested Experience is denied by deployment policy', 'ACCESS_DENIED', error)
    if (code === 'MISSING') throw new RpWebTurnError('The requested Experience is not registered', 'NOT_FOUND', error)
    throw new RpWebTurnError('The requested Experience is invalid', 'INVALID_REQUEST', error)
  }

  const existing = existingTurn(session.events, request.requestId)
  if (existing !== undefined) {
    if (existing.fingerprint !== request.fingerprint) {
      throw new RpWebTurnError('requestId was already used for a different RP Turn payload', 'CONFLICT')
    }
    if (existing.commit !== undefined) {
      await crossDurabilityBarrier(host, session, String(existing.commit.record.turnId))
      return response(host, request, existing.commit, true, resolveAuthority(host, config))
    }
    if (existing.aborted) {
      throw new RpWebTurnError('requestId belongs to an already aborted RP Turn; submit a new requestId', 'CONFLICT')
    }
    throw new RpWebTurnError('requestId already has an RP Turn in progress', 'BUSY')
  }

  const authority = resolveAuthority(host, config)
  if (signal?.aborted === true) throw cancelled(signal.reason)

  let operation: Promise<RpWebTurnResponse>
  try {
    operation = agent.runMaintenance(async (agentSignal) => {
      const operationSignal = signal === undefined
        ? agentSignal
        : AbortSignal.any([agentSignal, signal])
      try {
        const media = await ingestMedia(host, request.media, authority, operationSignal)
        const commit = await host.agents.withInitiator(agent, async () => await host.turn.run({
          session,
          experience,
          scope: request.scope,
          input: request.input,
          ...(media.artifacts.length === 0 ? {} : { media: media.artifacts, content: media.content }),
          grantedCapabilities: config.grantedCapabilities,
          signal: operationSignal,
          context: {
            client: request.context,
            transport: {
              kind: 'rp-turn-api',
              requestId: request.requestId,
              fingerprint: request.fingerprint,
              agentId: request.agentId,
            },
          },
          authority: {
            budget: authority.budget,
            grantedPermissions: authority.permissions,
            grantedTrust: authority.trust,
            networkDomains: authority.networkDomains,
            fileRoots: authority.fileRoots,
          },
        }))
        projectCommittedTurnToChat(session, request, commit)
        await crossDurabilityBarrier(host, session, String(commit.record.turnId))
        return response(host, request, commit, false, authority)
      } catch (error: unknown) {
        if (error instanceof RpWebTurnError) throw error
        if (operationSignal.aborted) throw cancelled(operationSignal.reason)
        throw executionFailure(error)
      }
    })
  } catch (error: unknown) {
    throw new RpWebTurnError('The live Agent already has active turn or maintenance work', 'BUSY', error)
  }
  return await operation
}

/**
 * Publish the committed RP dialogue through DSH's standard transcript events.
 * RP events remain the audit source; these six events are the resident Chat
 * projection and cross the same persistence barrier as the RP commit.
 */
function projectCommittedTurnToChat(
  session: Session,
  request: NormalizedTurnRequest,
  commit: RpTurnCommit,
): void {
  const turn = (session.events.findLast(event => event.type === 'turn/start')?.data.turn ?? 0) + 1
  const input = displayInput(request.input)
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: input === '' ? [] : [{ type: 'text', text: input }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: commit.record.assistantMessage }],
      source: { provider: 'dsh-rp', model: request.experienceId },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function displayInput(input: JsonValue): string {
  if (typeof input === 'string') return input
  if (isRecord(input) && typeof input.text === 'string') return input.text
  if (input === null) return ''
  return JSON.stringify(input)
}

async function crossDurabilityBarrier(
  host: RpTurnHostServices,
  session: Parameters<Context['sessions']['flush']>[0],
  turnId: string,
): Promise<void> {
  try {
    const participated = await host.sessions.flush(session)
    if (!participated) throw new Error('no session persistence listener participated')
  } catch (error: unknown) {
    throw new RpWebTurnError(
      `RP Turn ${JSON.stringify(turnId)} committed in memory but did not cross the durability barrier`,
      'DURABILITY',
      error,
    )
  }
}

function normalizeRequest(raw: unknown, config: RpWebTurnApiConfig): NormalizedTurnRequest {
  if (!isPlainDataRecord(raw)) throw invalid('request must be a plain JSON object without accessors')
  const allowed = new Set([
    'schemaVersion', 'requestId', 'sessionId', 'agentId', 'experienceId', 'scope', 'input', 'media', 'context',
  ])
  const unknown = Object.keys(raw).find(key => !allowed.has(key))
  if (unknown !== undefined) throw invalid(`request contains unsupported field ${JSON.stringify(unknown)}`)
  if (raw.schemaVersion !== 1) throw invalid('schemaVersion must be 1')
  const requestId = normalizedId(raw.requestId, 'requestId', 128)
  if (!/^[A-Za-z0-9._:-]+$/u.test(requestId)) {
    throw invalid('requestId may contain only ASCII letters, digits, dot, underscore, colon, and hyphen')
  }
  const sessionId = normalizedId(raw.sessionId, 'sessionId', 512)
  const agentId = normalizedId(raw.agentId, 'agentId', 512)
  const experienceId = raw.experienceId === undefined
    ? config.defaultExperience
    : normalizedId(raw.experienceId, 'experienceId', 256)
  const scope = raw.scope === undefined
    ? freezeScope({ kind: 'conversation', id: sessionId })
    : parseScope(raw.scope)
  validateRequestScope(scope, sessionId, agentId)
  if (!Object.hasOwn(raw, 'input')) throw invalid('input is required')
  const input = detachJson(raw.input, 'input')
  const media = normalizeMedia(raw.media)
  const context = raw.context === undefined ? Object.freeze({}) : detachObject(raw.context, 'context')
  const payload: JsonObject = {
    schemaVersion: 1,
    sessionId,
    agentId,
    experienceId,
    scope: scope as unknown as JsonValue,
    input,
    ...(media.length === 0 ? {} : { media: media as unknown as JsonValue }),
    context,
  }
  const encoded = stableStringify({ requestId, ...payload })
  if (new TextEncoder().encode(encoded).byteLength > config.maxRequestBytes) {
    throw invalid(`normalized request exceeds ${String(config.maxRequestBytes)} bytes`)
  }
  const fingerprint = createHash('sha256').update(stableStringify(payload)).digest('hex')
  return Object.freeze({ requestId, sessionId, agentId, experienceId, scope, input, media, context, fingerprint })
}

function normalizeMedia(value: unknown): readonly RpWebMediaInput[] {
  if (value === undefined) return Object.freeze([])
  const detached = detachJson(value, 'media')
  if (!Array.isArray(detached)) throw invalid('media must be an array')
  if (detached.length > 64) throw invalid('media may contain at most 64 transport inputs')
  return Object.freeze(detached.map((candidate, index): RpWebMediaInput => {
    if (!isRecord(candidate)) throw invalid(`media[${String(index)}] must be an object`)
    const allowed = new Set(['schemaVersion', 'kind', 'mediaType', 'data', 'name', 'adapter'])
    const unknown = Object.keys(candidate).find(key => !allowed.has(key))
    if (unknown !== undefined) throw invalid(`media[${String(index)}] contains unsupported field ${JSON.stringify(unknown)}`)
    if (candidate.schemaVersion !== 1 || candidate.kind !== 'image') {
      throw invalid(`media[${String(index)}] must be a schemaVersion 1 image`)
    }
    if (!isImageMediaType(candidate.mediaType)) {
      throw invalid(`media[${String(index)}].mediaType is unsupported`)
    }
    if (typeof candidate.data !== 'string' || candidate.data.length === 0
      || Buffer.from(candidate.data, 'base64').toString('base64') !== candidate.data) {
      throw invalid(`media[${String(index)}].data must be canonical padded Base64`)
    }
    const name = candidate.name === undefined ? undefined : normalizedId(candidate.name, `media[${String(index)}].name`, 256)
    const adapter = candidate.adapter === undefined
      ? undefined
      : normalizedId(candidate.adapter, `media[${String(index)}].adapter`, 128)
    return Object.freeze({
      schemaVersion: 1,
      kind: 'image',
      mediaType: candidate.mediaType,
      data: candidate.data,
      ...(name === undefined ? {} : { name }),
      ...(adapter === undefined ? {} : { adapter }),
    })
  }))
}

async function ingestMedia(
  host: RpTurnHostServices,
  inputs: readonly RpWebMediaInput[],
  authority: RpAuthorityDecision,
  signal: AbortSignal,
): Promise<{ readonly artifacts: readonly MediaArtifact[]; readonly content: readonly RpModelMediaInput[] }> {
  if (inputs.length === 0) return Object.freeze({ artifacts: Object.freeze([]), content: Object.freeze([]) })
  try {
    const artifacts = await host.media.ingestInputs(inputs.map(input => Object.freeze({
      kind: input.kind,
      mimeType: input.mediaType,
      data: new Uint8Array(Buffer.from(input.data, 'base64')),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.adapter === undefined ? {} : { adapter: input.adapter }),
    })), {
      trust: authority.trust,
      permissions: authority.permissions,
    }, signal)
    const content = Object.freeze(artifacts.map(artifact => host.media.modelInput(artifact)))
    return Object.freeze({ artifacts, content })
  } catch (error: unknown) {
    if (!(error instanceof RpMediaInputError)) throw error
    if (error.code === 'DENIED') {
      throw new RpWebTurnError('RP media input was denied by effective authority', 'ACCESS_DENIED', error)
    }
    if (error.code === 'INVALID') {
      throw new RpWebTurnError('RP media input was rejected', 'INVALID_REQUEST', error)
    }
    throw new RpWebTurnError('RP media input could not be materialized', 'EXECUTION_FAILED', error)
  }
}

function isImageMediaType(value: unknown): value is RpWebMediaInput['mediaType'] {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function resolveAuthority(host: RpTurnHostServices, config: RpWebTurnApiConfig): RpAuthorityDecision {
  try {
    return host.policy.resolve({
      requestedPermissions: config.permissions,
      requestedTrust: config.maxTrust,
      budget: config.budget,
      networkDomains: config.networkDomains,
      fileRoots: config.fileRoots,
    })
  } catch (error: unknown) {
    throw new RpWebTurnError('Deployment policy denied this RP Turn authority', 'ACCESS_DENIED', error)
  }
}

function existingTurn(events: readonly SessionEvent[], requestId: string): ExistingTurn | undefined {
  let turnId: string | undefined
  let fingerprint: string | undefined
  for (const event of events) {
    if (event.type !== 'rp/context-activated') continue
    const supplied = recordValue(event.data.context, 'supplied')
    const transport = recordValue(supplied, 'transport')
    if (transport?.kind !== 'rp-turn-api' || transport.requestId !== requestId) continue
    if (turnId !== undefined) throw new RpWebTurnError('requestId appears in more than one RP Turn context', 'CONFLICT')
    turnId = String(event.data.turnId)
    fingerprint = typeof transport.fingerprint === 'string' ? transport.fingerprint : ''
  }
  if (turnId === undefined || fingerprint === undefined) return undefined
  for (const event of events) {
    if (event.type === 'rp/turn-committed') {
      if (String(event.data.turnId) !== turnId) continue
      return Object.freeze({
        turnId,
        fingerprint,
        commit: Object.freeze({ record: event.data, eventSeq: event.seq }),
        aborted: false,
      })
    }
    if (event.type === 'rp/turn-aborted' && String(event.data.turnId) === turnId) {
      return Object.freeze({ turnId, fingerprint, aborted: true })
    }
  }
  return Object.freeze({ turnId, fingerprint, aborted: false })
}

function response(
  host: RpTurnHostServices,
  request: NormalizedTurnRequest,
  commit: RpTurnCommit,
  replayed: boolean,
  authority: RpAuthorityDecision,
): RpWebTurnResponse {
  return Object.freeze({
    schemaVersion: 1,
    requestId: request.requestId,
    replayed,
    sessionId: request.sessionId,
    agentId: request.agentId,
    experienceId: request.experienceId,
    turnId: String(commit.record.turnId),
    eventSeq: commit.eventSeq,
    assistantMessage: commit.record.assistantMessage,
    ...(commit.record.usage === undefined ? {} : { usage: commit.record.usage }),
    authority: Object.freeze({
      permissions: authority.permissions,
      trust: authority.trust,
      budget: authority.budget,
      layers: authority.layers,
    }),
    projection: host.projection.projectScope(
      host.sessions.get(SessionId(request.sessionId)) ?? missingSession(),
      request.scope,
    ) as unknown as JsonValue,
  })
}

function parseScope(value: unknown, depth = 0): RpScopeRef {
  if (!isPlainDataRecord(value)) throw invalid('scope must be a plain JSON object without accessors')
  if (depth >= 7) throw invalid('scope parent chain exceeds seven levels')
  const allowed = new Set(['kind', 'id', 'parent'])
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown !== undefined) throw invalid(`scope contains unsupported field ${JSON.stringify(unknown)}`)
  if (!isScopeKind(value.kind)) throw invalid('scope.kind is invalid')
  const id = normalizedId(value.id, 'scope.id', 256)
  const parent = value.parent === undefined ? undefined : parseScope(value.parent, depth + 1)
  if (parent !== undefined && scopeRank(parent.kind) >= scopeRank(value.kind)) {
    throw invalid('scope parents must move strictly toward a broader lifetime')
  }
  return freezeScope({ kind: value.kind, id, ...(parent === undefined ? {} : { parent }) })
}

function freezeScope(scope: RpScopeRef): RpScopeRef {
  return Object.freeze({
    kind: scope.kind,
    id: scope.id,
    ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }),
  })
}

function validateRequestScope(scope: RpScopeRef, sessionId: string, agentId: string): void {
  if (!['conversation', 'scene', 'turn', 'agent'].includes(scope.kind)) {
    throw invalid('scope must resolve inside the requested conversation')
  }
  let current: RpScopeRef | undefined = scope
  let conversation = false
  while (current !== undefined) {
    if (current.kind === 'conversation') {
      if (conversation || current.id !== sessionId) {
        throw invalid('scope conversation must identify the requested live Session exactly once')
      }
      conversation = true
    }
    if (current.kind === 'agent' && current.id !== agentId) {
      throw invalid('scope agent must identify the requested live Agent')
    }
    current = current.parent
  }
  if (!conversation) throw invalid('scope must be anchored to the requested live Session conversation')
}

function isScopeKind(value: unknown): value is RpScopeKind {
  return typeof value === 'string' && [
    'deployment', 'experience', 'profile', 'conversation', 'scene', 'turn', 'agent',
  ].includes(value)
}

function scopeRank(kind: RpScopeKind): number {
  return ['deployment', 'experience', 'profile', 'conversation', 'scene', 'turn', 'agent'].indexOf(kind)
}

function normalizedId(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim() || value.length > max) {
    throw invalid(`${field} must be a normalized non-empty string of at most ${max} characters`)
  }
  return value
}

function detachObject(value: unknown, field: string): JsonObject {
  const detached = detachJson(value, field)
  if (!isRecord(detached)) throw invalid(`${field} must be a JSON object`)
  return deepFreeze(detached)
}

function detachJson(value: unknown, field: string): JsonValue {
  validateJson(value, field, new Set<object>())
  return deepFreeze(JSON.parse(JSON.stringify(value)) as JsonValue)
}

function validateJson(value: unknown, field: string, ancestors: Set<object>): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw invalid(`${field} contains a non-lossless JSON number`)
    return
  }
  if (typeof value !== 'object') throw invalid(`${field} contains a non-JSON value`)
  if (ancestors.has(value)) throw invalid(`${field} contains a cycle`)
  const prototype: unknown = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw invalid(`${field} must contain only plain JSON objects`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw invalid(`${field} contains symbol properties`)
  ancestors.add(value)
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw invalid(`${field} contains non-index array properties`)
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index)
      if (descriptor === undefined) throw invalid(`${field} contains a sparse array`)
      if (!descriptor.enumerable || !('value' in descriptor)) throw invalid(`${field} contains an accessor`)
      validateJson(descriptor.value, field, ancestors)
    }
  } else {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || !('value' in descriptor)) throw invalid(`${field} contains an accessor`)
      validateJson(descriptor.value, field, ancestors)
    }
  }
  ancestors.delete(value)
}

function deepFreeze<T extends JsonValue>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Array.isArray(value) ? value : Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`).join(',')}}`
}

function recordValue(value: unknown, key: string): Record<string, JsonValue> | undefined {
  if (!isRecord(value)) return undefined
  const child = value[key]
  return isRecord(child) ? child as Record<string, JsonValue> : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  if (Object.getOwnPropertySymbols(value).length > 0) return false
  return Object.values(Object.getOwnPropertyDescriptors(value))
    .every(descriptor => descriptor.enumerable && 'value' in descriptor)
}

function invalid(message: string): RpWebTurnError {
  return new RpWebTurnError(message, 'INVALID_REQUEST')
}

function cancelled(reason: unknown): RpWebTurnError {
  return new RpWebTurnError('RP Turn was cancelled before commit', 'CANCELLED', reason)
}

function executionFailure(error: unknown): RpWebTurnError {
  if (hasErrorCode(error, new Set(['AUTHORITY_DENIED', 'TRUST_DENIED', 'PERMISSION']))) {
    return new RpWebTurnError('RP Turn execution was denied by effective authority', 'ACCESS_DENIED', error)
  }
  return new RpWebTurnError('RP Turn execution failed before commit', 'EXECUTION_FAILED', error)
}

function hasErrorCode(error: unknown, codes: ReadonlySet<string>, seen = new Set<object>()): boolean {
  if (!isRecord(error) || seen.has(error)) return false
  seen.add(error)
  if (typeof error.code === 'string' && codes.has(error.code)) return true
  if (hasErrorCode(error.cause, codes, seen)) return true
  return Array.isArray(error.errors) && error.errors.some(child => hasErrorCode(child, codes, seen))
}

function missingSession(): never {
  throw new RpWebTurnError('The live Session disappeared before response projection', 'CONFLICT')
}
