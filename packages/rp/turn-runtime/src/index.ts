/** RP turn transaction coordinator. @module @dsh-rp/turn-runtime */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { RpTurnId } from '@dsh-rp/contracts'
import type { JsonObject, JsonValue } from '@dsh-rp/contracts'
import type { RpAgentRecord, RpCompositionRecord, RpPipelineRecord, RpTurnCommitRecord } from '@dsh-rp/journal'
import type { RpPipelinePlan, RpPipelineRunInfo, RpPipelineRunObserver, RpPipelineRunResult } from '@dsh-rp/pipeline-runtime'
import type {
  RpTurnCommit,
  RpTurnContextSnapshot,
  RpTurnDraft,
  RpTurnEffects,
  RpTurnOutcome,
  RpTurnRequest,
} from './types.ts'

export type * from './types.ts'

/** Canonical Pipeline frame key carrying a validated turn-effect proposal. */
export const RP_TURN_EFFECTS_KEY = 'turn.effects'

declare module '@deepseek-ai/cordis' {
  interface Context {
    rpTurn: RpTurnRuntime
  }

  interface Events {
    /**
     * A turn transaction froze its composition.
     * @param draft - Prepared turn.
     * @mode emit
     */
    'rp/turn-transaction-prepared'(draft: RpTurnDraft): void
    /**
     * A turn transaction committed.
     * @param outcome - Committed turn.
     * @mode emit
     */
    'rp/turn-transaction-committed'(outcome: RpTurnOutcome): void
    /**
     * A turn transaction aborted.
     * @param turnId - Aborted turn.
     * @mode emit
     */
    'rp/turn-transaction-aborted'(turnId: RpTurnId): void
  }
}

/** Turn lifecycle or validation failure. */
export class RpTurnError extends Error {
  /** Machine-readable failure category. */
  readonly code: 'PIPELINE_MISSING' | 'INVALID_OUTPUT' | 'INVALID_STATE' | 'ALREADY_TERMINAL' | 'NOT_EXECUTED'

  /** @param message - Human-readable failure. @param code - Stable category. */
  constructor(message: string, code: RpTurnError['code']) {
    super(message)
    this.name = 'RpTurnError'
    this.code = code
  }
}

/** Coordinates prepare, execute, validate, commit, and abort around one Session event. */
export class RpTurnRuntime extends Service {
  static inject = ['rpComponents', 'rpPipelines', 'rpProjection', 'rpJournal']

  private readonly states = new Map<RpTurnId, 'prepared' | 'executed' | 'committed' | 'aborted'>()
  private readonly plans = new Map<RpTurnId, RpPipelinePlan>()
  private readonly components: Context['rpComponents']
  private readonly pipelines: Context['rpPipelines']
  private readonly projection: Context['rpProjection']
  private readonly journal: Context['rpJournal']

  constructor(ctx: Context) {
    super(ctx, 'rpTurn')
    this.components = ctx.rpComponents
    this.pipelines = ctx.rpPipelines
    this.projection = ctx.rpProjection
    this.journal = ctx.rpJournal
  }

  /**
   * Freeze the component and turn-pipeline identities before execution.
   * @param request - Session, Experience, input, and authority.
   * @returns Prepared transaction.
   */
  prepare(request: RpTurnRequest): RpTurnDraft {
    const pipelineId = request.experience.pipelines.turn
    if (pipelineId === undefined) throw new RpTurnError(`RP Experience ${JSON.stringify(request.experience.id)} has no turn pipeline`, 'PIPELINE_MISSING')
    const id = RpTurnId(randomUUID())
    const composition = this.components.resolve({
      scope: request.scope,
      components: request.experience.components,
      grantedCapabilities: request.grantedCapabilities,
    })
    const plan = this.pipelines.capture(pipelineId)
    const pipeline = plan.snapshot
    const media = freezeJson(cloneJson(request.media ?? [])) as unknown as RpTurnContextSnapshot['media']
    const content = freezeJson(cloneJson(request.content ?? [])) as unknown as RpTurnContextSnapshot['content']
    if (media.length !== content.length) {
      throw new RpTurnError('RP turn media artifacts and model inputs must have identical cardinality', 'INVALID_OUTPUT')
    }
    const context = freezeTurnContext(
      this.projection.projectScope(request.session, request.scope),
      request.context,
      media,
      content,
      this.ctx.get('rpPresets')?.capture(request.scope),
      this.ctx.get('rpLibrary')?.capture(request.scope),
    )
    const draft: RpTurnDraft = Object.freeze({ id, request, composition, pipeline, context, preparedAt: Date.now() })
    this.states.set(id, 'prepared')
    this.plans.set(id, plan)
    this.journal.append(request.session, 'rp/composition-resolved', compositionRecord(draft))
    this.journal.append(request.session, 'rp/context-activated', {
      schemaVersion: 1,
      turnId: id,
      input: request.input,
      context: context as unknown as JsonObject,
      ...(media.length === 0 ? {} : { media }),
      ...(content.length === 0 ? {} : { content }),
    })
    this.ctx.emit('rp/turn-transaction-prepared', draft)
    return draft
  }

  /**
   * Run the frozen turn pipeline and validate typed effects.
   * @param draft - Prepared transaction.
   * @param effects - Optional compatibility override; normal Pipelines publish `turn.effects`.
   * @returns Executed outcome.
   */
  async execute(draft: RpTurnDraft, effects?: RpTurnEffects): Promise<RpTurnOutcome> {
    this.requireState(draft.id, 'prepared')
    if (effects !== undefined) validateEffects(effects)
    const plan = this.plans.get(draft.id)
    if (plan === undefined) throw new RpTurnError('RP turn lost its frozen executable Pipeline plan', 'INVALID_STATE')
    const pipeline = await this.pipelines.runPlan(plan, {
      scope: draft.request.scope,
      input: draft.request.input,
      ...(draft.request.signal === undefined ? {} : { signal: draft.request.signal }),
      ...draft.request.authority,
      metadata: {
        schemaVersion: 1,
        turnId: draft.id,
        experienceId: draft.request.experience.id,
        compositionId: draft.composition.id,
        turnContext: draft.context as unknown as JsonValue,
      },
      observer: pipelineJournalObserver(this.journal, draft.request.session, draft.id),
    })
    if (pipeline.snapshot.hash !== draft.pipeline.hash) {
      throw new RpTurnError('RP pipeline changed after the turn snapshot was frozen', 'INVALID_STATE')
    }
    const resolvedEffects = effects ?? effectsFromPipeline(pipeline)
    const outcome: RpTurnOutcome = Object.freeze({ draft, pipeline, effects: freezeEffects(resolvedEffects) })
    this.validate(outcome)
    this.states.set(draft.id, 'executed')
    return outcome
  }

  /**
   * Validate an executed outcome before its atomic journal commit.
   * @param outcome - Pipeline result and detached domain effects.
   */
  validate(outcome: RpTurnOutcome): void {
    if (outcome.pipeline.snapshot.hash !== outcome.draft.pipeline.hash) {
      throw new RpTurnError('RP pipeline outcome does not match the frozen turn snapshot', 'INVALID_STATE')
    }
    validateEffects(outcome.effects)
    validateEffectsAgainstSnapshot(outcome.effects, outcome.draft.context)
  }

  /**
   * Execute the complete prepare → Pipeline → validate → commit transaction.
   * Any admitted failure receives one terminal abort event and no turn commit.
   * @param request - Complete turn request.
   * @returns Atomic committed record.
   */
  async run(request: RpTurnRequest): Promise<RpTurnCommit> {
    const draft = this.prepare(request)
    try {
      const outcome = await this.execute(draft)
      return this.commit(outcome)
    } catch (error: unknown) {
      const state = this.states.get(draft.id)
      if (state === 'prepared' || state === 'executed') {
        try { this.abort(draft, renderError(error)) }
        catch (abortError: unknown) {
          throw new AggregateError([error, abortError], `RP turn ${JSON.stringify(draft.id)} failed and could not record its abort`)
        }
      }
      throw error
    }
  }

  /**
   * Commit all domain effects as one durable event.
   * @param outcome - Executed, validated transaction.
   * @returns Commit record and Session sequence.
   */
  commit(outcome: RpTurnOutcome): RpTurnCommit {
    this.requireState(outcome.draft.id, 'executed')
    const record: RpTurnCommitRecord = Object.freeze({
      schemaVersion: 1,
      turnId: outcome.draft.id,
      composition: compositionRecord(outcome.draft),
      pipeline: pipelineRecord(outcome.draft),
      assistantMessage: outcome.effects.assistantMessage,
      ...(outcome.effects.state === undefined ? {} : { state: outcome.effects.state }),
      ...(outcome.effects.statePatch === undefined ? {} : { statePatch: outcome.effects.statePatch }),
      ...(outcome.effects.memories === undefined ? {} : { memories: outcome.effects.memories }),
      ...(outcome.effects.relationships === undefined ? {} : { relationships: outcome.effects.relationships }),
      ...(outcome.effects.scene === undefined ? {} : { scene: outcome.effects.scene }),
      ...(outcome.effects.branch === undefined ? {} : { branch: outcome.effects.branch }),
      ...commitTraces(outcome),
      ...(outcome.effects.usage === undefined ? {} : { usage: outcome.effects.usage }),
      ...(outcome.effects.metadata === undefined ? {} : { metadata: outcome.effects.metadata }),
      committedAt: Date.now(),
    })
    const event = this.journal.commitTurn(outcome.draft.request.session, record)
    this.states.set(outcome.draft.id, 'committed')
    this.plans.delete(outcome.draft.id)
    this.ctx.emit('rp/turn-transaction-committed', outcome)
    return Object.freeze({ record: event.data, eventSeq: event.seq })
  }

  /**
   * Abort a prepared or executed turn without publishing partial effects.
   * @param draft - Turn to abort.
   * @param reason - Non-empty terminal reason.
   * @returns Nothing.
   */
  abort(draft: RpTurnDraft, reason: string): void {
    const state = this.states.get(draft.id)
    if (state !== 'prepared' && state !== 'executed') {
      throw new RpTurnError(`RP turn ${JSON.stringify(draft.id)} is already terminal`, 'ALREADY_TERMINAL')
    }
    if (reason.length === 0) throw new RpTurnError('RP turn abort reason must be non-empty', 'INVALID_OUTPUT')
    this.journal.abortTurn(draft.request.session, {
      schemaVersion: 1,
      turnId: draft.id,
      reason,
      abortedAt: Date.now(),
    })
    this.states.set(draft.id, 'aborted')
    this.plans.delete(draft.id)
    this.ctx.emit('rp/turn-transaction-aborted', draft.id)
  }

  /** Require an exact non-terminal transaction phase. */
  private requireState(turnId: RpTurnId, expected: 'prepared' | 'executed'): void {
    const state = this.states.get(turnId)
    if (state === 'committed' || state === 'aborted') {
      throw new RpTurnError(`RP turn ${JSON.stringify(turnId)} is already terminal`, 'ALREADY_TERMINAL')
    }
    if (state !== expected) {
      throw new RpTurnError(`RP turn ${JSON.stringify(turnId)} must be ${expected}, received ${state ?? 'unknown'}`, 'NOT_EXECUTED')
    }
  }
}

function pipelineJournalObserver(
  journal: Context['rpJournal'],
  session: RpTurnRequest['session'],
  turnId: RpTurnId,
): RpPipelineRunObserver {
  const record = (info: RpPipelineRunInfo): RpPipelineRecord => Object.freeze({
    turnId,
    pipelineId: info.pipelineId,
    snapshotHash: info.snapshotHash,
    kind: info.kind,
  })
  return Object.freeze({
    started(info: RpPipelineRunInfo) { journal.append(session, 'rp/pipeline-started', record(info)) },
    stage(info: RpPipelineRunInfo, stageId: string, outcome: 'completed' | 'continued') {
      journal.append(session, 'rp/pipeline-stage', { ...record(info), stageId, outcome })
    },
    completed(info: RpPipelineRunInfo) { journal.append(session, 'rp/pipeline-completed', record(info)) },
    failed(info: RpPipelineRunInfo, error: string) {
      journal.append(session, 'rp/pipeline-failed', { ...record(info), error })
    },
  })
}

/** Build the durable composition identity shared by prepare and commit. */
function compositionRecord(draft: RpTurnDraft): RpCompositionRecord {
  return Object.freeze({
    turnId: draft.id,
    compositionId: draft.composition.id,
    componentIds: Object.freeze(draft.composition.components.map(component => String(component.id))),
    scope: draft.composition.scope,
  })
}

/** Build the durable pipeline identity shared by execute and commit. */
function pipelineRecord(draft: RpTurnDraft): RpPipelineRecord {
  return Object.freeze({
    turnId: draft.id,
    pipelineId: draft.pipeline.id,
    snapshotHash: draft.pipeline.hash,
    kind: draft.pipeline.kind,
  })
}

/** Collect durable Agent and actual Stage settlements into the atomic commit. */
function commitTraces(outcome: RpTurnOutcome): Pick<RpTurnCommitRecord, 'agentTrace' | 'pipelineTrace'> {
  const { session } = outcome.draft.request
  const turnId = outcome.draft.id
  const agentTrace: RpAgentRecord[] = []
  const pipelineTrace: JsonObject[] = []
  for (const event of session.events) {
    if (event.type === 'rp/agent-started' || event.type === 'rp/agent-delegated'
      || event.type === 'rp/agent-completed' || event.type === 'rp/agent-interrupted') {
      if (event.data.turnId === turnId) agentTrace.push(event.data)
    } else if (event.type === 'rp/pipeline-stage' && event.data.turnId === turnId) {
      pipelineTrace.push(Object.freeze({
        pipelineId: event.data.pipelineId,
        snapshotHash: event.data.snapshotHash,
        stageId: event.data.stageId,
        outcome: event.data.outcome,
      }))
    }
  }
  return {
    ...(agentTrace.length === 0 ? {} : { agentTrace: Object.freeze(agentTrace) }),
    pipelineTrace: Object.freeze(pipelineTrace),
  }
}

/**
 * Decode the canonical Pipeline output boundary into typed turn effects.
 * @param pipeline - Successful frozen Pipeline execution.
 * @returns Validated detached effects ready for commit.
 */
export function effectsFromPipeline(pipeline: RpPipelineRunResult): RpTurnEffects {
  const raw = pipeline.frame.values[RP_TURN_EFFECTS_KEY]
  if (!isJsonObject(raw)) {
    throw new RpTurnError(`RP turn Pipeline must publish object output ${JSON.stringify(RP_TURN_EFFECTS_KEY)}`, 'INVALID_OUTPUT')
  }
  const allowed = new Set([
    'assistantMessage', 'state', 'statePatch', 'memories', 'relationships', 'scene', 'branch', 'usage', 'metadata',
  ])
  const unknown = Object.keys(raw).find(key => !allowed.has(key))
  if (unknown !== undefined) throw new RpTurnError(`RP turn effects contain unknown field ${JSON.stringify(unknown)}`, 'INVALID_OUTPUT')
  const assistantMessage = raw.assistantMessage
  if (typeof assistantMessage !== 'string') {
    throw new RpTurnError('RP turn Pipeline assistantMessage must be a string', 'INVALID_OUTPUT')
  }
  const effects: RpTurnEffects = {
    assistantMessage,
    ...(raw.state === undefined ? {} : { state: runtimeState(raw.state) }),
    ...(raw.statePatch === undefined ? {} : { statePatch: runtimeStatePatch(raw.statePatch) }),
    ...(raw.memories === undefined ? {} : { memories: runtimeArray(raw.memories, 'memories', runtimeMemory) }),
    ...(raw.relationships === undefined
      ? {}
      : { relationships: runtimeArray(raw.relationships, 'relationships', runtimeRelationship) }),
    ...(raw.scene === undefined ? {} : { scene: runtimeScene(raw.scene) }),
    ...(raw.branch === undefined ? {} : { branch: runtimeBranch(raw.branch) }),
    ...(raw.usage === undefined ? {} : { usage: runtimeUsage(raw.usage) }),
    ...(raw.metadata === undefined ? {} : { metadata: runtimeObject(raw.metadata, 'metadata') }),
  }
  validateEffects(effects)
  return freezeEffects(effects)
}

/** Validate effects at the external adapter boundary. */
function validateEffects(effects: RpTurnEffects): void {
  if (effects.assistantMessage.trim().length === 0) {
    throw new RpTurnError('RP turn assistantMessage must be non-empty', 'INVALID_OUTPUT')
  }
  if (effects.statePatch !== undefined && effects.state === undefined) {
    throw new RpTurnError('RP statePatch requires the complete resulting state document', 'INVALID_STATE')
  }
  if (effects.state !== undefined && effects.statePatch !== undefined) {
    if (effects.state.owner !== effects.statePatch.owner) {
      throw new RpTurnError('RP committed state and statePatch must have the same owner', 'INVALID_STATE')
    }
    if (effects.state.revision !== effects.statePatch.baseRevision + 1) {
      throw new RpTurnError('RP committed state revision must advance statePatch.baseRevision by one', 'INVALID_STATE')
    }
  }
  validateLosslessJson(effects, new Set<object>())
}

/** Reject stale or conflicting effects against the exact replay boundary captured by prepare(). */
function validateEffectsAgainstSnapshot(effects: RpTurnEffects, context: RpTurnContextSnapshot): void {
  if (effects.state !== undefined) {
    const current = context.session.states.find(state => state.owner === effects.state?.owner)
    if (effects.statePatch !== undefined) {
      if (current === undefined) {
        throw new RpTurnError(`RP state owner ${JSON.stringify(effects.state.owner)} cannot patch an uninitialized document`, 'INVALID_STATE')
      }
      if (current.revision !== effects.statePatch.baseRevision) {
        throw new RpTurnError(
          `RP state owner ${JSON.stringify(effects.state.owner)} changed from revision ${effects.statePatch.baseRevision} to ${current.revision}`,
          'INVALID_STATE',
        )
      }
    } else if (current === undefined) {
      if (effects.state.revision !== 0) {
        throw new RpTurnError('A newly initialized RP state document must start at revision zero', 'INVALID_STATE')
      }
    } else if (effects.state.revision !== current.revision + 1) {
      throw new RpTurnError(
        `RP state owner ${JSON.stringify(effects.state.owner)} must advance revision ${current.revision} by one`,
        'INVALID_STATE',
      )
    }
  }

  for (const relationship of effects.relationships ?? []) {
    const current = context.session.relationships.find(item => item.from === relationship.from && item.to === relationship.to)
    const expected = (current?.revision ?? 0) + 1
    if (relationship.revision !== expected) {
      throw new RpTurnError(
        `RP relationship ${JSON.stringify(`${relationship.from}->${relationship.to}`)} must advance to revision ${expected}`,
        'INVALID_STATE',
      )
    }
  }

  for (const memory of effects.memories ?? []) {
    const current = context.session.memories.find(item => item.id === memory.id)
    if (current !== undefined && JSON.stringify(current) !== JSON.stringify(memory)) {
      throw new RpTurnError(`RP memory ${JSON.stringify(memory.id)} conflicts with a committed fact`, 'INVALID_STATE')
    }
  }
}

function freezeTurnContext(
  session: RpTurnContextSnapshot['session'],
  supplied: JsonObject = {},
  media: RpTurnContextSnapshot['media'] = [],
  content: RpTurnContextSnapshot['content'] = [],
  preset?: RpTurnContextSnapshot['preset'],
  library?: RpTurnContextSnapshot['library'],
): RpTurnContextSnapshot {
  return freezeJson(cloneJson({
    schemaVersion: 1,
    supplied,
    session,
    media,
    content,
    ...(preset === undefined ? {} : { preset }),
    ...(library === undefined ? {} : { library }),
  })) as unknown as RpTurnContextSnapshot
}

/** Detach effect arrays before asynchronous commit. */
function freezeEffects(effects: RpTurnEffects): RpTurnEffects {
  return freezeJson(cloneJson(effects)) as unknown as RpTurnEffects
}

function runtimeState(value: JsonValue): NonNullable<RpTurnEffects['state']> {
  const state = runtimeObject(value, 'state')
  if (state.schemaVersion !== 1 || !isSafeRevision(state.revision) || !isNonEmptyString(state.owner)
    || !isJsonObject(state.value)) invalidEffect('state is not a StateDocument')
  return state as unknown as NonNullable<RpTurnEffects['state']>
}

function runtimeStatePatch(value: JsonValue): NonNullable<RpTurnEffects['statePatch']> {
  const patch = runtimeObject(value, 'statePatch')
  if (!isSafeRevision(patch.baseRevision) || !isNonEmptyString(patch.owner) || !Array.isArray(patch.operations)) {
    invalidEffect('statePatch is not a StatePatch')
  }
  for (const operation of patch.operations) {
    if (!isJsonObject(operation) || typeof operation.op !== 'string'
      || !['add', 'replace', 'remove', 'test'].includes(operation.op)
      || typeof operation.path !== 'string' || !operation.path.startsWith('/')) {
      invalidEffect('statePatch contains an invalid operation')
    }
    if ((operation.op === 'add' || operation.op === 'replace' || operation.op === 'test')
      && !Object.hasOwn(operation, 'value')) invalidEffect('statePatch operation requires value')
  }
  return patch as unknown as NonNullable<RpTurnEffects['statePatch']>
}

function runtimeMemory(value: JsonValue): NonNullable<RpTurnEffects['memories']>[number] {
  const memory = runtimeObject(value, 'memory')
  if (memory.schemaVersion !== 1 || !isNonEmptyString(memory.id) || !isNonEmptyString(memory.owner)
    || !isNonEmptyString(memory.content) || !isFiniteNumber(memory.salience) || !isFiniteNumber(memory.createdAt)
    || (memory.tags !== undefined && (!Array.isArray(memory.tags) || !memory.tags.every(isNonEmptyString)))) {
    invalidEffect('memories contains an invalid MemoryEvent')
  }
  return memory as unknown as NonNullable<RpTurnEffects['memories']>[number]
}

function runtimeRelationship(value: JsonValue): NonNullable<RpTurnEffects['relationships']>[number] {
  const relationship = runtimeObject(value, 'relationship')
  if (relationship.schemaVersion !== 1 || !isNonEmptyString(relationship.from) || !isNonEmptyString(relationship.to)
    || !isSafeRevision(relationship.revision) || !isJsonObject(relationship.dimensions)
    || !Object.values(relationship.dimensions).every(isFiniteNumber)
    || (relationship.notes !== undefined
      && (!Array.isArray(relationship.notes) || !relationship.notes.every(isNonEmptyString)))) {
    invalidEffect('relationships contains an invalid RelationshipIR')
  }
  return relationship as unknown as NonNullable<RpTurnEffects['relationships']>[number]
}

function runtimeScene(value: JsonValue): NonNullable<RpTurnEffects['scene']> {
  const scene = runtimeObject(value, 'scene')
  if (scene.schemaVersion !== 1 || !isNonEmptyString(scene.id) || !isNonEmptyString(scene.title)
    || !Array.isArray(scene.participants) || !scene.participants.every(isNonEmptyString)) {
    invalidEffect('scene is not a SceneIR')
  }
  return scene as unknown as NonNullable<RpTurnEffects['scene']>
}

function runtimeBranch(value: JsonValue): NonNullable<RpTurnEffects['branch']> {
  const branch = runtimeObject(value, 'branch')
  if (!isNonEmptyString(branch.id) || typeof branch.active !== 'boolean' || !isNonEmptyString(branch.message)
    || (branch.parentId !== undefined && !isNonEmptyString(branch.parentId))) {
    invalidEffect('branch is not an RP branch record')
  }
  return branch as unknown as NonNullable<RpTurnEffects['branch']>
}

function runtimeUsage(value: JsonValue): NonNullable<RpTurnEffects['usage']> {
  const usage = runtimeObject(value, 'usage')
  const allowed = new Set(['inputTokens', 'outputTokens', 'costUsd', 'durationMs'])
  if (Object.keys(usage).some(key => !allowed.has(key))
    || Object.values(usage).some(item => !isFiniteNumber(item) || item < 0)) {
    invalidEffect('usage contains invalid token, cost, or duration values')
  }
  return usage
}

function runtimeArray<T>(value: JsonValue, label: string, parse: (item: JsonValue) => T): readonly T[] {
  if (!Array.isArray(value)) invalidEffect(`${label} must be an array`)
  return value.map(parse)
}

function runtimeObject(value: JsonValue, label: string): JsonObject {
  if (!isJsonObject(value)) invalidEffect(`RP turn effects ${label} must be an object`)
  return value
}

function invalidEffect(message: string): never { throw new RpTurnError(message, 'INVALID_OUTPUT') }

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
}

function isSafeRevision(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function cloneJson(value: unknown): JsonValue {
  validateLosslessJson(value, new Set<object>())
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    for (const child of value) freezeJson(child)
    Object.freeze(value)
    return value
  }
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child)
    Object.freeze(value)
    return value
  }
  return value
}

function validateLosslessJson(value: unknown, ancestors: Set<object>): void {
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) invalidEffect('turn effects require finite lossless JSON numbers')
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return
  if (typeof value !== 'object') invalidEffect(`turn effects contain unsupported ${typeof value}`)
  if (ancestors.has(value)) invalidEffect('turn effects must not contain cycles')
  const prototype: unknown = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) invalidEffect('turn effects require plain JSON objects')
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) invalidEffect('turn effects must not contain sparse arrays')
      validateLosslessJson(value[index], ancestors)
    }
  } else {
    for (const child of Object.values(value)) validateLosslessJson(child, ancestors)
  }
  ancestors.delete(value)
}

function renderError(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error)
    return message.trim() === '' ? 'RP turn failed without a diagnostic' : message
  }
  catch { return '[unrenderable turn failure]' }
}

export default RpTurnRuntime
