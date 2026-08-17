import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpStateRuntime from '../src/index.ts'

describe('@dsh-rp/state', () => {
  it('applies a patch atomically and rejects stale revisions', async () => {
    const ctx = new Context(); await ctx.plugin(RpStateRuntime)
    const scope = { kind: 'conversation' as const, id: 'c1' }
    ctx.rpState.initialize(scope, 'world', { cast: ['A'], mood: 'calm' })
    const changed = ctx.rpState.applyPatch(scope, { owner: 'world', baseRevision: 0, operations: [
      { op: 'test', path: '/mood', value: 'calm' }, { op: 'replace', path: '/mood', value: 'tense' }, { op: 'add', path: '/cast/-', value: 'B' },
    ] })
    expect(changed).toMatchObject({ revision: 1, value: { cast: ['A', 'B'], mood: 'tense' } })
    expect(() => ctx.rpState.applyPatch(scope, { owner: 'world', baseRevision: 0, operations: [] })).toThrow(/revision/u)
  })

  it('does not publish partial mutations when a later operation fails', async () => {
    const ctx = new Context(); await ctx.plugin(RpStateRuntime)
    const scope = { kind: 'scene' as const, id: 's1' }
    ctx.rpState.initialize(scope, 'scene', { value: 1 })
    expect(() => ctx.rpState.applyPatch(scope, { owner: 'scene', baseRevision: 0, operations: [
      { op: 'replace', path: '/value', value: 2 }, { op: 'remove', path: '/missing' },
    ] })).toThrow(/does not exist/u)
    expect(ctx.rpState.read(scope, 'scene')?.value).toEqual({ value: 1 })
  })
})
