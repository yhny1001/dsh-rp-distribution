/** Durable RP memory and persisted local vector index. @module @dsh-rp/memory-durable */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryEvent, RpScopeRef } from '@dsh-rp/contracts'
import { memoryScopeKey } from '@dsh-rp/memory-basic'
import type { RpMemoryRetriever, RpMemoryStore } from '@dsh-rp/memory-basic'
import type {} from '@dsh-rp/memory-basic'
import z from 'zod'

interface SparseVectorEntry { readonly index: number; readonly value: number }
interface DurableMemoryRecord {
  readonly schemaVersion: 1
  readonly scopeKey: string
  readonly event: MemoryEvent
  readonly vector: readonly SparseVectorEntry[]
}

const memoryEventSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  owner: z.string(),
  content: z.string(),
  salience: z.number(),
  createdAt: z.number(),
  sourceTurn: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).strict() as unknown as z.ZodType<MemoryEvent>

const durableRecordSchema = z.object({
  schemaVersion: z.literal(1),
  scopeKey: z.string(),
  event: memoryEventSchema,
  vector: z.array(z.object({
    index: z.number().int().min(0).max(255),
    value: z.number().int().min(-100_000).max(100_000),
  }).strict()).max(256),
}).strict() as z.ZodType<DurableMemoryRecord>

/** Storage-domain schema for durable RP memories and their precomputed vectors. */
export const RP_MEMORY_DOMAIN = defineDomain({
  name: 'dsh_rp_memory',
  version: 1,
  tables: { memories: domainTable<string, DurableMemoryRecord>(durableRecordSchema) },
})

/** Storage-domain backed Provider. Writes serialize through the domain before live publication. */
export class RpDomainMemoryProvider implements RpMemoryStore {
  readonly id = 'storage-domain-v1'
  readonly version = '1.0.0'
  readonly title = 'DSH durable domain memory'
  readonly priority = 100
  private readonly table: KvTable<string, DurableMemoryRecord>
  private readonly vectors = new Map<string, readonly SparseVectorEntry[]>()
  private chain: Promise<void> = Promise.resolve()

  constructor(domain: Domain<typeof RP_MEMORY_DOMAIN>) {
    this.table = domain.table('memories')
    for (const record of [...this.table.entries()].map(([, value]) => value)) {
      const vector = freezeVector(vectorize(memoryText(record.event)))
      if (JSON.stringify(vector) !== JSON.stringify(record.vector)) {
        throw new Error(`RP durable memory vector for ${JSON.stringify(record.event.id)} is corrupted`)
      }
      this.vectors.set(vectorCacheKey(record.scopeKey, record.event.id), vector)
    }
  }

  async load(scope: RpScopeRef): Promise<readonly MemoryEvent[]> {
    await this.chain
    const key = memoryScopeKey(scope)
    return Object.freeze([...this.table.entries()]
      .map(([, record]) => record)
      .filter(record => record.scopeKey === key)
      .map(record => freezeEvent(record.event))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)))
  }

  append(scope: RpScopeRef, event: MemoryEvent): Promise<MemoryEvent> {
    const scopeIdentity = memoryScopeKey(scope)
    return this.enqueue(async () => {
      const key = recordKey(scopeIdentity, event.id)
      const existing = this.table.get(key)
      if (existing !== undefined) {
        assertRecordIdentity(existing, scopeIdentity, event)
        return freezeEvent(existing.event)
      }
      const storedEvent = freezeEvent(event)
      const vector = freezeVector(vectorize(memoryText(storedEvent)))
      const record: DurableMemoryRecord = Object.freeze({
        schemaVersion: 1,
        scopeKey: scopeIdentity,
        event: storedEvent,
        vector,
      })
      await this.table.put(key, record)
      this.vectors.set(vectorCacheKey(scopeIdentity, storedEvent.id), vector)
      return storedEvent
    })
  }

  release(scope: RpScopeRef): Promise<boolean> {
    const scopeIdentity = memoryScopeKey(scope)
    return this.enqueue(async () => {
      const records = [...this.table.entries()].filter(([, record]) => record.scopeKey === scopeIdentity)
      if (records.length === 0) return false
      for (const [key, record] of records) {
        await this.table.delete(key)
        this.vectors.delete(vectorCacheKey(scopeIdentity, record.event.id))
      }
      return true
    })
  }

  /**
   * Create the retriever that reuses persisted vectors for durable events.
   * @returns Reversible deterministic vector-scoring Provider.
   */
  createRetriever(): RpMemoryRetriever {
    let lastQuery = ''
    let lastVector: readonly SparseVectorEntry[] = Object.freeze([])
    return {
      id: 'durable-fnv-vector-256',
      version: '1.0.0',
      title: 'Durable local vector (256 dimensions)',
      priority: 200,
      score: (event, query, scope) => {
        if (lastQuery !== query.text) {
          lastQuery = query.text
          lastVector = freezeVector(vectorize(query.text))
        }
        const eventVector = this.vectors.get(vectorCacheKey(memoryScopeKey(scope), event.id))
          ?? vectorize(memoryText(event))
        const similarity = sparseCosine(lastVector, eventVector)
        if (lastVector.length === 0 || similarity <= 0) return undefined
        return similarity * 100 + event.salience + Math.min(event.createdAt / 1e15, 0.001)
      },
    }
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.chain.then(job)
    this.chain = result.then(() => {}, () => {})
    return result
  }
}

function vectorize(value: string): readonly SparseVectorEntry[] {
  const values = new Int32Array(256)
  const tokens = value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  for (const token of tokens) {
    const hash = fnv1a(token)
    const index = hash & 0xff
    values[index] = (values[index] ?? 0) + ((hash & 0x100) === 0 ? 1 : -1)
  }
  return [...values.entries()]
    .filter(([, item]) => item !== 0)
    .map(([index, item]) => Object.freeze({ index, value: item }))
}

function sparseCosine(left: readonly SparseVectorEntry[], right: readonly SparseVectorEntry[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const rightValues = new Map(right.map(entry => [entry.index, entry.value]))
  let product = 0
  let leftSquare = 0
  let rightSquare = 0
  for (const entry of left) {
    product += entry.value * (rightValues.get(entry.index) ?? 0)
    leftSquare += entry.value * entry.value
  }
  for (const entry of right) rightSquare += entry.value * entry.value
  return product / Math.sqrt(leftSquare * rightSquare)
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function recordKey(scopeIdentity: string, eventId: string): string {
  return createHash('sha256').update(scopeIdentity).update('\u0000').update(eventId).digest('hex')
}
function vectorCacheKey(scopeIdentity: string, eventId: string): string { return `${scopeIdentity}\u0000${eventId}` }
function memoryText(event: MemoryEvent): string { return `${event.content} ${(event.tags ?? []).join(' ')}` }
function freezeEvent(event: MemoryEvent): MemoryEvent {
  return Object.freeze({
    ...event,
    ...(event.tags === undefined ? {} : { tags: Object.freeze([...event.tags]) }),
  })
}
function freezeVector(vector: readonly SparseVectorEntry[]): readonly SparseVectorEntry[] {
  return Object.freeze(vector.map(entry => Object.freeze({ index: entry.index, value: entry.value })))
}
function assertRecordIdentity(record: DurableMemoryRecord, scopeIdentity: string, event: MemoryEvent): void {
  if (record.scopeKey !== scopeIdentity || record.event.id !== event.id) {
    throw new Error('RP durable memory hash collision detected')
  }
  if (JSON.stringify(record.event) !== JSON.stringify(event)) {
    throw new Error(`RP durable memory id ${JSON.stringify(event.id)} already has different content`)
  }
}

/** Cordis plugin name. */
export const name = 'rp-memory-durable'
/** Durable memory composes the canonical RP memory service and Storage Domain. */
export const inject = ['rpMemory', 'storageDomain']

/** Open the durable domain and register storage plus vector Providers as reversible Effects. */
export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(RP_MEMORY_DOMAIN)
  let releaseStore: (() => void) | undefined
  let releaseRetriever: (() => void) | undefined
  try {
    const provider = new RpDomainMemoryProvider(domain)
    releaseStore = ctx.rpMemory.registerStore(provider)
    releaseRetriever = ctx.rpMemory.registerRetriever(provider.createRetriever())
    ctx.effect(() => async () => {
      releaseRetriever?.()
      releaseStore?.()
      await domain.close()
    })
  } catch (error: unknown) {
    releaseRetriever?.()
    releaseStore?.()
    await domain.close()
    throw error
  }
}
