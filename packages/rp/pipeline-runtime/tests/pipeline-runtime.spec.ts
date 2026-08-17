import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RpPipelineId } from '@dsh-rp/contracts'
import RpPipelineRuntime, { RpPipelineError } from '../src/index.ts'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import { RpCapabilityId } from '@dsh-rp/contracts'

const scope = { kind: 'turn' as const, id: 'turn-1' }

describe('@dsh-rp/pipeline-runtime', () => {
  it('runs parallel roots before a dependent join and captures a stable snapshot', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(RpPipelineRuntime)
    const id = RpPipelineId('turn.default')
    const dispose = ctx.rpPipelines.register({
      id, kind: 'turn', version: '1', description: 'Default turn', trust: 'L0', permissions: [],
      stages: [
        { id: 'context', run: async () => ({ context: 'ready' }) },
        { id: 'memory', run: async () => ({ memory: 'ready' }) },
        {
          id: 'actor', after: ['context', 'memory'],
          run: async (frame) => {
            const context = frame.values.context
            const memory = frame.values.memory
            if (typeof context !== 'string' || typeof memory !== 'string') throw new Error('expected string stage values')
            return { reply: `${context}:${memory}` }
          },
        },
      ],
    })
    const first = ctx.rpPipelines.snapshot(id)
    const result = await ctx.rpPipelines.run(id, { scope, input: { message: 'hello' } })
    expect(result.snapshot.hash).toBe(first.hash)
    expect(result.snapshot.levels).toEqual([['context', 'memory'], ['actor']])
    expect(result.frame.values).toEqual({ context: 'ready', memory: 'ready', reply: 'ready:ready' })
    dispose()
    expect(ctx.rpPipelines.list()).toHaveLength(0)
    await fiber.dispose()
  })

  it('retries failures and retains non-fatal stage failures', async () => {
    const ctx = new Context()
    await ctx.plugin(RpPipelineRuntime)
    const id = RpPipelineId('workflow.retry')
    let attempt = 0
    ctx.rpPipelines.register({
      id, kind: 'workflow', version: '1', description: 'Retry workflow', trust: 'L0', permissions: [],
      stages: [
        { id: 'optional', failure: 'continue', run: async () => { throw new Error('optional failed') } },
        {
          id: 'retry', retries: 1, run: async () => {
            attempt += 1
            if (attempt === 1) throw new Error('retry me')
            return { recovered: true }
          },
        },
      ],
    })
    const result = await ctx.rpPipelines.run(id, { scope, input: null })
    expect(attempt).toBe(2)
    expect(result.failures).toEqual([{
      stageId: 'optional',
      message: 'RP pipeline stage "optional" failed: optional failed',
    }])
    expect(result.frame.values).toEqual({ recovered: true })
  })

  it('rejects missing dependencies, cycles, output conflicts, and non-lossless JSON', async () => {
    const ctx = new Context()
    await ctx.plugin(RpPipelineRuntime)
    expect(() => ctx.rpPipelines.register({
      id: RpPipelineId('missing'), kind: 'turn', version: '1', description: 'Missing', trust: 'L0', permissions: [],
      stages: [{ id: 'a', after: ['b'], run: async () => ({}) }],
    })).toThrow(/missing dependency/)
    expect(() => ctx.rpPipelines.register({
      id: RpPipelineId('cycle'), kind: 'turn', version: '1', description: 'Cycle', trust: 'L0', permissions: [],
      stages: [
        { id: 'a', after: ['b'], run: async () => ({}) },
        { id: 'b', after: ['a'], run: async () => ({}) },
      ],
    })).toThrow(/dependency cycle/)
    const invokeA = RpPipelineId('invoke-cycle-a')
    const invokeB = RpPipelineId('invoke-cycle-b')
    ctx.rpPipelines.register({
      id: invokeA, kind: 'workflow', version: '1', description: 'Invoke A', trust: 'L0', permissions: [],
      stages: [{ id: 'b', operation: { kind: 'invoke-pipeline', pipelineId: invokeB } }],
    })
    ctx.rpPipelines.register({
      id: invokeB, kind: 'workflow', version: '1', description: 'Invoke B', trust: 'L0', permissions: [],
      stages: [{ id: 'a', operation: { kind: 'invoke-pipeline', pipelineId: invokeA } }],
    })
    expect(() => ctx.rpPipelines.capture(invokeA)).toThrow(/invocation cycle/)
    const conflict = RpPipelineId('conflict')
    ctx.rpPipelines.register({
      id: conflict, kind: 'turn', version: '1', description: 'Conflict', trust: 'L0', permissions: [],
      stages: [
        { id: 'a', run: async () => ({ same: 1 }) },
        { id: 'b', run: async () => ({ same: 2 }) },
      ],
    })
    await expect(ctx.rpPipelines.run(conflict, { scope, input: null })).rejects.toMatchObject({ code: 'OUTPUT_CONFLICT' })
    const invalid = RpPipelineId('invalid-json')
    ctx.rpPipelines.register({
      id: invalid, kind: 'turn', version: '1', description: 'Invalid JSON', trust: 'L0', permissions: [],
      stages: [{ id: 'a', run: async () => ({ bad: Number.NaN }) }],
    })
    await expect(ctx.rpPipelines.run(invalid, { scope, input: null })).rejects.toBeInstanceOf(RpPipelineError)
  })

  it('routes declarative stages through the original capability registry', async () => {
    const ctx = new Context()
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPipelineRuntime)
    ctx.rpCapabilities.register({
      descriptor: { id: RpCapabilityId('fixture.echo'), kind: 'tool', version: '1', title: 'Echo', description: 'Echo input.', trust: 'L0', scopes: ['turn'] },
      invoke: async request => request.input,
    })
    const id = RpPipelineId('declarative')
    ctx.rpPipelines.register({ id, kind: 'turn', version: '1', description: 'Declarative', trust: 'L0', permissions: [], stages: [
      { id: 'echo', operation: { kind: 'invoke-capability', capabilityId: 'fixture.echo' } },
    ] })
    const result = await ctx.rpPipelines.run(id, { scope, input: { message: 'hello' } })
    expect(result.frame.values['stage.echo.result']).toEqual({ message: 'hello' })
  })

  it('freezes nested executable plans across hot replacement and observes every graph', async () => {
    const ctx = new Context()
    await ctx.plugin(RpPipelineRuntime)
    const childId = RpPipelineId('nested.child')
    const rootId = RpPipelineId('nested.root')
    const releaseChild = ctx.rpPipelines.register({
      id: childId, kind: 'workflow', version: '1', description: 'Old child', trust: 'L0', permissions: [],
      stages: [{ id: 'value', run: async () => ({ value: 'old' }) }],
    })
    const releaseRoot = ctx.rpPipelines.register({
      id: rootId, kind: 'turn', version: '1', description: 'Root', trust: 'L0', permissions: [],
      stages: [{ id: 'child', operation: { kind: 'invoke-pipeline', pipelineId: childId } }],
    })
    const oldPlan = ctx.rpPipelines.capture(rootId)
    releaseChild()
    ctx.rpPipelines.register({
      id: childId, kind: 'workflow', version: '2', description: 'New child', trust: 'L0', permissions: [],
      stages: [{ id: 'value', run: async () => ({ value: 'new' }) }],
    })
    const newPlan = ctx.rpPipelines.capture(rootId)
    expect(newPlan.snapshot.hash).not.toBe(oldPlan.snapshot.hash)
    releaseRoot()

    const lifecycle: string[] = []
    const oldResult = await ctx.rpPipelines.runPlan(oldPlan, {
      scope,
      input: null,
      observer: {
        started: (info) => { lifecycle.push(`start:${info.kind}:${info.pipelineId}`) },
        stage: (info, stageId) => { lifecycle.push(`stage:${info.pipelineId}:${stageId}`) },
        completed: (info) => { lifecycle.push(`complete:${info.pipelineId}`) },
        failed: (info) => { lifecycle.push(`failed:${info.pipelineId}`) },
      },
    })
    const newResult = await ctx.rpPipelines.runPlan(newPlan, { scope, input: null })
    expect(oldResult.frame.values['stage.child.result']).toEqual({ value: 'old' })
    expect(newResult.frame.values['stage.child.result']).toEqual({ value: 'new' })
    expect(lifecycle).toEqual([
      'start:turn:nested.root',
      'start:workflow:nested.child',
      'stage:nested.child:value',
      'complete:nested.child',
      'stage:nested.root:child',
      'complete:nested.root',
    ])
    await expect(ctx.rpPipelines.run(rootId, { scope, input: null })).rejects.toMatchObject({ code: 'MISSING' })
  })

  it('fails an admitted run when required Stage observation fails', async () => {
    const ctx = new Context()
    await ctx.plugin(RpPipelineRuntime)
    const id = RpPipelineId('observer-required')
    ctx.rpPipelines.register({
      id, kind: 'sidecar', version: '1', description: 'Observed', trust: 'L0', permissions: [],
      stages: [{ id: 'work', failure: 'continue', run: async () => ({ done: true }) }],
    })
    const terminals: string[] = []
    await expect(ctx.rpPipelines.run(id, {
      scope,
      input: null,
      observer: {
        started() {},
        stage() { throw new Error('audit unavailable') },
        completed() { terminals.push('completed') },
        failed(_info, error) { terminals.push(`failed:${error}`) },
      },
    })).rejects.toThrow('audit unavailable')
    expect(terminals).toEqual(['failed:audit unavailable'])
  })

  it('intersects stage authority with the caller instead of allowing stage escalation', async () => {
    const ctx = new Context()
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPipelineRuntime)
    ctx.rpCapabilities.register({
      descriptor: {
        id: RpCapabilityId('fixture.script'), kind: 'pipeline', version: '1', title: 'Script',
        description: 'L1 script.', trust: 'L1', scopes: ['turn'], permissions: ['script.execute'],
      },
      invoke: async request => request.effectiveAuthority.trust,
    })
    const id = RpPipelineId('authority-intersection')
    ctx.rpPipelines.register({
      id, kind: 'turn', version: '1', description: 'Authority intersection', trust: 'L0', permissions: [], stages: [{
        id: 'script',
        operation: {
          kind: 'invoke-capability', capabilityId: 'fixture.script',
          grantedPermissions: ['script.execute'], grantedTrust: 'L1',
        },
      }],
    })
    await expect(ctx.rpPipelines.run(id, {
      scope, input: null,
    })).resolves.toMatchObject({ frame: { values: { 'stage.script.result': 'L1' } } })
    await expect(ctx.rpPipelines.run(id, {
      scope, input: null, grantedPermissions: [], grantedTrust: 'L0',
    })).rejects.toMatchObject({ code: 'STAGE_FAILED' })
    await expect(ctx.rpPipelines.run(id, {
      scope, input: null, grantedPermissions: ['script.execute'], grantedTrust: 'L1',
    })).resolves.toMatchObject({ frame: { values: { 'stage.script.result': 'L1' } } })
  })

  it('enforces graph trust and permissions for constrained callers and hashes authority metadata', async () => {
    const ctx = new Context()
    await ctx.plugin(RpPipelineRuntime)
    const id = RpPipelineId('native-graph')
    ctx.rpPipelines.register({
      id, kind: 'workflow', version: '1', description: 'Native graph',
      trust: 'L2', permissions: ['rp.pipeline.execute'],
      stages: [{ id: 'native', run: async () => ({ ok: true }) }],
    })
    const snapshot = ctx.rpPipelines.snapshot(id)
    expect(snapshot).toMatchObject({ trust: 'L2', permissions: ['rp.pipeline.execute'] })
    await expect(ctx.rpPipelines.run(id, {
      scope, input: null, grantedTrust: 'L1', grantedPermissions: ['rp.pipeline.execute'],
    })).rejects.toMatchObject({ code: 'AUTHORITY_DENIED' })
    await expect(ctx.rpPipelines.run(id, {
      scope, input: null, grantedTrust: 'L2', grantedPermissions: [],
    })).rejects.toMatchObject({ code: 'AUTHORITY_DENIED' })
    await expect(ctx.rpPipelines.run(id, {
      scope, input: null, grantedTrust: 'L2', grantedPermissions: ['rp.pipeline.execute'],
    })).resolves.toMatchObject({ frame: { values: { ok: true } } })
  })
})
