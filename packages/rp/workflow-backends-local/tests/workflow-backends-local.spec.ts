import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpWorkflowRouter from '@dsh-rp/workflow-router'
import * as LocalBackends from '../src/index.ts'

const payload = {
  expression: {
    op: 'object',
    entries: {
      answer: { op: 'get', from: { op: 'input' }, key: 'answer' },
    },
  },
  input: { answer: 42 },
}

describe('local RP workflow backends', () => {
  it.each([
    LocalBackends.createWorkerThreadBackend(),
    LocalBackends.createIsolatedProcessBackend(),
  ])('executes deterministic payloads through $kind', async (backend) => {
    const controller = new AbortController()
    await expect(backend.execute({ kind: 'workflow', payload }, controller.signal))
      .resolves.toEqual({ answer: 42 })
  })

  it.each([
    LocalBackends.createWorkerThreadBackend(),
    LocalBackends.createIsolatedProcessBackend(),
  ])('rejects an already-cancelled $kind run', async (backend) => {
    const controller = new AbortController()
    controller.abort('test cancellation')
    await expect(backend.execute({ kind: 'sidecar', payload }, controller.signal))
      .rejects.toThrow('test cancellation')
  })

  it.each([
    LocalBackends.createWorkerThreadBackend(),
    LocalBackends.createIsolatedProcessBackend(),
  ])('rejects oversized $kind input before starting an executor', async (backend) => {
    const controller = new AbortController()
    await expect(backend.execute({ kind: 'workflow', payload: 'x'.repeat(4 * 1024 * 1024) }, controller.signal))
      .rejects.toThrow('payload exceeds')
  })

  it('releases both backend registrations with its Cordis plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(RpWorkflowRouter)
    const fiber = await ctx.plugin(LocalBackends)
    expect(ctx.rpWorkflowRouter.list().map(item => item.id)).toEqual([
      'worker-thread-local',
      'isolated-process-local',
      'deterministic',
    ])
    await fiber.dispose()
    expect(ctx.rpWorkflowRouter.list().map(item => item.id)).toEqual(['deterministic'])
    await ctx.fiber.dispose()
  })
})
