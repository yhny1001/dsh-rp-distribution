/** Bounded deterministic memory provider. @module @dsh-rp/memory-basic */
import { Context, Service } from '@deepseek-ai/cordis'
import type { MemoryEvent, RpScopeRef } from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpMemory: RpMemoryBasic }
  interface Events {
    /**
     * A memory fact was accepted into the live projection.
     * @param scope - Memory lifecycle scope.
     * @param event - Frozen accepted memory.
     * @mode emit
     */
    'rp/memory-basic-accepted'(scope: RpScopeRef, event: MemoryEvent): void
  }
}

/** Retrieval controls with hard result and character bounds. */
export interface RpMemoryQuery {
  readonly text: string
  readonly owner?: string
  readonly tags?: readonly string[]
  readonly retriever?: string
  readonly limit?: number
  readonly maxCharacters?: number
}
/** Scored memory returned in deterministic order. */
export interface RpMemoryHit { readonly event: MemoryEvent; readonly score: number }
/** Replaceable pure scoring Provider over the canonical scoped memory projection. */
export interface RpMemoryRetriever {
  readonly id: string
  readonly version: string
  readonly title: string
  readonly priority?: number
  score(event: MemoryEvent, query: RpMemoryQuery, scope: RpScopeRef): number | undefined
}
/** Retriever metadata exposed to capability catalogs and inspectors. */
export type RpMemoryRetrieverDescriptor = Readonly<Pick<RpMemoryRetriever, 'id' | 'version' | 'title' | 'priority'>>

/** Replaceable durable backing store. It owns IO and conflict-safe idempotency. */
export interface RpMemoryStore {
  readonly id: string
  readonly version: string
  readonly title: string
  readonly priority?: number
  load(scope: RpScopeRef): Promise<readonly MemoryEvent[]>
  append(scope: RpScopeRef, event: MemoryEvent): Promise<MemoryEvent>
  release(scope: RpScopeRef): Promise<boolean>
}
/** Store metadata exposed without leaking implementation handles. */
export type RpMemoryStoreDescriptor = Readonly<Pick<RpMemoryStore, 'id' | 'version' | 'title' | 'priority'>>

/** Live scoped projection for accepted memory facts. */
export class RpMemoryBasic extends Service {
  private readonly projections = new Map<string, Map<string, MemoryEvent>>()
  private readonly retrievers = new Map<string, RpMemoryRetriever>()
  private readonly stores = new Map<string, RpMemoryStore>()
  private readonly hydrated = new Set<string>()
  private readonly hydration = new Map<string, Promise<void>>()
  constructor(ctx: Context) {
    super(ctx, 'rpMemory')
    ctx.effect(() => this.registerRetriever(createLexicalRetriever()))
  }

  /**
   * Register one reversible retrieval algorithm.
   * @param retriever - Pure scoring Provider.
   * @returns Idempotent registration disposer.
   */
  registerRetriever(retriever: RpMemoryRetriever): () => void {
    if (retriever.id.trim() === '' || retriever.version.trim() === '' || retriever.title.trim() === '') {
      throw new Error('RP memory retriever id, version, and title are required')
    }
    if (this.retrievers.has(retriever.id)) throw new Error(`RP memory retriever ${JSON.stringify(retriever.id)} already exists`)
    const stored = Object.freeze({ ...retriever, priority: retriever.priority ?? 0 })
    this.retrievers.set(stored.id, stored)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.retrievers.get(stored.id) === stored) this.retrievers.delete(stored.id)
    }
  }

  /**
   * List retrieval Providers in deterministic selection order.
   * @returns Frozen Provider descriptors.
   */
  listRetrievers(): readonly RpMemoryRetrieverDescriptor[] {
    return Object.freeze([...this.retrievers.values()]
      .sort(compareRetrievers)
      .map(retriever => Object.freeze({
        id: retriever.id,
        version: retriever.version,
        title: retriever.title,
        priority: retriever.priority ?? 0,
      })))
  }

  /**
   * Register one reversible durable store Provider.
   * @param store - Durable store implementation.
   * @returns Idempotent registration disposer.
   */
  registerStore(store: RpMemoryStore): () => void {
    validateProvider(store, 'store')
    if (this.stores.has(store.id)) throw new Error(`RP memory store ${JSON.stringify(store.id)} already exists`)
    const stored: RpMemoryStore = Object.freeze({
      id: store.id,
      version: store.version,
      title: store.title,
      priority: store.priority ?? 0,
      load: (scope: RpScopeRef) => store.load(scope),
      append: (scope: RpScopeRef, event: MemoryEvent) => store.append(scope, event),
      release: (scope: RpScopeRef) => store.release(scope),
    })
    this.stores.set(stored.id, stored)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.stores.get(stored.id) === stored) this.stores.delete(stored.id)
    }
  }

  /**
   * List durable store Providers in deterministic selection order.
   * @returns Frozen store descriptors.
   */
  listStores(): readonly RpMemoryStoreDescriptor[] {
    return Object.freeze([...this.stores.values()]
      .sort(compareProviders)
      .map(store => Object.freeze({
        id: store.id, version: store.version, title: store.title, priority: store.priority ?? 0,
      })))
  }

  /**
   * Load one durable scope into the live projection exactly once per Provider.
   * Concurrent callers share one load and failures remain retryable.
   * @param scope - Memory lifecycle scope.
   * @param storeId - Optional explicit durable Provider.
   */
  async hydrate(scope: RpScopeRef, storeId?: string): Promise<void> {
    const store = selectStore(this.stores, storeId)
    const hydrationKey = `${memoryScopeKey(scope)}\u0000${store.id}`
    if (this.hydrated.has(hydrationKey)) return
    const current = this.hydration.get(hydrationKey)
    if (current !== undefined) return current
    const pending = store.load(freezeScope(scope)).then((events) => {
      mergeLoadedEvents(this.projections, scope, events)
      this.hydrated.add(hydrationKey)
    }).finally(() => {
      this.hydration.delete(hydrationKey)
    })
    this.hydration.set(hydrationKey, pending)
    return pending
  }

  /**
   * Persist one memory before exposing it in the live projection.
   * @param scope - Memory lifecycle scope.
   * @param event - Durable memory fact.
   * @param storeId - Optional explicit durable Provider.
   * @returns Frozen stored memory.
   */
  async appendDurable(scope: RpScopeRef, event: MemoryEvent, storeId?: string): Promise<MemoryEvent> {
    validateEvent(event)
    const existing = this.projections.get(memoryScopeKey(scope))?.get(event.id)
    if (existing !== undefined) {
      assertSameEvent(existing, event)
    }
    const store = selectStore(this.stores, storeId)
    const stored = await store.append(freezeScope(scope), freezeEvent(event))
    validateEvent(stored)
    assertSameEvent(stored, event)
    return this.insert(scope, stored, true)
  }

  /**
   * Atomically ask the selected Provider to remove a scope, then drop its live projection.
   * @param scope - Memory lifecycle scope.
   * @param storeId - Optional explicit durable Provider.
   * @returns Whether the durable scope existed.
   */
  async releaseDurable(scope: RpScopeRef, storeId?: string): Promise<boolean> {
    const store = selectStore(this.stores, storeId)
    const released = await store.release(freezeScope(scope))
    if (!released) return false
    const prefix = `${memoryScopeKey(scope)}\u0000`
    for (const key of [...this.hydrated]) if (key.startsWith(prefix)) this.hydrated.delete(key)
    this.projections.delete(memoryScopeKey(scope))
    return true
  }

  /**
   * Append an idempotent memory; conflicting duplicate ids fail.
   * @param scope - Memory lifecycle scope.
   * @param event - Durable memory fact.
   * @returns Frozen accepted memory.
   */
  append(scope: RpScopeRef, event: MemoryEvent): MemoryEvent {
    validateEvent(event)
    return this.insert(scope, event, true)
  }

  private insert(scope: RpScopeRef, event: MemoryEvent, emit: boolean): MemoryEvent {
    const key = memoryScopeKey(scope)
    const projection = this.projections.get(key) ?? new Map<string, MemoryEvent>()
    const existing = projection.get(event.id)
    if (existing !== undefined) {
      assertSameEvent(existing, event)
      return existing
    }
    if (projection.size >= 100_000) throw new Error('RP memory scope is limited to 100000 events')
    const frozen = freezeEvent(event)
    projection.set(frozen.id, frozen)
    this.projections.set(key, projection)
    if (emit) {
      try { this.ctx.emit('rp/memory-basic-accepted', freezeScope(scope), frozen) }
      catch (error: unknown) { this.ctx.logger.warn(`RP memory accepted listener failed: ${renderError(error)}`) }
    }
    return frozen
  }

  /**
   * Retrieve through an explicit Provider or the highest-priority installed Provider.
   * @param scope - Memory lifecycle scope.
   * @param query - Bounded retrieval controls.
   * @returns Frozen matches in deterministic score order.
   */
  search(scope: RpScopeRef, query: RpMemoryQuery): readonly RpMemoryHit[] {
    return this.searchEvents(scope, [...this.projections.get(memoryScopeKey(scope))?.values() ?? []], query)
  }

  /**
   * Retrieve over an authoritative caller-supplied projection without mutating the live Store.
   * This is the Event Log replay path used at a frozen turn boundary.
   * @param scope - Memory lifecycle scope.
   * @param events - Committed memory facts reconstructed for the scope.
   * @param query - Bounded retrieval controls.
   * @returns Frozen matches in deterministic score order.
   */
  searchEvents(scope: RpScopeRef, events: readonly MemoryEvent[], query: RpMemoryQuery): readonly RpMemoryHit[] {
    validateQuery(query)
    for (const event of events) validateEvent(event)
    const retriever = selectRetriever(this.retrievers, query.retriever)
    const requiredTags = new Set(query.tags ?? [])
    const limit = bounded(query.limit ?? 8, 1, 100)
    const maxCharacters = bounded(query.maxCharacters ?? 8_000, 1, 100_000)
    const candidates = [...events]
      .filter(event => query.owner === undefined || event.owner === query.owner)
      .filter(event => [...requiredTags].every(tag => event.tags?.includes(tag) === true))
      .map(event => ({ event, score: retriever.score(event, query, scope) }))
      .filter((hit): hit is { event: MemoryEvent; score: number } => hit.score !== undefined)
      .sort((left, right) => right.score - left.score
        || right.event.createdAt - left.event.createdAt
        || left.event.id.localeCompare(right.event.id))
    const selected: RpMemoryHit[] = []
    let characters = 0
    for (const hit of candidates) {
      if (selected.length >= limit || characters + hit.event.content.length > maxCharacters) break
      selected.push(Object.freeze(hit))
      characters += hit.event.content.length
    }
    return Object.freeze(selected)
  }

  /**
   * Remove one complete live scope projection.
   * @param scope - Memory lifecycle scope.
   * @returns Whether a projection existed.
   */
  release(scope: RpScopeRef): boolean { return this.projections.delete(memoryScopeKey(scope)) }
}

/**
 * Create the built-in normalized-token lexical retrieval Provider.
 * @returns Zero-infrastructure lexical scorer.
 */
export function createLexicalRetriever(): RpMemoryRetriever {
  return {
    id: 'lexical',
    version: '1.0.0',
    title: 'Lexical overlap',
    priority: 0,
    score(event, query) {
      const tokens = tokenize(query.text)
      const eventTokens = tokenize(`${event.content} ${(event.tags ?? []).join(' ')}`)
      const overlap = [...tokens].filter(token => eventTokens.has(token)).length
      if (tokens.size > 0 && overlap === 0) return undefined
      return overlap * 10 + event.salience + Math.min(event.createdAt / 1e15, 0.001)
    },
  }
}

function validateEvent(event: MemoryEvent): void {
  if (event.id.length === 0 || event.id.length > 512 || event.owner.length === 0 || event.owner.length > 512
    || event.content.trim().length === 0 || event.content.length > 100_000) {
    throw new Error('RP memory id and owner must contain 1 to 512 characters; content must contain 1 to 100000 characters')
  }
  if (!Number.isFinite(event.salience) || event.salience < 0 || event.salience > 1) {
    throw new Error('RP memory salience must be between zero and one')
  }
  if (!Number.isSafeInteger(event.createdAt) || event.createdAt < 0) {
    throw new Error('RP memory createdAt must be a non-negative safe integer')
  }
  if ((event.tags?.length ?? 0) > 100 || event.tags?.some(tag => tag.trim() === '' || tag.length > 256) === true) {
    throw new Error('RP memory tags must contain at most 100 non-empty values of at most 256 characters')
  }
}
function validateQuery(query: RpMemoryQuery): void {
  if (query.text.length > 100_000) throw new Error('RP memory query text is limited to 100000 characters')
  if (query.retriever !== undefined && query.retriever.trim() === '') {
    throw new Error('RP memory retriever id must be non-empty when supplied')
  }
  if ((query.tags?.length ?? 0) > 100 || query.tags?.some(tag => tag.trim() === '' || tag.length > 256) === true) {
    throw new Error('RP memory query tags must contain at most 100 non-empty values of at most 256 characters')
  }
}
function selectRetriever(retrievers: ReadonlyMap<string, RpMemoryRetriever>, id: string | undefined): RpMemoryRetriever {
  if (id !== undefined) {
    const selected = retrievers.get(id)
    if (selected === undefined) throw new Error(`RP memory retriever ${JSON.stringify(id)} is not registered`)
    return selected
  }
  const selected = [...retrievers.values()].sort(compareRetrievers)[0]
  if (selected === undefined) throw new Error('No RP memory retriever is registered')
  return selected
}
function compareRetrievers(left: RpMemoryRetriever, right: RpMemoryRetriever): number {
  return compareProviders(left, right)
}
function tokenize(value: string): Set<string> { return new Set(value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) }
function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`RP memory bound must be an integer between ${min} and ${max}`)
  }
  return value
}
/**
 * Produce the canonical parent-aware identity shared by memory Providers.
 * @param scope - Scope reference including its optional parent chain.
 * @returns Stable JSON identity for that complete scope chain.
 */
export function memoryScopeKey(scope: RpScopeRef): string {
  return JSON.stringify([scope.kind, scope.id, scope.parent === undefined ? null : memoryScopeKey(scope.parent)])
}
function freezeScope(scope: RpScopeRef): RpScopeRef {
  return Object.freeze({
    ...scope,
    ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }),
  })
}

function freezeEvent(event: MemoryEvent): MemoryEvent {
  return Object.freeze({
    ...event,
    ...(event.tags === undefined ? {} : { tags: Object.freeze([...event.tags]) }),
  })
}
function validateProvider(provider: Pick<RpMemoryStore, 'id' | 'version' | 'title'>, label: string): void {
  if (provider.id.trim() === '' || provider.version.trim() === '' || provider.title.trim() === '') {
    throw new Error(`RP memory ${label} id, version, and title are required`)
  }
}
function selectStore(stores: ReadonlyMap<string, RpMemoryStore>, id: string | undefined): RpMemoryStore {
  if (id !== undefined) {
    const selected = stores.get(id)
    if (selected === undefined) throw new Error(`RP memory store ${JSON.stringify(id)} is not registered`)
    return selected
  }
  const selected = [...stores.values()].sort(compareProviders)[0]
  if (selected === undefined) throw new Error('No durable RP memory store is registered')
  return selected
}
function compareProviders(
  left: { readonly id: string; readonly priority?: number },
  right: { readonly id: string; readonly priority?: number },
): number {
  return (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id)
}
function assertSameEvent(left: MemoryEvent, right: MemoryEvent): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`RP memory id ${JSON.stringify(right.id)} already has different content`)
  }
}
function mergeLoadedEvents(
  projections: Map<string, Map<string, MemoryEvent>>,
  scope: RpScopeRef,
  events: readonly MemoryEvent[],
): void {
  const key = memoryScopeKey(scope)
  const projection = projections.get(key) ?? new Map<string, MemoryEvent>()
  if (projection.size + events.length > 100_000) throw new Error('RP memory scope is limited to 100000 events')
  const prepared = new Map<string, MemoryEvent>()
  for (const event of events) {
    validateEvent(event)
    const existing = projection.get(event.id) ?? prepared.get(event.id)
    if (existing !== undefined) assertSameEvent(existing, event)
    else prepared.set(event.id, freezeEvent(event))
  }
  for (const [id, event] of prepared) projection.set(id, event)
  projections.set(key, projection)
}
function renderError(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error) }
  catch { return '[unrenderable error]' }
}
export default RpMemoryBasic
