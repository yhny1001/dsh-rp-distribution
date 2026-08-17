import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { JobId } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import { RpPipelineId } from '@dsh-rp/contracts'
import RpJournal from '@dsh-rp/journal'
import RpPipelineRuntime from '@dsh-rp/pipeline-runtime'
import RpSidecarJobs, { sidecarCapabilityId } from '../src/index.ts'

function stubAgent(ctx: Context, id = 'owner'): Agent {
  const session = Session.create(SessionId(id))
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted() {}, discarded() {}, claimed() {} }),
    status: 'idle',
    ctx,
    send() {},
    followup() {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject() {},
    cancel() {},
    runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) =>
      await task(new AbortController().signal),
    whenIdle: async () => {},
  }
}

async function bench(run: (signal: AbortSignal) => Promise<Record<string, true>>) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(RpCapabilityCatalog)
  await ctx.plugin(RpPipelineRuntime)
  await ctx.plugin(RpJournal)
  ctx.jobs.attachController('sidecar-test')
  const pipelineId = RpPipelineId('rp.sidecar.test')
  const releasePipeline = ctx.rpPipelines.register({
    id: pipelineId,
    kind: 'sidecar',
    version: '1.0.0',
    description: 'Test Sidecar',
    trust: 'L2',
    permissions: ['rp.pipeline.execute'],
    stages: [{
      id: 'work',
      async run(_frame, stage) { return await run(stage.signal) },
    }],
  })
  const fiber = await ctx.plugin(RpSidecarJobs, { disposeGraceMs: 1_000 })
  const owner = stubAgent(ctx)
  ctx.agents.register(owner)
  return { ctx, owner, pipelineId, releasePipeline, fiber }
}

async function start(test: Awaited<ReturnType<typeof bench>>) {
  return await test.ctx.agents.withInitiator(test.owner, async () => await test.ctx.rpCapabilities.invoke(
    sidecarCapabilityId(test.pipelineId),
    {
      scope: { kind: 'agent', id: String(test.owner.id) },
      input: { turnId: 'turn-sidecar', text: 'maintain world' },
      grantedPermissions: ['rp.pipeline.execute', 'rp.sidecar.start'],
      grantedTrust: 'L2',
    },
  )) as Record<string, string | number>
}

describe('@dsh-rp/sidecar-jobs', () => {
  it('returns immediately, completes through Harness Jobs, and journals the frozen graph', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const test = await bench(async () => {
      await gate
      return { 'sidecar.done': true }
    })

    const accepted = await start(test)
    const jobId = JobId(String(accepted.jobId))
    expect(accepted).toMatchObject({
      schemaVersion: 1,
      status: 'accepted',
      pipelineId: 'rp.sidecar.test',
      turnId: 'turn-sidecar',
    })
    expect(test.ctx.jobs.get(jobId, test.owner)).toMatchObject({ kind: 'rp-sidecar', status: 'running' })
    expect(test.ctx.rpSidecars.listActive(test.owner)).toEqual([jobId])

    release()
    await expect(test.ctx.jobs.wait(jobId, 1_000, test.owner)).resolves.toMatchObject({ status: 'completed' })
    expect(test.ctx.jobs.read(jobId, test.owner).text).toContain('"sidecar.done":true')
    expect(test.owner.session.events.map(event => event.type)).toEqual([
      'rp/pipeline-started', 'rp/pipeline-stage', 'rp/pipeline-completed',
    ])
    expect(test.owner.session.events[0]?.data).toMatchObject({
      turnId: 'turn-sidecar', pipelineId: 'rp.sidecar.test', kind: 'sidecar',
    })
    expect(test.ctx.rpSidecars.listActive(test.owner)).toEqual([])
  })

  it('routes Job cancellation into the Pipeline and records one failed terminal fact', async () => {
    const test = await bench(async signal => await new Promise<Record<string, true>>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('stage observed cancellation')) }, { once: true })
    }))
    const accepted = await start(test)
    const jobId = JobId(String(accepted.jobId))

    expect(test.ctx.jobs.kill(jobId, test.owner, 'no longer needed')).toBe('requested')
    await expect(test.ctx.jobs.wait(jobId, 1_000, test.owner)).resolves.toMatchObject({ status: 'killed' })
    expect(test.owner.session.events.map(event => event.type)).toEqual([
      'rp/pipeline-started', 'rp/pipeline-failed',
    ])
  })

  it('requires the Sidecar start permission before creating a Job', async () => {
    const test = await bench(async () => ({ 'sidecar.done': true }))
    await expect(test.ctx.agents.withInitiator(test.owner, async () => await test.ctx.rpCapabilities.invoke(
      sidecarCapabilityId(test.pipelineId),
      {
        scope: { kind: 'agent', id: String(test.owner.id) }, input: null,
        grantedPermissions: ['rp.pipeline.execute'], grantedTrust: 'L2',
      },
    ))).rejects.toMatchObject({ code: 'PERMISSION' })
    expect(test.ctx.jobs.list(test.owner)).toEqual([])
  })

  it('retracts only the capability whose Sidecar Pipeline leaves the live registry', async () => {
    const test = await bench(async () => ({ 'sidecar.done': true }))
    expect(test.ctx.rpCapabilities.get(sidecarCapabilityId(test.pipelineId))).toBeDefined()

    test.releasePipeline()
    expect(test.ctx.rpCapabilities.get(sidecarCapabilityId(test.pipelineId))).toBeUndefined()
  })

  it('removes its capabilities and cancels owned work on plugin unload', async () => {
    const test = await bench(async signal => await new Promise<Record<string, true>>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('unloaded')) }, { once: true })
    }))
    const accepted = await start(test)
    const jobId = JobId(String(accepted.jobId))

    await test.fiber.dispose()
    expect(test.ctx.rpCapabilities.get(sidecarCapabilityId(test.pipelineId))).toBeUndefined()
    await expect(test.ctx.jobs.wait(jobId, 1_000, test.owner)).resolves.toMatchObject({ status: 'killed' })
  })
})
