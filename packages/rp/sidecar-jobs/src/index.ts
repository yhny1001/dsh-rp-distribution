/** Owner-fenced Harness Jobs adapter for asynchronous RP Sidecar Pipelines. @module @dsh-rp/sidecar-jobs */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId } from '@deepseek-ai/dsh-jobs'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type {
  RpCapabilityAuthorityDecision,
  RpCapabilityContribution,
  RpResolvedCapabilityInvocation,
} from '@dsh-rp/capability-catalog'
import {
  RpCapabilityId,
  RpTurnId,
} from '@dsh-rp/contracts'
import type {
  JsonValue,
  RpPipelineId,
  RpScopeRef,
} from '@dsh-rp/contracts'
import type {} from '@dsh-rp/journal'
import { RpPipelineError } from '@dsh-rp/pipeline-runtime'
import type {
  RpPipelineDefinition,
  RpPipelinePlan,
  RpPipelineRunInfo,
  RpPipelineRunObserver,
} from '@dsh-rp/pipeline-runtime'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    'rp-sidecar': 'rp-sidecar'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    rpSidecars: RpSidecarJobs
  }
}

/** Deployment bounds for model-facing output and cooperative plugin unload. */
export interface Config {
  /** UTF-8 byte ceiling carried to the Job controller and applied to retained output. */
  readonly outputLimitBytes?: number
  /** Maximum unload wait for cooperatively cancelled Sidecar Pipelines. */
  readonly disposeGraceMs?: number
}

/** One explicit least-authority asynchronous Sidecar request. */
export interface RpSidecarJobRequest {
  readonly pipelineId: RpPipelineId
  readonly scope: RpScopeRef
  readonly input: JsonValue
  readonly owner: Agent
  readonly authority: RpCapabilityAuthorityDecision
  readonly signal?: AbortSignal
  readonly turnId?: ReturnType<typeof RpTurnId>
}

/** Accepted Job identity and frozen graph correlation returned without awaiting execution. */
export interface RpSidecarJobStart {
  readonly jobId: JobId
  readonly pipelineId: RpPipelineId
  readonly snapshotHash: string
  readonly turnId: ReturnType<typeof RpTurnId>
}

interface ActiveSidecar {
  readonly owner: Agent
  readonly done: Promise<JobOutcome>
}

interface ResolvedConfig {
  readonly outputLimitBytes: number
  readonly disposeGraceMs: number
}

/** Asynchronous Sidecar admission, Job ownership, capability publication, and unload coordinator. */
export class RpSidecarJobs extends Service {
  static inject = ['agents', 'jobs', 'rpCapabilities', 'rpPipelines', 'rpJournal']

  static Config: z<Config> = z.object({
    outputLimitBytes: z.number().step(1).min(1_024).max(1_048_576).default(65_536),
    disposeGraceMs: z.number().step(1).min(1).max(30_000).default(5_000),
  })

  private readonly config: ResolvedConfig
  private readonly active = new Map<JobId, ActiveSidecar>()
  private readonly capabilityDisposers = new Map<RpPipelineId, () => void>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'rpSidecars')
    this.config = resolveConfig(config)
    for (const pipeline of ctx.rpPipelines.list()) this.syncCapability(pipeline.id)
    ctx.on('rp/pipelines-changed', (id) => { this.syncCapability(id) })
    ctx.effect(function* (this: RpSidecarJobs) {
      yield async () => {
        for (const dispose of [...this.capabilityDisposers.values()].reverse()) dispose()
        this.capabilityDisposers.clear()
        await this.cancelAndDrain()
      }
    }.bind(this), 'rpSidecars.cleanup()')
  }

  /**
   * Start one registered Sidecar as an owner-fenced Harness Job.
   * @param request - Frozen target, effective authority, owner, and cancellation source.
   * @returns Accepted Job and graph correlation without awaiting the Pipeline.
   */
  start(request: RpSidecarJobRequest): RpSidecarJobStart {
    const plan = this.requireSidecar(request.pipelineId)
    const turnId = request.turnId ?? RpTurnId(`rp-sidecar:${randomUUID()}`)
    let done: Promise<JobOutcome> | undefined
    const jobId = this.ctx.jobs.start({
      kind: 'rp-sidecar',
      label: `RP sidecar ${request.pipelineId}`,
      outputLimitBytes: this.config.outputLimitBytes,
      owner: request.owner,
      run: () => {
        const linked = linkedController(request.signal)
        done = this.execute(request, plan, turnId, linked.controller)
          .finally(() => { linked.dispose() })
        return {
          cancel: (reason) => { linked.controller.abort(reason ?? 'rp-sidecar-job-cancelled') },
          done,
        }
      },
    })
    if (done === undefined) throw new Error('RP Sidecar Job registry committed without starting its producer')
    const active = Object.freeze({ owner: request.owner, done })
    this.active.set(jobId, active)
    void done.then(() => {
      if (this.active.get(jobId) === active) this.active.delete(jobId)
    })
    return Object.freeze({ jobId, pipelineId: request.pipelineId, snapshotHash: plan.snapshot.hash, turnId })
  }

  /**
   * List active Sidecar Job ids owned by one exact Agent.
   * @param owner - Exact live owner.
   * @returns Deterministically ordered Job ids.
   */
  listActive(owner: Agent): readonly JobId[] {
    return [...this.active.entries()]
      .filter(([, active]) => active.owner === owner)
      .map(([id]) => id)
      .sort((left, right) => String(left).localeCompare(String(right)))
  }

  private requireSidecar(id: RpPipelineId): RpPipelinePlan {
    const plan = this.ctx.rpPipelines.capture(id)
    if (plan.snapshot.kind !== 'sidecar') throw new Error(`RP pipeline ${JSON.stringify(id)} is not a Sidecar`)
    return plan
  }

  private syncCapability(id: RpPipelineId): void {
    this.capabilityDisposers.get(id)?.()
    this.capabilityDisposers.delete(id)
    const pipeline = this.ctx.rpPipelines.list().find(candidate => candidate.id === id)
    if (pipeline?.kind !== 'sidecar') return
    this.capabilityDisposers.set(id, this.ctx.rpCapabilities.register(this.contribution(pipeline)))
  }

  private contribution(pipeline: RpPipelineDefinition): RpCapabilityContribution {
    const permissions = Object.freeze([...new Set([...pipeline.permissions, 'rp.sidecar.start'])].sort())
    return {
      descriptor: {
        id: sidecarCapabilityId(pipeline.id),
        kind: 'pipeline',
        version: pipeline.version,
        title: `Background: ${pipeline.id}`,
        description: `Start RP Sidecar ${pipeline.id} as an owner-fenced asynchronous Harness Job.`,
        trust: pipeline.trust,
        scopes: ['conversation', 'scene', 'turn', 'agent'],
        permissions,
        ...(pipeline.budget === undefined ? {} : { budget: pipeline.budget }),
        tags: ['rp', 'pipeline', 'sidecar', 'async', 'job'],
      },
      invoke: async invocation => this.invokeCapability(pipeline.id, invocation),
    }
  }

  private invokeCapability(pipelineId: RpPipelineId, invocation: RpResolvedCapabilityInvocation): Promise<JsonValue> {
    const owner = this.ctx.agents.requireInitiator()
    const start = this.start({
      pipelineId,
      scope: invocation.scope,
      input: invocation.input,
      owner,
      authority: invocation.effectiveAuthority,
      ...(invocation.signal === undefined ? {} : { signal: invocation.signal }),
      ...turnIdFromInput(invocation.input),
    })
    return Promise.resolve({
      schemaVersion: 1,
      status: 'accepted',
      jobId: String(start.jobId),
      pipelineId: String(start.pipelineId),
      snapshotHash: start.snapshotHash,
      turnId: String(start.turnId),
    })
  }

  private async execute(
    request: RpSidecarJobRequest,
    plan: RpPipelinePlan,
    turnId: ReturnType<typeof RpTurnId>,
    controller: AbortController,
  ): Promise<JobOutcome> {
    try {
      const result = await this.ctx.rpPipelines.runPlan(plan, {
        scope: request.scope,
        input: request.input,
        signal: controller.signal,
        budget: request.authority.budget,
        grantedPermissions: request.authority.permissions,
        grantedTrust: request.authority.trust,
        networkDomains: request.authority.networkDomains,
        fileRoots: request.authority.fileRoots,
        observer: pipelineJournalObserver(this.ctx, request.owner, turnId),
      })
      if (result.snapshot.hash !== plan.snapshot.hash) throw new Error('RP Sidecar Pipeline changed after Job admission')
      return {
        status: 'completed',
        detail: `pipeline ${result.runId}`,
        output: boundedOutput({
          schemaVersion: 1,
          runId: result.runId,
          pipelineId: String(request.pipelineId),
          snapshotHash: result.snapshot.hash,
          values: result.frame.values,
          failures: result.failures,
        }, this.config.outputLimitBytes),
      }
    } catch (error: unknown) {
      const cancelled = controller.signal.aborted
        || (error instanceof RpPipelineError && error.code === 'CANCELLED')
      const diagnostic = renderError(error)
      return { status: cancelled ? 'killed' : 'failed', detail: diagnostic }
    }
  }

  private async cancelAndDrain(): Promise<void> {
    const jobs = [...this.active.entries()]
    const failures: string[] = []
    for (const [id, active] of jobs) {
      try { this.ctx.jobs.kill(id, active.owner, 'RP Sidecar Jobs plugin unloading') }
      catch (error: unknown) { failures.push(`${id}: cancel failed: ${renderError(error)}`) }
    }
    await Promise.all(jobs.map(async ([id, active]) => {
      try { await within(active.done, this.config.disposeGraceMs) }
      catch (error: unknown) { failures.push(`${id}: ${renderError(error)}`) }
    }))
    if (failures.length > 0) throw new Error(`RP Sidecar Job cleanup failed: ${failures.join('; ')}`)
  }
}

function pipelineJournalObserver(
  ctx: Context,
  owner: Agent,
  turnId: ReturnType<typeof RpTurnId>,
): RpPipelineRunObserver {
  const record = (info: RpPipelineRunInfo) => Object.freeze({
    turnId,
    pipelineId: info.pipelineId,
    snapshotHash: info.snapshotHash,
    kind: info.kind,
  })
  return Object.freeze({
    started(info: RpPipelineRunInfo) { ctx.rpJournal.append(owner.session, 'rp/pipeline-started', record(info)) },
    stage(info: RpPipelineRunInfo, stageId: string, outcome: 'completed' | 'continued') {
      ctx.rpJournal.append(owner.session, 'rp/pipeline-stage', { ...record(info), stageId, outcome })
    },
    completed(info: RpPipelineRunInfo) { ctx.rpJournal.append(owner.session, 'rp/pipeline-completed', record(info)) },
    failed(info: RpPipelineRunInfo, error: string) {
      ctx.rpJournal.append(owner.session, 'rp/pipeline-failed', { ...record(info), error })
    },
  })
}

/**
 * Deterministic asynchronous capability id for one Sidecar Pipeline.
 * @param pipelineId - Registered Sidecar id.
 * @returns Unified Catalog capability id.
 */
export function sidecarCapabilityId(pipelineId: RpPipelineId): ReturnType<typeof RpCapabilityId> {
  return RpCapabilityId(`sidecar:${pipelineId}`)
}

function turnIdFromInput(input: JsonValue): { readonly turnId?: ReturnType<typeof RpTurnId> } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {}
  return typeof input.turnId === 'string' && input.turnId.trim() !== ''
    ? { turnId: RpTurnId(input.turnId) }
    : {}
}

function linkedController(source?: AbortSignal): { controller: AbortController; dispose(): void } {
  const controller = new AbortController()
  const forward = (): void => { controller.abort(source?.reason) }
  if (source?.aborted === true) controller.abort(source.reason)
  else source?.addEventListener('abort', forward, { once: true })
  return {
    controller,
    dispose() { source?.removeEventListener('abort', forward) },
  }
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(`did not settle within ${timeoutMs}ms`)) }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function boundedOutput(value: unknown, limit: number): string {
  const text = JSON.stringify(value)
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength <= limit) return text
  const notice = `\n...[RP Sidecar output truncated from ${bytes.byteLength} UTF-8 bytes]`
  const noticeBytes = new TextEncoder().encode(notice).byteLength
  const available = Math.max(0, limit - noticeBytes)
  let end = available
  const decoder = new TextDecoder('utf-8', { fatal: true })
  while (end > 0) {
    try { return decoder.decode(bytes.subarray(0, end)) + notice }
    catch { end -= 1 }
  }
  return notice.slice(0, limit)
}

function resolveConfig(config: Config): ResolvedConfig {
  const outputLimitBytes = config.outputLimitBytes ?? 65_536
  const disposeGraceMs = config.disposeGraceMs ?? 5_000
  if (!Number.isSafeInteger(outputLimitBytes) || outputLimitBytes < 1_024 || outputLimitBytes > 1_048_576) {
    throw new Error('RP Sidecar outputLimitBytes must be a safe integer from 1024 through 1048576')
  }
  if (!Number.isSafeInteger(disposeGraceMs) || disposeGraceMs < 1 || disposeGraceMs > 30_000) {
    throw new Error('RP Sidecar disposeGraceMs must be a safe integer from 1 through 30000')
  }
  return Object.freeze({ outputLimitBytes, disposeGraceMs })
}

function renderError(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error) }
  catch { return '[unrenderable thrown value]' }
}

/** Cordis plugin name. */
export const name = 'rp-sidecar-jobs'

export default RpSidecarJobs
