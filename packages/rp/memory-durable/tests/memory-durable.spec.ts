import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import RpMemoryBasic from '@dsh-rp/memory-basic'
import { afterEach, describe, expect, it } from 'vitest'
import * as MemoryDurable from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function createRuntime(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(RpMemoryBasic)
  await ctx.plugin(MemoryDurable)
  return ctx
}

describe('@dsh-rp/memory-durable', () => {
  it('rehydrates durable memories and their persisted vector index after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-memory-'))
    roots.push(root)
    const scope = { kind: 'conversation' as const, id: 'durable' }
    const event = {
      schemaVersion: 1 as const,
      id: 'observatory',
      owner: 'hero',
      content: 'The red key opens the observatory.',
      salience: 0.9,
      createdAt: 1,
      tags: ['key'],
    }

    const first = await createRuntime(root)
    first.rpMemory.append(scope, event)
    await first.rpMemory.appendDurable(scope, event)
    expect(first.rpMemory.listStores().map(item => item.id)).toEqual(['storage-domain-v1'])
    await first.fiber.dispose()

    const second = await createRuntime(root)
    expect(second.rpMemory.search(scope, { text: 'observatory' })).toEqual([])
    await second.rpMemory.hydrate(scope)
    expect(second.rpMemory.search(scope, { text: 'red observatory key' }).map(hit => hit.event.id))
      .toEqual(['observatory'])
    expect(second.rpMemory.listRetrievers().map(item => item.id)).toEqual([
      'durable-fnv-vector-256', 'hash-vector-256', 'lexical',
    ].filter(id => id !== 'hash-vector-256'))
    await expect(second.rpMemory.appendDurable(scope, { ...event, content: 'conflict' }))
      .rejects.toThrow('different content')
    await second.fiber.dispose()
  })

  it('durably releases one complete scope without touching another', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-memory-release-'))
    roots.push(root)
    const ctx = await createRuntime(root)
    const left = { kind: 'conversation' as const, id: 'left' }
    const right = { kind: 'conversation' as const, id: 'right' }
    const event = { schemaVersion: 1 as const, id: 'same', owner: 'hero', content: 'fact', salience: 1, createdAt: 1 }
    await ctx.rpMemory.appendDurable(left, event)
    await ctx.rpMemory.appendDurable(right, event)
    await expect(ctx.rpMemory.releaseDurable(left)).resolves.toBe(true)
    expect(ctx.rpMemory.search(left, { text: 'fact' })).toEqual([])
    expect(ctx.rpMemory.search(right, { text: 'fact' })).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
