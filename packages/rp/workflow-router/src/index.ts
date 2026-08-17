/** Policy-aware router for replaceable RP workflow execution backends. @module @dsh-rp/workflow-router */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { JsonValue, RpBudget, RpTrustLevel } from '@dsh-rp/contracts'
import type { RpAuthorityDecision } from '@dsh-rp/policy'

declare module '@deepseek-ai/cordis' {
  interface Context { rpWorkflowRouter: RpWorkflowRouter }
  interface Events {
    /**
     * Workflow backend registrations changed.
     * @param id - Backend identity.
     * @mode emit
     */
    'rp/workflow-backend-changed'(id: string): void
    /**
     * A request was assigned to one backend.
     * @param info - Immutable route decision.
     * @mode emit
     */
    'rp/workflow-routed'(info: RpWorkflowRouteInfo): void
    /**
     * A routed workflow reached a terminal status.
     * @param info - Immutable route decision.
     * @param outcome - Terminal backend result.
     * @mode emit
     */
    'rp/workflow-settled'(info: RpWorkflowRouteInfo, outcome: RpWorkflowOutcome): void
  }
}

/** RP pipeline family submitted to a workflow backend. */
export type RpWorkflowKind = 'turn' | 'workflow' | 'sidecar'
/** Execution technology declared by a workflow backend. */
export type RpWorkflowBackendKind = 'deterministic' | 'worker-thread' | 'isolated-process' | 'quickjs' | 'wasm' | 'remote'

/** Policy and payload for one routed workflow run. */
export interface RpWorkflowRequest {
  readonly kind: RpWorkflowKind
  readonly payload: JsonValue
  readonly backend?: string
  readonly requiredBackendKind?: RpWorkflowBackendKind
  readonly requiredTrust?: RpTrustLevel
  readonly authority?: RpAuthorityDecision
  readonly budget?: RpBudget
  readonly signal?: AbortSignal
}

/** Reversible workflow execution Provider. */
export interface RpWorkflowBackend {
  readonly id: string
  readonly kind: RpWorkflowBackendKind
  readonly trust: RpTrustLevel
  readonly priority?: number
  readonly kinds: readonly RpWorkflowKind[]
  execute(request: RpWorkflowRequest, signal: AbortSignal): Promise<JsonValue>
}

/** Immutable routing decision published before execution. */
export interface RpWorkflowRouteInfo {
  readonly id: string
  readonly backend: string
  readonly backendKind: RpWorkflowBackendKind
  readonly kind: RpWorkflowKind
  readonly startedAt: number
}

/** Terminal backend result. */
export interface RpWorkflowOutcome {
  readonly status: 'completed' | 'failed' | 'cancelled' | 'timed-out'
  readonly value?: JsonValue
  readonly error?: string
  readonly finishedAt: number
}

/** Live holder-owned workflow run. */
export interface RpWorkflowRun extends RpWorkflowRouteInfo {
  readonly result: Promise<RpWorkflowOutcome>
  cancel(reason?: string): void
}

/** Workflow backend registration, selection, trust, or input failure. */
export class RpWorkflowRouterError extends Error {
  constructor(message: string, readonly code: 'DUPLICATE' | 'NO_BACKEND' | 'INVALID' | 'TRUST_DENIED') {
    super(message); this.name = 'RpWorkflowRouterError'
  }
}

/** Policy-aware deterministic selector for replaceable workflow backends. */
export class RpWorkflowRouter extends Service {
  private readonly backends = new Map<string, RpWorkflowBackend>()

  constructor(ctx: Context) {
    super(ctx, 'rpWorkflowRouter')
    ctx.effect(() => this.register(createDeterministicBackend()))
  }

  /**
   * Register one workflow execution Provider.
   * @param backend - Workflow execution Provider.
   * @returns Idempotent registration disposer.
   */
  register(backend: RpWorkflowBackend): () => void {
    validateBackend(backend)
    if (this.backends.has(backend.id)) {
      throw new RpWorkflowRouterError(
        `Workflow backend ${JSON.stringify(backend.id)} already exists`,
        'DUPLICATE',
      )
    }
    const stored = Object.freeze({ ...backend, kinds: Object.freeze([...new Set(backend.kinds)]) })
    this.backends.set(stored.id, stored)
    this.ctx.emit('rp/workflow-backend-changed', stored.id)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.backends.get(stored.id) !== stored) return
      this.backends.delete(stored.id)
      this.ctx.emit('rp/workflow-backend-changed', stored.id)
    }
  }

  /**
   * List backends in deterministic priority order.
   * @returns Frozen registered backend descriptors.
   */
  list(): readonly RpWorkflowBackend[] {
    return [...this.backends.values()].sort((left, right) =>
      (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id))
  }

  /**
   * Select a backend and start one holder-owned run.
   * @param request - Routed workflow payload and constraints.
   * @returns Live cancellable workflow run.
   */
  start(request: RpWorkflowRequest): RpWorkflowRun {
    const backend = this.select(request)
    const controller = new AbortController()
    const id = randomUUID()
    const info: RpWorkflowRouteInfo = Object.freeze({
      id,
      backend: backend.id,
      backendKind: backend.kind,
      kind: request.kind,
      startedAt: Date.now(),
    })
    let status: RpWorkflowOutcome['status'] | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = () => {
      controller.abort(request.signal?.reason)
    }
    if (request.signal?.aborted === true) controller.abort(request.signal.reason)
    else request.signal?.addEventListener('abort', abort, { once: true })
    const timeoutMs = request.budget?.timeoutMs ?? request.authority?.budget.timeoutMs
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        status = 'timed-out'
        controller.abort('timeout')
      }, timeoutMs)
    }
    this.ctx.emit('rp/workflow-routed', info)
    const result = Promise.resolve()
      .then(() => backend.execute(request, controller.signal))
      .then<RpWorkflowOutcome>(value => Object.freeze({
        status: 'completed',
        value,
        finishedAt: Date.now(),
      }))
      .catch((error: unknown) => Object.freeze({
        status: status ?? (controller.signal.aborted ? 'cancelled' : 'failed'),
        error: renderError(error),
        finishedAt: Date.now(),
      }))
      .then((outcome) => {
        this.ctx.emit('rp/workflow-settled', info, outcome)
        return outcome
      })
      .finally(() => {
        if (timer !== undefined) clearTimeout(timer)
        request.signal?.removeEventListener('abort', abort)
      })
    return Object.freeze({
      ...info,
      result,
      cancel: (reason?: string) => {
        controller.abort(reason ?? 'cancelled')
      },
    })
  }

  private select(request: RpWorkflowRequest): RpWorkflowBackend {
    const candidates = this.list().filter(backend =>
      backend.kinds.includes(request.kind) && authorityAllows(request, backend))
    const selected = request.backend === undefined ? candidates.find(backend =>
      (request.requiredBackendKind === undefined || backend.kind === request.requiredBackendKind)
      && (request.requiredTrust === undefined || trustRank(backend.trust) >= trustRank(request.requiredTrust)))
      : this.backends.get(request.backend)
    if (selected === undefined || !selected.kinds.includes(request.kind)) {
      throw new RpWorkflowRouterError(`No workflow backend can execute ${request.kind}`, 'NO_BACKEND')
    }
    if (request.requiredBackendKind !== undefined && selected.kind !== request.requiredBackendKind) {
      throw new RpWorkflowRouterError(`Backend ${selected.id} is not ${request.requiredBackendKind}`, 'NO_BACKEND')
    }
    if (request.requiredTrust !== undefined && trustRank(selected.trust) < trustRank(request.requiredTrust)) {
      throw new RpWorkflowRouterError(
        `Backend ${selected.id} trust ${selected.trust} is below ${request.requiredTrust}`,
        'TRUST_DENIED',
      )
    }
    if (!authorityAllows(request, selected)) {
      throw new RpWorkflowRouterError(
        `Backend ${selected.id} trust ${selected.trust} exceeds the effective workflow authority`,
        'TRUST_DENIED',
      )
    }
    return selected
  }
}

/** Bounded declarative expression accepted by the built-in L0 backend. */
export type RpDeterministicExpression =
  | JsonValue
  | { readonly op: 'input' }
  | { readonly op: 'get'; readonly from: RpDeterministicExpression; readonly key: string }
  | { readonly op: 'object'; readonly entries: Readonly<Record<string, RpDeterministicExpression>> }
  | { readonly op: 'array'; readonly items: readonly RpDeterministicExpression[] }
  | {
    readonly op: 'if'
    readonly condition: RpDeterministicExpression
    readonly then: RpDeterministicExpression
    readonly else: RpDeterministicExpression
  }

/**
 * Create the built-in non-script workflow backend.
 * @param id - Backend registration identity.
 * @returns L0 deterministic workflow Provider.
 */
export function createDeterministicBackend(id: string = 'deterministic'): RpWorkflowBackend {
  return {
    id, kind: 'deterministic', trust: 'L0', priority: -100, kinds: ['turn', 'workflow', 'sidecar'],
    execute(request, signal) {
      const envelope = request.payload
      if (!isRecord(envelope) || !('expression' in envelope)) {
        throw new RpWorkflowRouterError('Deterministic payload requires expression', 'INVALID')
      }
      return Promise.resolve(evaluate(
        envelope.expression as RpDeterministicExpression,
        envelope.input ?? null,
        signal,
        0,
        { count: 0 },
      ))
    },
  }
}

function evaluate(
  expression: RpDeterministicExpression,
  input: JsonValue,
  signal: AbortSignal,
  depth: number,
  state: { count: number },
): JsonValue {
  if (signal.aborted) throw new Error('workflow cancelled')
  state.count += 1
  if (depth > 64 || state.count > 10_000) {
    throw new RpWorkflowRouterError('Deterministic workflow limit exceeded', 'INVALID')
  }
  if (!isRecord(expression) || typeof expression.op !== 'string') return expression
  const record = expression as Record<string, unknown>
  if (record.op === 'input') return input
  if (record.op === 'get') {
    if (typeof record.key !== 'string') throw new RpWorkflowRouterError('get.key must be a string', 'INVALID')
    const source = evaluate(record.from as RpDeterministicExpression, input, signal, depth + 1, state)
    return isRecord(source) && Object.hasOwn(source, record.key)
      ? source[record.key] as JsonValue
      : null
  }
  if (record.op === 'object') {
    if (!isRecord(record.entries)) throw new RpWorkflowRouterError('object.entries must be an object', 'INVALID')
    return Object.fromEntries(Object.entries(record.entries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [
        key,
        evaluate(value as RpDeterministicExpression, input, signal, depth + 1, state),
      ]))
  }
  if (record.op === 'array') {
    if (!Array.isArray(record.items)) throw new RpWorkflowRouterError('array.items must be an array', 'INVALID')
    return record.items.map(item => evaluate(item as RpDeterministicExpression, input, signal, depth + 1, state))
  }
  if (record.op === 'if') {
    const condition = evaluate(record.condition as RpDeterministicExpression, input, signal, depth + 1, state)
    return condition
      ? evaluate(record.then as RpDeterministicExpression, input, signal, depth + 1, state)
      : evaluate(record.else as RpDeterministicExpression, input, signal, depth + 1, state)
  }
  throw new RpWorkflowRouterError(`Unsupported deterministic operation ${String(record.op)}`, 'INVALID')
}

function validateBackend(backend: RpWorkflowBackend): void {
  if (backend.id.trim() === '' || backend.id !== backend.id.trim()) {
    throw new RpWorkflowRouterError('Workflow backend id must be normalized', 'INVALID')
  }
  if (backend.kinds.length === 0) throw new RpWorkflowRouterError('Workflow backend must support at least one kind', 'INVALID')
}
function authorityAllows(request: RpWorkflowRequest, backend: RpWorkflowBackend): boolean {
  return trustRank(backend.trust) <= trustRank(request.authority?.trust ?? 'L0')
}
function trustRank(value: RpTrustLevel): number { return value === 'L0' ? 0 : value === 'L1' ? 1 : 2 }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function renderError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unrenderable error]'
  }
}

export default RpWorkflowRouter
