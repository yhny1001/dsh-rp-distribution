/** Harness Subagent Provider for provider-neutral RP Agent roles. @module @dsh-rp/agent-provider-harness */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentRun, SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import type {
  RpAgentProvider,
  RpAgentProviderRequest,
  RpAgentProviderResult,
} from '@dsh-rp/agent-runtime'
import type { JsonObject, JsonValue } from '@dsh-rp/contracts'
import { RpTurnId } from '@dsh-rp/contracts'
import type { RpAgentRecord } from '@dsh-rp/journal'
import type {} from '@dsh-rp/journal'

/** Deployment-owned Harness child route and resource ceilings. */
export interface Config {
  /** RP Agent Provider identity registered in `ctx.rpAgents`. */
  readonly providerId?: string
  /** Deterministic Harness Subagent Provider preference order. */
  readonly subagentProviders?: string[]
  /** Routing priority among compatible RP Agent Providers. */
  readonly priority?: number
  /** Absolute Harness delegation-depth ceiling. */
  readonly maxDepth?: number
  /** Timeout used when no tighter effective capability budget exists. */
  readonly defaultTimeoutMs?: number
  /** Deployment ceiling applied even when a role requests a larger timeout. */
  readonly maxTimeoutMs?: number
  /** Optional LLM Provider route for every delegated role. */
  readonly modelProvider?: string
  /** Optional LLM model id for every delegated role. */
  readonly model?: string
}

/** Strict loader schema with bounded defaults and no hidden remote fallback. */
export const Config: z<Config> = z.object({
  providerId: z.string().default('harness-subagent'),
  subagentProviders: z.array(z.string()).default(['fork', 'spawn']),
  priority: z.number().step(1).default(100),
  maxDepth: z.number().step(1).min(0).max(32).default(4),
  defaultTimeoutMs: z.number().step(1).min(1).max(300_000).default(60_000),
  maxTimeoutMs: z.number().step(1).min(1).max(300_000).default(300_000),
  modelProvider: z.string(),
  model: z.string(),
})

/** Stable Harness Agent Provider failure. */
export class RpHarnessAgentError extends Error {
  constructor(
    message: string,
    readonly code: 'CONFIG' | 'NO_INITIATOR' | 'NO_TRANSPORT' | 'CANCELLED' | 'CHILD' | 'OUTPUT',
  ) {
    super(message)
    this.name = 'RpHarnessAgentError'
  }
}

/**
 * Build a replaceable Provider without publishing it.
 * @param ctx - Harness Agent, Subagent, and RP Journal services.
 * @param config - Provider order, model route, depth, and timeout ceilings.
 * @returns Provider suitable for `ctx.rpAgents.registerProvider()`.
 */
export function createHarnessAgentProvider(ctx: Context, config: Config = {}): RpAgentProvider {
  const resolved = resolveConfig(config)
  return Object.freeze({
    id: resolved.providerId,
    priority: resolved.priority,
    supports: () => true,
    run: async (request: RpAgentProviderRequest) => await runHarnessAgent(ctx, resolved, request),
  })
}

async function runHarnessAgent(
  ctx: Context,
  config: ResolvedConfig,
  request: RpAgentProviderRequest,
): Promise<RpAgentProviderResult> {
  let parent
  try { parent = ctx.agents.requireInitiator() }
  catch (error: unknown) {
    throw new RpHarnessAgentError(`RP Agent delegation requires an active Harness Agent: ${renderError(error)}`, 'NO_INITIATOR')
  }
  const transport = selectTransport(ctx, config, request)
  const turnId = invocationTurnId(request)
  const linked = linkedSignal(request, config)
  const childOptions = agentOptions(config, request)
  let child: SubagentRun | undefined
  let terminalRecorded = false
  try {
    child = await ctx.subagents.start(transport, {
      label: `rp:${request.role.id}`,
      prompt: promptFor(request),
      parent,
      signal: linked.signal,
      maxDepth: config.maxDepth,
      persona: personaFor(request),
      ...(childOptions === undefined ? {} : { agentOptions: childOptions }),
    })
    const childId = String(child.id)
    appendAgent(ctx, parent.session, 'rp/agent-started', {
      turnId, agentId: childId, role: request.role.id, operation: 'started',
      parentAgentId: String(parent.id),
      detail: { provider: config.providerId, transport, input: request.invocation.input },
    })
    appendAgent(ctx, parent.session, 'rp/agent-delegated', {
      turnId, agentId: childId, role: request.role.id, operation: 'delegated',
      parentAgentId: String(parent.id), detail: { provider: config.providerId, transport },
    })
    const result = await child.result
    if (result.stopReason !== 'completed') {
      terminalRecorded = true
      appendInterrupted(ctx, parent.session, turnId, childId, request.role.id, parent.id, config.providerId, transport, result.stopReason)
      throw childFailure(childId, result.stopReason)
    }
    const value = resultValue(childId, request.role.id, transport, result.stopReason, result.output, result.structured)
    terminalRecorded = true
    appendAgent(ctx, parent.session, 'rp/agent-completed', {
      turnId, agentId: childId, role: request.role.id, operation: 'completed',
      parentAgentId: String(parent.id),
      detail: { provider: config.providerId, transport, stopReason: result.stopReason, output: value },
    })
    return Object.freeze({ value, agentId: childId, transport })
  } catch (error: unknown) {
    if (!terminalRecorded) {
      appendInterrupted(
        ctx, parent.session, turnId, child === undefined ? request.runId : String(child.id), request.role.id, parent.id,
        config.providerId, transport, linked.signal.aborted ? 'aborted' : 'error',
      )
    }
    if (error instanceof RpHarnessAgentError) throw error
    throw new RpHarnessAgentError(renderError(error), linked.signal.aborted ? 'CANCELLED' : 'CHILD')
  } finally {
    linked.dispose()
    if (child !== undefined) await child.dispose()
  }
}

function selectTransport(ctx: Context, config: ResolvedConfig, request: RpAgentProviderRequest): string {
  for (const name of config.subagentProviders) {
    const provider = ctx.subagents.getProvider(name)
    if (provider === undefined || !provider.capabilities.depthLimit) continue
    if (request.role.instructions !== '' && !provider.capabilities.persona) continue
    return name
  }
  throw new RpHarnessAgentError(
    `No configured Harness Subagent Provider can execute role ${JSON.stringify(request.role.id)}; checked ${config.subagentProviders.join(', ')}`,
    'NO_TRANSPORT',
  )
}

function promptFor(request: RpAgentProviderRequest): ContentBlock[] {
  const payload = JSON.stringify({
    role: request.role.id,
    scope: request.invocation.scope,
    capabilityKinds: request.role.capabilityKinds ?? [],
    input: request.invocation.input,
  })
  return [...mediaBlocks(request), {
    type: 'text',
    text: `Execute this RP role request. Return the requested result, not a plan for another agent.\n\n${payload}`,
  }]
}

function mediaBlocks(request: RpAgentProviderRequest): ContentBlock[] {
  const invocation = request.invocation.input
  if (!isJsonObject(invocation) || invocation.content === undefined) return []
  if (!Array.isArray(invocation.content)) {
    throw new RpHarnessAgentError('RP Agent media content must be an array', 'OUTPUT')
  }
  return invocation.content.map((value): ContentBlock => {
    if (!isJsonObject(value) || value.type !== 'image' || !isJsonObject(value.attachment)) {
      throw new RpHarnessAgentError('RP Agent media content contains an unknown block', 'OUTPUT')
    }
    const attachment = value.attachment
    if (typeof attachment.attachmentId !== 'string' || attachment.attachmentId.trim() === ''
      || typeof attachment.mediaType !== 'string' || !isImageMediaType(attachment.mediaType)
      || !isPositiveInteger(attachment.bytes) || !isPositiveInteger(attachment.width)
      || !isPositiveInteger(attachment.height)
      || attachment.name !== undefined && (typeof attachment.name !== 'string' || attachment.name.trim() === '')) {
      throw new RpHarnessAgentError('RP Agent media content contains an invalid image reference', 'OUTPUT')
    }
    return {
      type: 'image',
      attachment: {
        attachmentId: AttachmentId(attachment.attachmentId),
        mediaType: attachment.mediaType,
        bytes: attachment.bytes,
        width: attachment.width,
        height: attachment.height,
        ...(typeof attachment.name === 'string' ? { name: attachment.name } : {}),
      },
    }
  })
}

function isImageMediaType(value: string): value is ImageMediaType {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function isPositiveInteger(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function personaFor(request: RpAgentProviderRequest): string {
  const capabilities = request.role.capabilityKinds?.length === 0 || request.role.capabilityKinds === undefined
    ? ''
    : `\n\nRole capability families: ${request.role.capabilityKinds.join(', ')}. Runtime policy remains authoritative.`
  return `${request.role.instructions}${capabilities}`
}

function agentOptions(config: ResolvedConfig, request: RpAgentProviderRequest): AgentOptions | undefined {
  const maxTokens = request.invocation.effectiveBudget.maxTokens
  const options: AgentOptions = {
    ...(config.modelProvider === undefined ? {} : { provider: config.modelProvider }),
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(maxTokens === undefined ? {} : { maxTokens: Math.max(1, Math.floor(maxTokens)) }),
  }
  return Object.keys(options).length === 0 ? undefined : options
}

function invocationTurnId(request: RpAgentProviderRequest): ReturnType<typeof RpTurnId> {
  const input = request.invocation.input
  if (isJsonObject(input) && typeof input.turnId === 'string' && input.turnId.trim() !== '') return RpTurnId(input.turnId)
  return RpTurnId(`rp-agent:${request.runId}`)
}

function resultValue(
  agentId: string,
  role: string,
  transport: string,
  stopReason: SubagentStopReason,
  output: readonly ContentBlock[],
  structured: unknown,
): JsonValue {
  const candidate = structured === undefined
    ? { schemaVersion: 1, agentId, role, transport, stopReason, output }
    : { schemaVersion: 1, agentId, role, transport, stopReason, output, structured }
  try {
    const serialized = JSON.stringify(candidate)
    return JSON.parse(serialized) as JsonValue
  } catch (error: unknown) {
    throw new RpHarnessAgentError(`Harness Agent result is not finite JSON: ${renderError(error)}`, 'OUTPUT')
  }
}

function appendInterrupted(
  ctx: Context,
  session: Parameters<typeof appendAgent>[1],
  turnId: ReturnType<typeof RpTurnId>,
  agentId: string,
  role: string,
  parentAgentId: string,
  provider: string,
  transport: string,
  stopReason: string,
): void {
  appendAgent(ctx, session, 'rp/agent-interrupted', {
    turnId, agentId, role, operation: 'interrupted', parentAgentId,
    detail: { provider, transport, stopReason },
  })
}

function appendAgent(
  ctx: Context,
  session: Parameters<Context['rpJournal']['append']>[0],
  type: 'rp/agent-started' | 'rp/agent-delegated' | 'rp/agent-completed' | 'rp/agent-interrupted',
  record: RpAgentRecord,
): void {
  ctx.rpJournal.append(session, type, record)
}

function childFailure(childId: string, stopReason: SubagentStopReason): RpHarnessAgentError {
  return new RpHarnessAgentError(
    `Harness child Agent ${JSON.stringify(childId)} ended with ${stopReason}`,
    stopReason === 'aborted' ? 'CANCELLED' : 'CHILD',
  )
}

interface LinkedSignal {
  readonly signal: AbortSignal
  dispose(): void
}

function linkedSignal(request: RpAgentProviderRequest, config: ResolvedConfig): LinkedSignal {
  const controller = new AbortController()
  const source = request.invocation.signal
  const forward = (): void => { controller.abort(source?.reason) }
  if (source?.aborted === true) controller.abort(source.reason)
  else source?.addEventListener('abort', forward, { once: true })
  const requested = request.invocation.effectiveBudget.timeoutMs ?? config.defaultTimeoutMs
  const timeoutMs = Math.min(requested, config.maxTimeoutMs)
  const timer = setTimeout(() => { controller.abort('rp-agent-timeout') }, timeoutMs)
  return Object.freeze({
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      source?.removeEventListener('abort', forward)
    },
  })
}

interface ResolvedConfig {
  readonly providerId: string
  readonly subagentProviders: readonly string[]
  readonly priority: number
  readonly maxDepth: number
  readonly defaultTimeoutMs: number
  readonly maxTimeoutMs: number
  readonly modelProvider?: string
  readonly model?: string
}

function resolveConfig(config: Config): ResolvedConfig {
  const resolved = {
    providerId: config.providerId ?? 'harness-subagent',
    subagentProviders: Object.freeze(config.subagentProviders ?? ['fork', 'spawn']),
    priority: config.priority ?? 100,
    maxDepth: config.maxDepth ?? 4,
    defaultTimeoutMs: config.defaultTimeoutMs ?? 60_000,
    maxTimeoutMs: config.maxTimeoutMs ?? 300_000,
    ...(config.modelProvider === undefined ? {} : { modelProvider: config.modelProvider }),
    ...(config.model === undefined ? {} : { model: config.model }),
  }
  if (resolved.providerId.trim() === '' || resolved.providerId !== resolved.providerId.trim()) {
    throw new RpHarnessAgentError('Harness RP Agent Provider id must be normalized and non-empty', 'CONFIG')
  }
  if (resolved.subagentProviders.length === 0 || new Set(resolved.subagentProviders).size !== resolved.subagentProviders.length
    || resolved.subagentProviders.some(value => value.trim() === '' || value !== value.trim())) {
    throw new RpHarnessAgentError('Harness Subagent Provider order must contain unique normalized ids', 'CONFIG')
  }
  for (const [key, value] of Object.entries({
    priority: resolved.priority,
    maxDepth: resolved.maxDepth,
    defaultTimeoutMs: resolved.defaultTimeoutMs,
    maxTimeoutMs: resolved.maxTimeoutMs,
  })) {
    if (!Number.isSafeInteger(value) || (key === 'maxDepth' ? value < 0 : value <= 0)) {
      throw new RpHarnessAgentError(`Harness RP Agent ${key} is invalid`, 'CONFIG')
    }
  }
  if (resolved.defaultTimeoutMs > resolved.maxTimeoutMs) {
    throw new RpHarnessAgentError('Harness RP Agent defaultTimeoutMs exceeds maxTimeoutMs', 'CONFIG')
  }
  return Object.freeze(resolved)
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function renderError(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error) }
  catch { return '[unrenderable thrown value]' }
}

/** Cordis plugin name. */
export const name = 'rp-agent-provider-harness'
/** Harness and RP registries required for delegation and durable audit. */
export const inject = ['agents', 'subagents', 'rpAgents', 'rpJournal']

/**
 * Register the Harness Provider as one reversible Agent Runtime contribution.
 * @param ctx - Composed Harness context.
 * @param config - Deployment route and ceilings.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.effect(() => ctx.rpAgents.registerProvider(createHarnessAgentProvider(ctx, config)), 'rp-agent-provider-harness')
}
