import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpMemoryBasic from '@dsh-rp/memory-basic'
import * as MemoryVector from '../src/index.ts'

describe('@dsh-rp/memory-vector', () => {
  it('selects deterministic vectors and releases the Provider with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(RpMemoryBasic)
    const fiber = await ctx.plugin(MemoryVector)
    const scope = { kind: 'conversation' as const, id: 'vector' }
    ctx.rpMemory.append(scope, { schemaVersion: 1, id: 'observatory', owner: 'hero', content: 'red key observatory', salience: 0.9, createdAt: 1 })
    ctx.rpMemory.append(scope, { schemaVersion: 1, id: 'rain', owner: 'hero', content: 'rain on the old road', salience: 0.2, createdAt: 2 })
    expect(ctx.rpMemory.listRetrievers().map(item => item.id)).toEqual(['hash-vector-256', 'lexical'])
    expect(ctx.rpMemory.search(scope, { text: 'observatory key' }).map(hit => hit.event.id)[0]).toBe('observatory')
    await fiber.dispose()
    expect(ctx.rpMemory.listRetrievers().map(item => item.id)).toEqual(['lexical'])
  })
})
