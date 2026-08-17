/** Deterministic parallel DAG runtime for turn, workflow, and sidecar pipelines. @module @dsh-rp/pipeline-runtime */

import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { JsonObject, JsonValue, RpBudget, RpPipelineId, RpTrustLevel } from '@dsh-rp/contracts'
import { RpCapabilityId } from '@dsh-rp/contracts'
import type {} from '@dsh-rp/capability-catalog'
import type {
  RpPipelineDefinition,
  RpPipelineFrame,
  RpPipelinePlan,
  RpPipelineRunInfo,
  RpPipelineRunRequest,
  RpPipelineRunResult,
  RpPipelineSnapshot,
  RpPipelineStageContext,
  RpPipelineStageDefinition,
  RpPipelineStageFailure,
  RpPipelineStageOutput,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    rpPipelines: RpPipelineRuntime
  }

  interface Events {
    /**
     * A pipeline registration changed.
     * @param id - Changed pipeline id.
     * @mode emit
     */
    'rp/pipelines-changed'(id: RpPipelineId): void
    /**
     * A pipeline run started.
     * @param info - Immutable run identity.
     * @mode emit
     */
    'rp/pipeline-started'(info: RpPipelineRunInfo): void
    /**
     * A stage settled.
     * @param info - Run identity.
     * @param stageId - Settled stage.
     * @param outcome - Stage outcome.
     * @mode emit
     */
    'rp/pipeline-stage'(info: RpPipelineRunInfo, stageId: string, outcome: 'completed' | 'continued'): void
    /**
     * A pipeline completed.
     * @param info - Run identity.
     * @mode emit
     */
    'rp/pipeline-completed'(info: RpPipelineRunInfo): void
    /**
     * A pipeline failed.
     * @param info - Run identity.
     * @param error - Rendered failure.
     * @mode emit
     */
    'rp/pipeline-failed'(info: RpPipelineRunInfo, error: string): void
  }
}

/** Pipeline registration, compilation, or execution failure. */
export class RpPipelineError extends Error {
  /** Machine-readable failure category. */
  readonly code:
    | 'DUPLICATE' | 'MISSING' | 'INVALID' | 'CYCLE'
    | 'AUTHORITY_DENIED' | 'STAGE_FAILED' | 'OUTPUT_CONFLICT' | 'CANCELLED' | 'TIMEOUT'
  /** Stage that caused the failure, when applicable. */
  readonly stageId: string | undefined

  /**
   * @param message - Human-readable failure.
   * @param code - Stable category.
   * @param stageId - Optional failing stage.
   * @param options - Error cause.
   */
  constructor(message: string, code: RpPipelineError['code'], stageId?: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RpPipelineError'
    this.code = code
    this.stageId = stageId
  }
}

/** Registry and executor for all RP pipeline families. */
export class RpPipelineRuntime extends Service {
  private readonly definitions = new Map<RpPipelineId, RpPipelineDefinition>()
  private readonly plans = new WeakMap<RpPipelinePlan, PreparedPipeline>()

  constructor(ctx: Context) {
    super(ctx, 'rpPipelines')
  }

  /**
   * Register one pipeline.
   * @param definition - Complete pipeline graph.
   * @returns Idempotent disposer.
   */
  register(definition: RpPipelineDefinition): () => void {
    validateDefinition(definition)
    if (this.definitions.has(definition.id)) {
      throw new RpPipelineError(`RP pipeline ${JSON.stringify(definition.id)} is already registered`, 'DUPLICATE')
    }
    const stored = freezeDefinition(definition)
    compile(stored)
    this.definitions.set(stored.id, stored)
    this.ctx.emit('rp/pipelines-changed', stored.id)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.definitions.get(stored.id) !== stored) return
      this.definitions.delete(stored.id)
      this.ctx.emit('rp/pipelines-changed', stored.id)
    }
  }

  /**
   * List registered pipeline metadata in deterministic order.
   * @returns Registered immutable definitions.
   */
  list(): readonly RpPipelineDefinition[] {
    return [...this.definitions.values()].sort((left, right) => String(left.id).localeCompare(String(right.id)))
  }

  /**
   * Compile a registered graph into an immutable content-addressed snapshot.
   * @param id - Registered pipeline id.
   * @returns Compiled snapshot.
   */
  snapshot(id: RpPipelineId): RpPipelineSnapshot {
    return this.capture(id).snapshot
  }

  /**
   * Capture one executable graph and every nested Pipeline it may invoke.
   * @param id - Registered top-level Pipeline id.
   * @returns Opaque immutable plan whose functions survive later registry replacement.
   */
  capture(id: RpPipelineId): RpPipelinePlan {
    return this.captureNested(id, [])
  }

  /**
   * Execute one frozen graph with concurrent topological levels.
   * @param id - Registered pipeline id.
   * @param request - Scope, input, cancellation, and caller budget.
   * @returns Final immutable frame and continued failures.
   */
  async run(id: RpPipelineId, request: RpPipelineRunRequest): Promise<RpPipelineRunResult> {
    return await this.runPlan(this.capture(id), request)
  }

  /**
   * Execute an exact previously captured graph even if live registrations changed.
   * @param plan - Opaque plan created by this runtime.
   * @param request - Scope, input, authority, cancellation, and optional observer.
   * @returns Final immutable frame and continued failures.
   */
  async runPlan(plan: RpPipelinePlan, request: RpPipelineRunRequest): Promise<RpPipelineRunResult> {
    const prepared = this.plans.get(plan)
    if (prepared === undefined) throw new RpPipelineError('RP Pipeline plan does not belong to this runtime', 'INVALID')
    const { compiled } = prepared
    const executionRequest: RpPipelineRunRequest = request.metadata === undefined
      ? request
      : Object.freeze({ ...request, metadata: freezeJson(cloneJson(request.metadata)) as JsonObject })
    assertPipelineAuthority(compiled.snapshot, executionRequest)
    const runId = randomUUID()
    const info: RpPipelineRunInfo = Object.freeze({
      runId,
      pipelineId: compiled.snapshot.id,
      kind: compiled.snapshot.kind,
      snapshotHash: compiled.snapshot.hash,
    })
    const failures: RpPipelineStageFailure[] = []
    let frame: RpPipelineFrame = Object.freeze({ input: cloneJson(executionRequest.input), values: Object.freeze({}) })
    const budget = intersectBudget(compiled.snapshot.budget, executionRequest.budget)
    let started = false
    let terminal = false
    try {
      executionRequest.observer?.started(info)
      started = true
      this.ctx.emit('rp/pipeline-started', info)
      for (const level of compiled.levels) {
        if (executionRequest.signal?.aborted === true) throw new RpPipelineError('RP pipeline was cancelled', 'CANCELLED')
        const levelFrame = frame
        const settled = await Promise.all(level.map(async (stage) => {
          let output: RpPipelineStageOutput
          let outcome: 'completed' | 'continued'
          try {
            output = await runStage(
              this.ctx,
              stage,
              levelFrame,
              compiled.snapshot,
              executionRequest,
              budget,
              prepared.nested.get(stage.id),
              runId,
            )
            outcome = 'completed'
          } catch (error: unknown) {
            if (stage.failure !== 'continue') throw normalizeStageError(stage.id, error)
            const failure = Object.freeze({ stageId: stage.id, message: renderError(error) })
            failures.push(failure)
            output = Object.freeze({})
            outcome = 'continued'
          }
          executionRequest.observer?.stage(info, stage.id, outcome)
          this.ctx.emit('rp/pipeline-stage', info, stage.id, outcome)
          return { stage, output }
        }))
        const nextValues: Record<string, JsonValue> = { ...frame.values }
        for (const { stage, output } of settled.sort((left, right) => left.stage.id.localeCompare(right.stage.id))) {
          for (const [key, value] of Object.entries(output)) {
            if (Object.hasOwn(nextValues, key)) {
              throw new RpPipelineError(
                `RP pipeline output ${JSON.stringify(key)} from stage ${JSON.stringify(stage.id)} conflicts with an existing value`,
                'OUTPUT_CONFLICT',
                stage.id,
              )
            }
            nextValues[key] = cloneJson(value)
          }
        }
        frame = Object.freeze({ input: frame.input, values: Object.freeze(nextValues) })
      }
      this.ctx.emit('rp/pipeline-completed', info)
      executionRequest.observer?.completed(info)
      terminal = true
      return Object.freeze({
        runId,
        snapshot: compiled.snapshot,
        frame,
        failures: Object.freeze([...failures]),
      })
    } catch (error: unknown) {
      const diagnostic = renderError(error)
      if (started && !terminal) {
        executionRequest.observer?.failed(info, diagnostic)
        this.ctx.emit('rp/pipeline-failed', info, diagnostic)
      }
      throw error
    }
  }

  private captureNested(id: RpPipelineId, ancestors: readonly RpPipelineId[]): RpPipelinePlan {
    const cycleAt = ancestors.indexOf(id)
    if (cycleAt >= 0) {
      const cycle = [...ancestors.slice(cycleAt), id].map(String).join(' -> ')
      throw new RpPipelineError(`RP Pipeline invocation cycle: ${cycle}`, 'CYCLE')
    }
    const definition = this.definitions.get(id)
    if (definition === undefined) throw new RpPipelineError(`RP pipeline ${JSON.stringify(id)} is not registered`, 'MISSING')
    const local = compile(definition)
    const nested = new Map<string, RpPipelinePlan>()
    const path = [...ancestors, id]
    for (const stage of local.levels.flat()) {
      if (stage.operation?.kind !== 'invoke-pipeline') continue
      nested.set(stage.id, this.captureNested(stage.operation.pipelineId, path))
    }
    const snapshot = graphSnapshot(local.snapshot, nested)
    const plan: RpPipelinePlan = Object.freeze({ snapshot })
    this.plans.set(plan, Object.freeze({
      compiled: Object.freeze({ snapshot, levels: local.levels }),
      nested,
    }))
    return plan
  }
}

/** Compiled executable stages and their durable metadata. */
interface CompiledPipeline {
  readonly snapshot: RpPipelineSnapshot
  readonly levels: readonly (readonly RpPipelineStageDefinition[])[]
}

/** Executable closure retained behind an opaque public plan. */
interface PreparedPipeline {
  readonly compiled: CompiledPipeline
  readonly nested: ReadonlyMap<string, RpPipelinePlan>
}

/** Bind nested dependency hashes into the top-level content address. */
function graphSnapshot(
  local: RpPipelineSnapshot,
  nested: ReadonlyMap<string, RpPipelinePlan>,
): RpPipelineSnapshot {
  if (nested.size === 0) return local
  const dependencies = [...nested.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([stageId, plan]) => ({
      stageId,
      pipelineId: plan.snapshot.id,
      snapshotHash: plan.snapshot.hash,
    }))
  const hash = createHash('sha256').update(JSON.stringify({ localHash: local.hash, dependencies })).digest('hex')
  return Object.freeze({ ...local, hash })
}

/** Compile ordering constraints and reject incomplete or cyclic graphs. */
function compile(definition: RpPipelineDefinition): CompiledPipeline {
  const byId = new Map(definition.stages.map(stage => [stage.id, stage]))
  const dependencies = new Map<string, Set<string>>(definition.stages.map(stage => [stage.id, new Set(stage.after ?? [])]))
  for (const stage of definition.stages) {
    for (const target of stage.before ?? []) {
      const targetDependencies = dependencies.get(target)
      if (targetDependencies === undefined) {
        throw new RpPipelineError(`RP pipeline stage ${JSON.stringify(stage.id)} references missing before target ${JSON.stringify(target)}`, 'MISSING')
      }
      targetDependencies.add(stage.id)
    }
    for (const dependency of stage.after ?? []) {
      if (!byId.has(dependency)) {
        throw new RpPipelineError(`RP pipeline stage ${JSON.stringify(stage.id)} references missing dependency ${JSON.stringify(dependency)}`, 'MISSING')
      }
    }
  }
  const remaining = new Set(byId.keys())
  const levels: RpPipelineStageDefinition[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => {
        const stageDependencies = dependencies.get(id)
        if (stageDependencies === undefined) {
          throw new RpPipelineError(`RP pipeline stage ${JSON.stringify(id)} lost its dependency record`, 'INVALID')
        }
        return [...stageDependencies].every(dependency => !remaining.has(dependency))
      })
      .sort()
    if (ready.length === 0) {
      throw new RpPipelineError(`RP pipeline ${JSON.stringify(definition.id)} contains a dependency cycle`, 'CYCLE')
    }
    levels.push(ready.map((id) => {
      const stage = byId.get(id)
      if (stage === undefined) {
        throw new RpPipelineError(`RP pipeline stage ${JSON.stringify(id)} disappeared during compilation`, 'INVALID')
      }
      return stage
    }))
    for (const id of ready) remaining.delete(id)
  }
  const metadata = {
    id: definition.id,
    kind: definition.kind,
    version: definition.version,
    trust: definition.trust,
    permissions: [...definition.permissions].sort(),
    budget: definition.budget,
    levels: levels.map(level => level.map(stage => ({
      id: stage.id,
      after: [...stage.after ?? []].sort(),
      before: [...stage.before ?? []].sort(),
      timeoutMs: stage.timeoutMs,
      retries: stage.retries,
      failure: stage.failure,
      operation: stage.operation,
    }))),
  }
  const snapshot: RpPipelineSnapshot = Object.freeze({
    id: definition.id,
    kind: definition.kind,
    version: definition.version,
    trust: definition.trust,
    permissions: Object.freeze([...definition.permissions]),
    hash: createHash('sha256').update(JSON.stringify(metadata)).digest('hex'),
    levels: Object.freeze(levels.map(level => Object.freeze(level.map(stage => stage.id)))),
    ...(definition.budget === undefined ? {} : { budget: Object.freeze({ ...definition.budget }) }),
  })
  return { snapshot, levels }
}

/** Execute one stage with cooperative cancellation, timeout, and bounded retry. */
async function runStage(
  ctx: Context,
  stage: RpPipelineStageDefinition,
  frame: RpPipelineFrame,
  snapshot: RpPipelineSnapshot,
  request: RpPipelineRunRequest,
  pipelineBudget: RpBudget,
  nestedPlan: RpPipelinePlan | undefined,
  runId: string,
): Promise<RpPipelineStageOutput> {
  const timeoutMs = minimumDefined(stage.timeoutMs, pipelineBudget.timeoutMs)
  const retries = stage.retries ?? 0
  let lastError: unknown
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const controller = new AbortController()
    const abort = (): void => { controller.abort(request.signal?.reason) }
    request.signal?.addEventListener('abort', abort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = timeoutMs === undefined
      ? undefined
      : new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const timeoutError = new RpPipelineError(
            `RP pipeline stage ${JSON.stringify(stage.id)} timed out after ${timeoutMs}ms`,
            'TIMEOUT',
            stage.id,
          )
          controller.abort(timeoutError)
          reject(timeoutError)
        }, timeoutMs)
      })
    const context: RpPipelineStageContext = Object.freeze({
      runId,
      scope: request.scope,
      pipeline: snapshot,
      stageId: stage.id,
      attempt,
      signal: controller.signal,
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    })
    try {
      const operation = executeStage(ctx, stage, frame, context, request, pipelineBudget, nestedPlan)
      const output = await (timeout === undefined ? operation : Promise.race([operation, timeout]))
      return freezeOutput(output, stage.id)
    } catch (error: unknown) {
      lastError = error
      if (request.signal?.aborted === true) throw new RpPipelineError('RP pipeline was cancelled', 'CANCELLED', stage.id, { cause: error })
    } finally {
      request.signal?.removeEventListener('abort', abort)
      if (timer !== undefined) clearTimeout(timer)
    }
  }
  throw normalizeStageError(stage.id, lastError)
}

/** Route declarative stages back through the original capability and pipeline registries. */
async function executeStage(
  ctx: Context,
  stage: RpPipelineStageDefinition,
  frame: RpPipelineFrame,
  context: RpPipelineStageContext,
  request: RpPipelineRunRequest,
  budget: RpBudget,
  nestedPlan: RpPipelinePlan | undefined,
): Promise<RpPipelineStageOutput> {
  const operation = stage.operation ?? { kind: 'custom' as const }
  if (operation.kind === 'custom') {
    if (stage.run === undefined) throw new RpPipelineError(`RP pipeline custom stage ${JSON.stringify(stage.id)} has no run function`, 'INVALID', stage.id)
    return await stage.run(frame, context)
  }
  if (operation.kind === 'conditional') {
    return { [`stage.${stage.id}.matched`]: equalJson(frame.values[operation.valueKey] ?? null, operation.equals) }
  }
  const input = operation.inputKey === undefined ? frame.input : frame.values[operation.inputKey]
  if (input === undefined) throw new RpPipelineError(`RP pipeline stage ${JSON.stringify(stage.id)} input key ${JSON.stringify(operation.inputKey)} is missing`, 'INVALID', stage.id)
  if (operation.kind === 'invoke-capability') {
    const capabilities = ctx.get('rpCapabilities')
    if (capabilities === undefined) {
      throw new RpPipelineError('RP capability registry is unavailable for invoke-capability', 'MISSING', stage.id)
    }
    const constrained = request.grantedPermissions !== undefined || request.grantedTrust !== undefined
    const callerPermissions = request.grantedPermissions ?? operation.grantedPermissions ?? []
    const grantedPermissions = operation.grantedPermissions === undefined
      ? callerPermissions
      : constrained
        ? intersectStrings(callerPermissions, operation.grantedPermissions)
        : operation.grantedPermissions
    const grantedTrust = request.grantedTrust === undefined
      ? operation.grantedTrust ?? 'L0'
      : minimumTrust(request.grantedTrust, operation.grantedTrust)
    const value = await capabilities.invoke(RpCapabilityId(operation.capabilityId), {
      scope: request.scope, input, grantedPermissions, grantedTrust, budget,
      ...(request.networkDomains === undefined ? {} : { networkDomains: request.networkDomains }),
      ...(request.fileRoots === undefined ? {} : { fileRoots: request.fileRoots }),
      ...(request.policyLayers === undefined ? {} : { policyLayers: request.policyLayers }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    return { [`stage.${stage.id}.result`]: value }
  }
  if (nestedPlan === undefined || nestedPlan.snapshot.id !== operation.pipelineId) {
    throw new RpPipelineError(`RP nested Pipeline plan for stage ${JSON.stringify(stage.id)} is missing`, 'INVALID', stage.id)
  }
  const nested = await ctx.rpPipelines.runPlan(nestedPlan, {
    scope: request.scope, input, budget,
    ...(request.grantedPermissions === undefined ? {} : { grantedPermissions: request.grantedPermissions }),
    ...(request.grantedTrust === undefined ? {} : { grantedTrust: request.grantedTrust }),
    ...(request.networkDomains === undefined ? {} : { networkDomains: request.networkDomains }),
    ...(request.fileRoots === undefined ? {} : { fileRoots: request.fileRoots }),
    ...(request.policyLayers === undefined ? {} : { policyLayers: request.policyLayers }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    ...(request.observer === undefined ? {} : { observer: request.observer }),
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
  })
  return { [`stage.${stage.id}.result`]: nested.frame.values }
}

function intersectStrings(left: readonly string[], right: readonly string[]): readonly string[] {
  const allowed = new Set(right)
  return [...new Set(left)].filter(value => allowed.has(value)).sort()
}

function minimumTrust(caller: RpTrustLevel, stage: RpTrustLevel | undefined): RpTrustLevel {
  if (stage === undefined) return caller
  const ranks = { L0: 0, L1: 1, L2: 2 } as const
  return ranks[caller] <= ranks[stage] ? caller : stage
}

function equalJson(left: JsonValue, right: JsonValue): boolean { return JSON.stringify(left) === JSON.stringify(right) }

/** Validate and freeze a stage's JSON output. */
function freezeOutput(output: RpPipelineStageOutput, stageId: string): RpPipelineStageOutput {
  const candidate: unknown = output
  if (candidate === null || Array.isArray(candidate) || typeof candidate !== 'object') {
    throw new RpPipelineError(`RP pipeline stage ${JSON.stringify(stageId)} must return an object`, 'STAGE_FAILED', stageId)
  }
  const cloned: Record<string, JsonValue> = {}
  for (const [key, rawValue] of Object.entries(candidate)) {
    const value: unknown = rawValue
    cloned[key] = cloneJson(value)
  }
  return Object.freeze(cloned)
}

/** Reject non-lossless JSON values and detach mutable caller data. */
function cloneJson<T extends JsonValue>(value: T): T
function cloneJson(value: unknown): JsonValue
function cloneJson(value: unknown): JsonValue {
  validateJson(value, new Set<object>())
  const cloned: unknown = JSON.parse(JSON.stringify(value))
  validateJson(cloned, new Set<object>())
  return cloned
}

/** Deep-freeze detached JSON before exposing Host trace metadata to concurrent Stages. */
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

/** Validate finite, non-negative-zero, acyclic plain JSON. */
function validateJson(value: unknown, ancestors: Set<object>): asserts value is JsonValue {
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) {
    throw new RpPipelineError('RP pipeline data must contain only lossless JSON numbers', 'INVALID')
  }
  if (value === null || typeof value !== 'object') return
  if (ancestors.has(value)) throw new RpPipelineError('RP pipeline data must not contain cycles', 'INVALID')
  const prototype: unknown = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new RpPipelineError('RP pipeline data must contain only arrays and plain objects', 'INVALID')
  }
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new RpPipelineError('RP pipeline arrays must not be sparse', 'INVALID')
      const child: unknown = value[index]
      if (child === undefined) throw new RpPipelineError('RP pipeline arrays must not contain undefined', 'INVALID')
      validateJson(child, ancestors)
    }
  } else {
    const record = value as Record<string, unknown>
    for (const child of Object.values(record)) validateJson(child, ancestors)
  }
  ancestors.delete(value)
}

/** Validate public graph fields before compilation. */
function validateDefinition(definition: RpPipelineDefinition): void {
  if (String(definition.id).length === 0 || definition.version.length === 0 || definition.description.length === 0) {
    throw new RpPipelineError('RP pipeline id, version, and description must be non-empty', 'INVALID')
  }
  if (definition.stages.length === 0) throw new RpPipelineError(`RP pipeline ${JSON.stringify(definition.id)} must contain a stage`, 'INVALID')
  if (!['L0', 'L1', 'L2'].includes(definition.trust)) {
    throw new RpPipelineError(`RP pipeline ${JSON.stringify(definition.id)} has an invalid trust level`, 'INVALID')
  }
  if (definition.permissions.some(permission => permission.length === 0)) {
    throw new RpPipelineError(`RP pipeline ${JSON.stringify(definition.id)} permissions must be non-empty strings`, 'INVALID')
  }
  const ids = definition.stages.map(stage => stage.id)
  if (ids.some(id => id.length === 0) || new Set(ids).size !== ids.length) {
    throw new RpPipelineError(`RP pipeline ${JSON.stringify(definition.id)} stage ids must be non-empty and unique`, 'INVALID')
  }
  for (const stage of definition.stages) {
    if ((stage.operation === undefined || stage.operation.kind === 'custom') && stage.run === undefined) {
      throw new RpPipelineError(`RP pipeline custom stage ${JSON.stringify(stage.id)} must declare run`, 'INVALID')
    }
    if (stage.operation !== undefined && stage.operation.kind !== 'custom' && stage.run !== undefined) {
      throw new RpPipelineError(`RP pipeline declarative stage ${JSON.stringify(stage.id)} cannot also declare run`, 'INVALID')
    }
    if (stage.retries !== undefined && (!Number.isSafeInteger(stage.retries) || stage.retries < 0)) {
      throw new RpPipelineError(`RP pipeline stage ${JSON.stringify(stage.id)} retries must be a non-negative safe integer`, 'INVALID')
    }
    if (stage.timeoutMs !== undefined && (!Number.isFinite(stage.timeoutMs) || stage.timeoutMs <= 0)) {
      throw new RpPipelineError(`RP pipeline stage ${JSON.stringify(stage.id)} timeoutMs must be positive`, 'INVALID')
    }
  }
}

/** Detach definition metadata while retaining the owning stage functions. */
function freezeDefinition(definition: RpPipelineDefinition): RpPipelineDefinition {
  return Object.freeze({
    ...definition,
    permissions: Object.freeze([...new Set(definition.permissions)].sort()),
    stages: Object.freeze(definition.stages.map(stage => Object.freeze({
      ...stage,
      ...(stage.after === undefined ? {} : { after: Object.freeze([...stage.after]) }),
      ...(stage.before === undefined ? {} : { before: Object.freeze([...stage.before]) }),
      ...(stage.operation === undefined ? {} : { operation: freezeOperation(stage.operation) }),
    }))),
    ...(definition.budget === undefined ? {} : { budget: Object.freeze({ ...definition.budget }) }),
  })
}

/** Enforce graph-level trust and permission declarations for non-Host callers. */
function assertPipelineAuthority(
  definition: Pick<RpPipelineDefinition, 'id' | 'trust' | 'permissions'>,
  request: RpPipelineRunRequest,
): void {
  const constrained = request.grantedTrust !== undefined || request.grantedPermissions !== undefined
  if (!constrained) return
  const grantedTrust = request.grantedTrust ?? 'L0'
  const ranks = { L0: 0, L1: 1, L2: 2 } as const
  if (ranks[grantedTrust] < ranks[definition.trust]) {
    throw new RpPipelineError(
      `RP pipeline ${JSON.stringify(definition.id)} requires ${definition.trust} trust but caller grants ${grantedTrust}`,
      'AUTHORITY_DENIED',
    )
  }
  const grantedPermissions = new Set(request.grantedPermissions ?? [])
  const missing = definition.permissions.filter(permission => !grantedPermissions.has(permission))
  if (missing.length > 0) {
    throw new RpPipelineError(
      `RP pipeline ${JSON.stringify(definition.id)} requires missing permissions: ${missing.join(', ')}`,
      'AUTHORITY_DENIED',
    )
  }
}

function freezeOperation(operation: NonNullable<RpPipelineStageDefinition['operation']>): NonNullable<RpPipelineStageDefinition['operation']> {
  return Object.freeze(operation.kind === 'invoke-capability' && operation.grantedPermissions !== undefined
    ? { ...operation, grantedPermissions: Object.freeze([...operation.grantedPermissions]) }
    : { ...operation })
}

/** Normalize a stage throw into the public failure taxonomy. */
function normalizeStageError(stageId: string, error: unknown): RpPipelineError {
  if (error instanceof RpPipelineError) return error
  return new RpPipelineError(`RP pipeline stage ${JSON.stringify(stageId)} failed: ${renderError(error)}`, 'STAGE_FAILED', stageId, { cause: error })
}

/** Intersect the pipeline and caller timeout budget. */
function intersectBudget(definition: RpBudget | undefined, request: RpBudget | undefined): RpBudget {
  const timeoutMs = minimumDefined(definition?.timeoutMs, request?.timeoutMs)
  return timeoutMs === undefined ? {} : { timeoutMs }
}

/** Return the lower supplied number. */
function minimumDefined(...values: readonly (number | undefined)[]): number | undefined {
  const supplied = values.filter((value): value is number => value !== undefined)
  return supplied.length === 0 ? undefined : Math.min(...supplied)
}

/** Render thrown values without allowing hostile coercion to replace the original failure. */
function renderError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

export default RpPipelineRuntime
