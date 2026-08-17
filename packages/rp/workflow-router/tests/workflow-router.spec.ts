import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpWorkflowRouter, { createDeterministicBackend } from '../src/index.ts'

describe('RP workflow router', () => {
  it('routes a bounded deterministic expression', async () => {
    const ctx = new Context(); const fiber = await ctx.plugin(RpWorkflowRouter)
    const run = ctx.rpWorkflowRouter.start({ kind: 'workflow', payload: { input: { name: 'Mira' }, expression: { op: 'object', entries: { actor: { op: 'get', from: { op: 'input' }, key: 'name' } } } } })
    await expect(run.result).resolves.toMatchObject({ status: 'completed', value: { actor: 'Mira' } })
    await fiber.dispose()
  })

  it('seeds the fallback through the default-export service path and keeps registration reversible', async () => {
    const ctx = new Context(); const router = new RpWorkflowRouter(ctx)
    const release = router.register({ ...createDeterministicBackend('high'), priority: 10 })
    router.register(createDeterministicBackend('low'))
    expect(router.list().map(item => item.id)).toEqual(['high', 'deterministic', 'low'])
    release(); expect(router.list().map(item => item.id)).toEqual(['deterministic', 'low'])
    await ctx.fiber.dispose()
  })

  it('never routes an L1 backend without matching effective authority', async () => {
    const ctx = new Context(); const router = new RpWorkflowRouter(ctx)
    router.register({
      id: 'l1', kind: 'wasm', trust: 'L1', priority: 100, kinds: ['workflow'],
      execute: () => Promise.resolve('unsafe-default'),
    })
    const fallback = router.start({ kind: 'workflow', payload: { expression: 42 } })
    await expect(fallback.result).resolves.toMatchObject({ status: 'completed', value: 42 })
    expect(() => router.start({ kind: 'workflow', backend: 'l1', payload: null }))
      .toThrow(expect.objectContaining({ code: 'TRUST_DENIED' }))
    const authorized = router.start({
      kind: 'workflow', backend: 'l1', payload: null,
      authority: {
        permissions: [], trust: 'L1', budget: {}, networkDomains: [], fileRoots: [], layers: ['test'],
      },
    })
    await expect(authorized.result).resolves.toMatchObject({ status: 'completed', value: 'unsafe-default' })
    await ctx.fiber.dispose()
  })
})
