/** Provider-neutral RP Agent role registry and invocation router. @module @dsh-rp/agent-runtime */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  RpCapabilityContribution,
  RpResolvedCapabilityInvocation,
} from '@dsh-rp/capability-catalog'
import type {
  JsonObject,
  JsonValue,
  RpBudget,
  RpCapabilityId,
  RpScopeKind,
  RpScopeRef,
  RpTrustLevel,
} from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    rpAgents: RpAgentRuntime
  }

  interface Events {
    /**
     * One RP Agent role entered or left the live catalog.
     * @param roleId - Exact changed role id.
     * @mode emit
     */
    'rp/agent-role-changed'(roleId: string): void
    /**
     * One RP Agent Provider entered or left the live router.
     * @param providerId - Exact changed Provider id.
     * @mode emit
     */
    'rp/agent-provider-changed'(providerId: string): void
    /**
     * One authorized role invocation selected its owning Provider.
     * @param run - Immutable run identity and selected route.
     * @mode emit
     */
    'rp/agent-run-started'(run: RpAgentRunInfo): void
    /**
     * One role invocation completed through its owning Provider.
     * @param run - Identity shared with the start event.
     * @mode emit
     */
    'rp/agent-run-completed'(run: RpAgentRunInfo): void
    /**
     * One role invocation was interrupted or failed.
     * @param run - Identity shared with the start event.
     * @param error - Contained diagnostic.
     * @mode emit
     */
    'rp/agent-run-interrupted'(run: RpAgentRunInfo, error: string): void
  }
}

/** Provider-neutral role template published as one executable Agent capability. */
export interface RpAgentRoleDefinition {
  /** Stable role id used by Experience agent profiles. */
  readonly id: string
  /** Capability id exposed through the unified Catalog. */
  readonly capabilityId: RpCapabilityId
  readonly version: string
  readonly title: string
  readonly description: string
  /** Provider-facing role contract, never an ambient Host prompt mutation. */
  readonly instructions: string
  readonly trust: RpTrustLevel
  readonly scopes: readonly RpScopeKind[]
  readonly permissions?: readonly string[]
  readonly budget?: RpBudget
  readonly inputSchema?: JsonObject
  readonly outputSchema?: JsonObject
  readonly tags?: readonly string[]
  /** Capability families the role may request from an owning Provider. */
  readonly capabilityKinds?: readonly string[]
  /** Exact Provider id when a deployment intentionally pins this role. */
  readonly provider?: string
}

/** Immutable invocation delivered only to the selected Agent Provider. */
export interface RpAgentProviderRequest {
  readonly runId: string
  readonly role: RpAgentRoleDefinition
  readonly invocation: RpResolvedCapabilityInvocation
}

/** Detached Provider outcome returned through the Capability Catalog. */
export interface RpAgentProviderResult {
  readonly value: JsonValue
  /** Concrete child or remote Agent identity when the Provider has one. */
  readonly agentId?: string
  /** Provider-specific transport label for audit and diagnostics. */
  readonly transport?: string
}

/** Replaceable execution Provider; domain packages depend only on this seam. */
export interface RpAgentProvider {
  readonly id: string
  readonly priority?: number
  /** Pure compatibility test used during deterministic routing. */
  supports(role: RpAgentRoleDefinition): boolean
  /** Execute exactly one already-authorized role invocation. */
  run(request: RpAgentProviderRequest): Promise<RpAgentProviderResult>
}

/** Observe-only identity shared by one run's process-local lifecycle events. */
export interface RpAgentRunInfo {
  readonly runId: string
  readonly roleId: string
  readonly capabilityId: RpCapabilityId
  readonly providerId: string
  readonly scope: RpScopeRef
}

/** Stable RP Agent routing failure. */
export class RpAgentRuntimeError extends Error {
  constructor(
    message: string,
    readonly code: 'DUPLICATE' | 'INVALID' | 'MISSING' | 'NO_PROVIDER' | 'PROVIDER',
  ) {
    super(message)
    this.name = 'RpAgentRuntimeError'
  }
}

/** Dynamic role and Provider registry with deterministic least-authority dispatch. */
export class RpAgentRuntime extends Service {
  private readonly roles = new Map<string, RpAgentRoleDefinition>()
  private readonly providers = new Map<string, RpAgentProvider>()

  constructor(ctx: Context) {
    super(ctx, 'rpAgents')
  }

  /**
   * Publish one role and its executable unified-Catalog contribution.
   * @param definition - Complete immutable role contract.
   * @returns Exact reversible registration disposer.
   */
  registerRole(definition: RpAgentRoleDefinition): () => void {
    validateRole(definition)
    const role = freezeRole(definition)
    return this.ctx.effect(() => {
      if (this.roles.has(role.id)) {
        throw new RpAgentRuntimeError(`RP Agent role ${JSON.stringify(role.id)} is already registered`, 'DUPLICATE')
      }
      this.roles.set(role.id, role)
      const contribution: RpCapabilityContribution = Object.freeze({
        descriptor: Object.freeze({
          id: role.capabilityId,
          kind: 'agent',
          version: role.version,
          title: role.title,
          description: role.description,
          trust: role.trust,
          scopes: role.scopes,
          ...(role.permissions === undefined ? {} : { permissions: role.permissions }),
          ...(role.budget === undefined ? {} : { budget: role.budget }),
          ...(role.inputSchema === undefined ? {} : { inputSchema: role.inputSchema }),
          ...(role.outputSchema === undefined ? {} : { outputSchema: role.outputSchema }),
          tags: Object.freeze(['rp', 'agent-role', ...role.tags ?? []]),
        }),
        invoke: (invocation: RpResolvedCapabilityInvocation) => this.invoke(role.id, invocation),
      })
      const capabilities = this.ctx.get('rpCapabilities')
      if (capabilities === undefined) {
        this.roles.delete(role.id)
        throw new RpAgentRuntimeError('RP Capability Catalog is unavailable during role registration', 'MISSING')
      }
      let releaseCapability: () => void
      try { releaseCapability = capabilities.register(contribution) }
      catch (error: unknown) {
        this.roles.delete(role.id)
        throw error
      }
      this.ctx.emit('rp/agent-role-changed', role.id)
      return () => {
        releaseCapability()
        if (this.roles.get(role.id) !== role) return
        this.roles.delete(role.id)
        this.ctx.emit('rp/agent-role-changed', role.id)
      }
    }, 'rpAgents.registerRole()')
  }

  /**
   * Register one replaceable Agent Provider.
   * @param provider - Trusted same-process Provider adapter.
   * @returns Exact reversible registration disposer.
   */
  registerProvider(provider: RpAgentProvider): () => void {
    validateProvider(provider)
    return this.ctx.effect(() => {
      if (this.providers.has(provider.id)) {
        throw new RpAgentRuntimeError(`RP Agent Provider ${JSON.stringify(provider.id)} is already registered`, 'DUPLICATE')
      }
      this.providers.set(provider.id, provider)
      this.ctx.emit('rp/agent-provider-changed', provider.id)
      return () => {
        if (this.providers.get(provider.id) !== provider) return
        this.providers.delete(provider.id)
        this.ctx.emit('rp/agent-provider-changed', provider.id)
      }
    }, 'rpAgents.registerProvider()')
  }

  /**
   * List detached role contracts in id order.
   * @returns Immutable role definitions.
   */
  listRoles(): readonly RpAgentRoleDefinition[] {
    return [...this.roles.values()].sort((left, right) => left.id.localeCompare(right.id))
  }

  /**
   * Get one immutable role contract.
   * @param roleId - Exact role id.
   * @returns Live definition when present.
   */
  getRole(roleId: string): RpAgentRoleDefinition | undefined {
    return this.roles.get(roleId)
  }

  /**
   * List Provider ids in deterministic routing order.
   * @returns Highest-priority Provider first.
   */
  listProviders(): readonly string[] {
    return [...this.providers.values()].sort(compareProviders).map(provider => provider.id)
  }

  /**
   * Route one already-authorized Agent capability call to its owning Provider.
   * @param roleId - Exact registered role id.
   * @param invocation - Catalog-resolved least authority and input.
   * @returns Detached JSON result.
   */
  async invoke(roleId: string, invocation: RpResolvedCapabilityInvocation): Promise<JsonValue> {
    const role = this.roles.get(roleId)
    if (role === undefined) throw new RpAgentRuntimeError(`RP Agent role ${JSON.stringify(roleId)} is not registered`, 'MISSING')
    const provider = this.selectProvider(role)
    const run = Object.freeze({
      runId: randomUUID(),
      roleId: role.id,
      capabilityId: role.capabilityId,
      providerId: provider.id,
      scope: invocation.scope,
    } satisfies RpAgentRunInfo)
    this.ctx.emit('rp/agent-run-started', run)
    try {
      const result = await provider.run(Object.freeze({ runId: run.runId, role, invocation }))
      const value = detachJson(result.value, `RP Agent Provider ${JSON.stringify(provider.id)} result`)
      this.ctx.emit('rp/agent-run-completed', run)
      return value
    } catch (error: unknown) {
      const message = renderError(error)
      this.ctx.emit('rp/agent-run-interrupted', run, message)
      if (error instanceof RpAgentRuntimeError) throw error
      throw new RpAgentRuntimeError(
        `RP Agent Provider ${JSON.stringify(provider.id)} failed for role ${JSON.stringify(role.id)}: ${message}`,
        'PROVIDER',
      )
    }
  }

  private selectProvider(role: RpAgentRoleDefinition): RpAgentProvider {
    if (role.provider !== undefined) {
      const provider = this.providers.get(role.provider)
      if (provider === undefined) {
        throw new RpAgentRuntimeError(
          `RP Agent role ${JSON.stringify(role.id)} requires missing Provider ${JSON.stringify(role.provider)}`,
          'NO_PROVIDER',
        )
      }
      if (!provider.supports(role)) {
        throw new RpAgentRuntimeError(
          `RP Agent Provider ${JSON.stringify(provider.id)} does not support role ${JSON.stringify(role.id)}`,
          'NO_PROVIDER',
        )
      }
      return provider
    }
    const provider = [...this.providers.values()].sort(compareProviders).find(candidate => candidate.supports(role))
    if (provider === undefined) {
      throw new RpAgentRuntimeError(`No RP Agent Provider supports role ${JSON.stringify(role.id)}`, 'NO_PROVIDER')
    }
    return provider
  }
}

function compareProviders(left: RpAgentProvider, right: RpAgentProvider): number {
  return (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id)
}

function validateRole(role: RpAgentRoleDefinition): void {
  for (const [label, value] of [
    ['id', role.id], ['capabilityId', String(role.capabilityId)], ['version', role.version],
    ['title', role.title], ['description', role.description], ['instructions', role.instructions],
  ] as const) {
    if (value.trim() === '' || value !== value.trim()) {
      throw new RpAgentRuntimeError(`RP Agent role ${label} must be normalized and non-empty`, 'INVALID')
    }
  }
  if (role.scopes.length === 0) throw new RpAgentRuntimeError('RP Agent role must support at least one scope', 'INVALID')
  normalize(role.scopes, 'scope')
  normalize(role.permissions ?? [], 'permission')
  normalize(role.tags ?? [], 'tag')
  normalize(role.capabilityKinds ?? [], 'capability kind')
  if (role.provider !== undefined && (role.provider.trim() === '' || role.provider !== role.provider.trim())) {
    throw new RpAgentRuntimeError('RP Agent role Provider id must be normalized and non-empty', 'INVALID')
  }
}

function validateProvider(provider: RpAgentProvider): void {
  if (provider.id.trim() === '' || provider.id !== provider.id.trim()) {
    throw new RpAgentRuntimeError('RP Agent Provider id must be normalized and non-empty', 'INVALID')
  }
  if (provider.priority !== undefined && !Number.isSafeInteger(provider.priority)) {
    throw new RpAgentRuntimeError('RP Agent Provider priority must be a safe integer', 'INVALID')
  }
}

function normalize(values: readonly string[], label: string): void {
  if (values.some(value => value.trim() === '' || value !== value.trim()) || new Set(values).size !== values.length) {
    throw new RpAgentRuntimeError(`RP Agent role ${label}s must be unique normalized strings`, 'INVALID')
  }
}

function freezeRole(role: RpAgentRoleDefinition): RpAgentRoleDefinition {
  return Object.freeze({
    ...role,
    scopes: Object.freeze([...role.scopes]),
    ...(role.permissions === undefined ? {} : { permissions: Object.freeze([...role.permissions]) }),
    ...(role.budget === undefined ? {} : { budget: Object.freeze({ ...role.budget }) }),
    ...(role.inputSchema === undefined ? {} : { inputSchema: freezeJson(detachJson(role.inputSchema, 'RP Agent input schema')) as JsonObject }),
    ...(role.outputSchema === undefined ? {} : { outputSchema: freezeJson(detachJson(role.outputSchema, 'RP Agent output schema')) as JsonObject }),
    ...(role.tags === undefined ? {} : { tags: Object.freeze([...role.tags]) }),
    ...(role.capabilityKinds === undefined ? {} : { capabilityKinds: Object.freeze([...role.capabilityKinds]) }),
  })
}

function detachJson(value: JsonValue, label: string): JsonValue {
  try {
    validateJson(value, new Set<object>())
    const serialized = JSON.stringify(value)
    const cloned: unknown = JSON.parse(serialized)
    validateJson(cloned, new Set<object>())
    return cloned
  } catch (error: unknown) {
    throw new RpAgentRuntimeError(`${label} must contain finite JSON: ${renderError(error)}`, 'INVALID')
  }
}

function validateJson(value: unknown, ancestors: Set<object>): asserts value is JsonValue {
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) {
    throw new Error('JSON numbers must be finite and must not be negative zero')
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return
  if (typeof value !== 'object') throw new Error(`unsupported JSON value type ${typeof value}`)
  if (ancestors.has(value)) throw new Error('JSON values must not contain cycles')
  const prototype: unknown = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error('JSON values must contain only arrays and plain objects')
  }
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new Error('JSON arrays must not be sparse')
      validateJson(value[index], ancestors)
    }
  } else {
    for (const child of Object.values(value)) validateJson(child, ancestors)
  }
  ancestors.delete(value)
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    for (const child of value) freezeJson(child)
    Object.freeze(value)
    return value
  }
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child)
    Object.freeze(value)
    return value
  }
  return value
}

function renderError(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error) }
  catch { return '[unrenderable thrown value]' }
}

/** Cordis plugin name. */
export const name = 'rp-agent-runtime'
/** Capability Catalog required before roles can publish executable entries. */
export const inject = ['rpCapabilities']

export default RpAgentRuntime
