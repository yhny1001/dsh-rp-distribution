import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpMemoryBasic from '../src/index.ts'

describe('@dsh-rp/memory-basic', () => {
  it('retrieves deterministic scoped matches and keeps duplicates idempotent', async () => {
    const ctx = new Context()
    await ctx.plugin(RpMemoryBasic)
    const scope = { kind: 'conversation' as const, id: 'c' }
    const event = {
      schemaVersion: 1 as const,
      id: 'm1',
      owner: 'hero',
      content: 'The red key opens the observatory.',
      salience: 0.9,
      createdAt: 1,
    }
    expect(ctx.rpMemory.append(scope, event)).toBe(ctx.rpMemory.append(scope, event))
    ctx.rpMemory.append(scope, {
      schemaVersion: 1,
      id: 'm2',
      owner: 'hero',
      content: 'Rain fell yesterday.',
      salience: 0.2,
      createdAt: 2,
    })
    expect(ctx.rpMemory.search(scope, { text: 'red observatory key' }).map(hit => hit.event.id)).toEqual(['m1'])
    expect(ctx.rpMemory.listRetrievers()).toEqual([{ id: 'lexical', version: '1.0.0', title: 'Lexical overlap', priority: 0 }])
  })

  it('searches a replayed Event Log projection without mutating process-local memory', async () => {
    const ctx = new Context()
    await ctx.plugin(RpMemoryBasic)
    const scope = { kind: 'conversation' as const, id: 'replayed' }
    const event = {
      schemaVersion: 1 as const,
      id: 'journal-memory',
      owner: 'hero',
      content: 'The observatory key is hidden under the red book.',
      salience: 0.8,
      createdAt: 10,
    }
    expect(ctx.rpMemory.searchEvents(scope, [event], { text: 'red observatory key' })).toMatchObject([
      { event: { id: 'journal-memory' } },
    ])
    expect(ctx.rpMemory.search(scope, { text: 'red observatory key' })).toEqual([])
  })
})
