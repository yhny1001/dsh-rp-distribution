/** Deterministic local vector retrieval Provider. @module @dsh-rp/memory-vector */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { MemoryEvent } from '@dsh-rp/contracts'
import type { RpMemoryQuery, RpMemoryRetriever } from '@dsh-rp/memory-basic'
import type {} from '@dsh-rp/memory-basic'

/** Cordis plugin name. */
export const name = 'rp-memory-vector'
/** The vector Provider contributes to the canonical memory service. */
export const inject = ['rpMemory']

/** Register the local hash-vector Provider as one reversible Effect. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.rpMemory.registerRetriever(createHashVectorRetriever()), 'rp-memory-vector retriever')
}

/**
 * Create a deterministic signed-hash cosine retriever without network or model calls.
 * @returns Local 256-dimensional vector scorer.
 */
export function createHashVectorRetriever(): RpMemoryRetriever {
  return {
    id: 'hash-vector-256',
    version: '1.0.0',
    title: 'Local hash vector (256 dimensions)',
    priority: 100,
    score(event, query) {
      const queryVector = vectorize(query.text)
      const eventVector = vectorize(memoryText(event))
      const similarity = cosine(queryVector, eventVector)
      if (queryVector.norm === 0 || similarity <= 0) return undefined
      return similarity * 100 + event.salience + Math.min(event.createdAt / 1e15, 0.001)
    },
  }
}

interface Vector { readonly values: Int32Array; readonly norm: number }

function vectorize(value: string): Vector {
  const values = new Int32Array(256)
  const tokens = value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest()
    const index = digest.readUInt8(0)
    values[index] = (values[index] ?? 0) + (digest.readUInt8(1) % 2 === 0 ? 1 : -1)
  }
  return { values, norm: Math.sqrt(values.reduce((sum, item) => sum + item * item, 0)) }
}

function cosine(left: Vector, right: Vector): number {
  if (left.norm === 0 || right.norm === 0) return 0
  let product = 0
  for (let index = 0; index < left.values.length; index += 1) {
    product += (left.values[index] ?? 0) * (right.values[index] ?? 0)
  }
  return product / (left.norm * right.norm)
}

function memoryText(event: MemoryEvent): string { return `${event.content} ${(event.tags ?? []).join(' ')}` }

/** Exported only to keep public query compatibility visible in generated declarations. */
export type VectorMemoryQuery = RpMemoryQuery
