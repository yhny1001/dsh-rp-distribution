/** Idempotent outbox and compensating saga runtime for non-transactional RP effects. @module @dsh-rp/outbox */

import { Context, Service } from '@deepseek-ai/cordis'
import type { JsonValue, RpScopeRef } from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpOutbox: RpOutbox }
  interface Events {
    /**
     * An Outbox entry changed status or attempt metadata.
     * @param entry - Newly committed immutable entry.
     * @mode emit
     */
    'rp/outbox-changed'(entry: RpOutboxEntry): void
    /**
     * One successful Saga step was compensated.
     * @param sagaId - Saga identity.
     * @param step - Compensated step identity.
     * @mode emit
     */
    'rp/saga-compensated'(sagaId: string, step: string): void
  }
}

/** One committed intent for an external effect. */
export interface RpOutboxRequest {
  readonly idempotencyKey: string
  readonly handler: string
  readonly scope: RpScopeRef
  readonly payload: JsonValue
  readonly maxAttempts?: number
}
/** Immutable Outbox state after one transition. */
export interface RpOutboxEntry extends RpOutboxRequest {
  readonly status: 'pending' | 'running' | 'completed' | 'failed'
  readonly attempts: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly result?: JsonValue
  readonly error?: string
}
/** Reversible Provider for one external-effect family. */
export interface RpOutboxHandler {
  readonly id: string
  execute(entry: RpOutboxEntry, signal?: AbortSignal): Promise<JsonValue>
  compensate?(entry: RpOutboxEntry, result: JsonValue, signal?: AbortSignal): Promise<void>
}
/** One named step in a compensating Saga. */
export interface RpSagaStep { readonly id: string; readonly request: RpOutboxRequest }
/** Terminal Saga status and its compensation trace. */
export interface RpSagaOutcome {
  readonly id: string
  readonly status: 'completed' | 'failed' | 'compensation-failed'
  readonly completed: readonly string[]
  readonly compensated: readonly string[]
  readonly error?: string
}

/** Outbox registration, identity, lookup, or concurrency failure. */
export class RpOutboxError extends Error {
  constructor(message: string, readonly code: 'DUPLICATE' | 'INVALID' | 'NO_HANDLER' | 'BUSY') { super(message); this.name = 'RpOutboxError' }
}

/** Process-local reference Outbox with bounded retry and Saga compensation. */
export class RpOutbox extends Service {
  private readonly entries = new Map<string, RpOutboxEntry>()
  private readonly handlers = new Map<string, RpOutboxHandler>()

  constructor(ctx: Context) { super(ctx, 'rpOutbox') }

  /**
   * Register one external-effect Provider.
   * @param handler - Effect executor and optional compensator.
   * @returns Idempotent registration disposer.
   */
  register(handler: RpOutboxHandler): () => void {
    if (handler.id.trim() === '' || handler.id !== handler.id.trim()) {
      throw new RpOutboxError('Outbox handler id must be normalized', 'INVALID')
    }
    if (this.handlers.has(handler.id)) throw new RpOutboxError(`Outbox handler ${handler.id} already exists`, 'DUPLICATE')
    this.handlers.set(handler.id, handler)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.handlers.get(handler.id) === handler) this.handlers.delete(handler.id)
    }
  }

  /**
   * Enqueue or retrieve one idempotent intent.
   * @param request - Committed external-effect intent.
   * @param now - Creation timestamp supplied by the owning clock.
   * @returns Frozen current entry.
   */
  enqueue(request: RpOutboxRequest, now: number = Date.now()): RpOutboxEntry {
    validateRequest(request)
    const existing = this.entries.get(request.idempotencyKey)
    if (existing !== undefined) {
      if (existing.handler !== request.handler
        || canonical(existing.payload) !== canonical(request.payload)
        || scopeKey(existing.scope) !== scopeKey(request.scope)) {
        throw new RpOutboxError(
          `Idempotency key ${request.idempotencyKey} was reused with different work`,
          'DUPLICATE',
        )
      }
      return existing
    }
    const entry = freezeEntry({
      ...request,
      maxAttempts: request.maxAttempts ?? 3,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    })
    this.entries.set(entry.idempotencyKey, entry)
    this.ctx.emit('rp/outbox-changed', entry)
    return entry
  }

  /**
   * Read one intent without changing it.
   * @param idempotencyKey - Stable intent identity.
   * @returns Frozen entry when present.
   */
  get(idempotencyKey: string): RpOutboxEntry | undefined { return this.entries.get(idempotencyKey) }
  /**
   * List intents in deterministic creation order.
   * @param status - Optional status filter.
   * @returns Frozen matching entries.
   */
  list(status?: RpOutboxEntry['status']): readonly RpOutboxEntry[] {
    return [...this.entries.values()]
      .filter(item => status === undefined || item.status === status)
      .sort((a, b) => a.createdAt - b.createdAt || a.idempotencyKey.localeCompare(b.idempotencyKey))
  }

  /**
   * Attempt one pending intent exactly once for this call.
   * @param idempotencyKey - Stable intent identity.
   * @param signal - Optional cancellation signal.
   * @returns Frozen post-attempt entry.
   */
  async dispatch(idempotencyKey: string, signal?: AbortSignal): Promise<RpOutboxEntry> {
    const entry = this.entries.get(idempotencyKey)
    if (entry === undefined) throw new RpOutboxError(`Outbox entry ${idempotencyKey} not found`, 'INVALID')
    if (entry.status === 'completed' || entry.status === 'failed') return entry
    if (entry.status === 'running') throw new RpOutboxError(`Outbox entry ${idempotencyKey} is already running`, 'BUSY')
    const handler = this.handlers.get(entry.handler)
    if (handler === undefined) throw new RpOutboxError(`Outbox handler ${entry.handler} is not registered`, 'NO_HANDLER')
    const running = this.update(entry, { status: 'running', attempts: entry.attempts + 1, updatedAt: Date.now() })
    try {
      if (signal?.aborted === true) throw signal.reason ?? new Error('cancelled')
      const result = await handler.execute(running, signal)
      return this.update(running, { status: 'completed', result, updatedAt: Date.now() })
    } catch (error: unknown) {
      const failed = running.attempts >= (running.maxAttempts ?? 3)
      return this.update(running, {
        status: failed ? 'failed' : 'pending',
        error: renderError(error),
        updatedAt: Date.now(),
      })
    }
  }

  /**
   * Dispatch a bounded deterministic batch of pending intents.
   * @param options - Batch limit and cancellation signal.
   * @returns Post-attempt entries.
   */
  async drain(options: { readonly limit?: number; readonly signal?: AbortSignal } = {}): Promise<readonly RpOutboxEntry[]> {
    const pending = this.list('pending').slice(0, options.limit ?? 100)
    const results: RpOutboxEntry[] = []
    for (const entry of pending) {
      if (options.signal?.aborted === true) break
      results.push(await this.dispatch(entry.idempotencyKey, options.signal))
    }
    return results
  }

  /**
   * Execute sequential steps and compensate successful steps after failure.
   * @param id - Saga identity used for audit events.
   * @param steps - Ordered effect intents.
   * @param signal - Optional cancellation signal.
   * @returns Frozen terminal Saga outcome.
   */
  async saga(id: string, steps: readonly RpSagaStep[], signal?: AbortSignal): Promise<RpSagaOutcome> {
    if (id.trim() === '' || new Set(steps.map(step => step.id)).size !== steps.length) {
      throw new RpOutboxError('Saga id and step ids must be unique and non-empty', 'INVALID')
    }
    const completed: { step: RpSagaStep; entry: RpOutboxEntry; result: JsonValue }[] = []
    for (const step of steps) {
      const queued = this.enqueue(step.request)
      const result = await this.dispatch(queued.idempotencyKey, signal)
      if (result.status === 'completed' && result.result !== undefined) {
        completed.push({ step, entry: result, result: result.result })
        continue
      }
      const compensated: string[] = []
      let compensationFailed = false
      for (const item of completed.toReversed()) {
        const handler = this.handlers.get(item.entry.handler)
        if (handler?.compensate === undefined) continue
        try {
          await handler.compensate(item.entry, item.result, signal)
          compensated.push(item.step.id)
          this.ctx.emit('rp/saga-compensated', id, item.step.id)
        } catch {
          compensationFailed = true
        }
      }
      return Object.freeze({
        id,
        status: compensationFailed ? 'compensation-failed' : 'failed',
        completed: Object.freeze(completed.map(item => item.step.id)),
        compensated: Object.freeze(compensated),
        ...(result.error === undefined ? {} : { error: result.error }),
      })
    }
    return Object.freeze({ id, status: 'completed', completed: Object.freeze(completed.map(item => item.step.id)), compensated: Object.freeze([]) })
  }

  private update(previous: RpOutboxEntry, patch: Partial<RpOutboxEntry>): RpOutboxEntry {
    const next = freezeEntry({ ...previous, ...patch })
    if (this.entries.get(previous.idempotencyKey) !== previous) {
      throw new RpOutboxError('Outbox entry changed concurrently', 'BUSY')
    }
    this.entries.set(next.idempotencyKey, next)
    this.ctx.emit('rp/outbox-changed', next)
    return next
  }
}

function validateRequest(request: RpOutboxRequest): void {
  if (request.idempotencyKey.trim() === '' || request.handler.trim() === '') {
    throw new RpOutboxError('Outbox idempotencyKey and handler must be non-empty', 'INVALID')
  }
  if (request.maxAttempts !== undefined
    && (!Number.isSafeInteger(request.maxAttempts)
      || request.maxAttempts < 1
      || request.maxAttempts > 100)) {
    throw new RpOutboxError('Outbox maxAttempts must be between 1 and 100', 'INVALID')
  }
}
function freezeEntry(entry: RpOutboxEntry): RpOutboxEntry { return Object.freeze({ ...entry, scope: Object.freeze({ ...entry.scope }) }) }
function scopeKey(scope: RpScopeRef): string { return `${scope.kind}:${scope.id}` }
function canonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key] as JsonValue)}`)
    .join(',')}}`
}
function renderError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unrenderable error]'
  }
}

export const name = 'rp-outbox'
export default RpOutbox
