/** Unified capability discovery with scope, permission, and budget enforcement. @module @dsh-rp/capability-catalog */

import { Context, Service } from '@deepseek-ai/cordis'
import type { JsonValue, RpBudget, RpCapabilityId, RpTrustLevel } from '@dsh-rp/contracts'
import type {
  RpCapabilityAuthorityDecision,
  RpCapabilityAuthorizer,
  RpCapabilityContribution,
  RpCapabilityDescriptor,
  RpCapabilityInvocation,
  RpCapabilityQuery,
  RpResolvedCapabilityInvocation,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    rpCapabilities: RpCapabilityCatalog
  }

  interface Events {
    /**
     * A capability registration changed.
     * @param id - Changed capability id.
     * @mode emit
     */
    'rp/capabilities-changed'(id: RpCapabilityId): void
    /**
     * A capability invocation started after authorization.
     * @param descriptor - Invoked capability metadata.
     * @mode emit
     */
    'rp/capability-started'(descriptor: RpCapabilityDescriptor): void
    /**
     * A capability invocation completed.
     * @param descriptor - Invoked capability metadata.
     * @mode emit
     */
    'rp/capability-completed'(descriptor: RpCapabilityDescriptor): void
    /**
     * A capability invocation received its least effective authority.
     * @param descriptor - Invoked capability metadata.
     * @param authority - Immutable least-authority decision.
     * @mode emit
     */
    'rp/capability-authorized'(
      descriptor: RpCapabilityDescriptor,
      authority: RpCapabilityAuthorityDecision,
    ): void
    /**
     * A capability invocation was denied before its adapter ran.
     * @param descriptor - Denied capability metadata.
     * @param error - Stable rendered denial.
     * @mode emit
     */
    'rp/capability-denied'(descriptor: RpCapabilityDescriptor, error: string): void
    /**
     * A capability invocation failed.
     * @param descriptor - Invoked capability metadata.
     * @param error - Rendered failure.
     * @mode emit
     */
    'rp/capability-failed'(descriptor: RpCapabilityDescriptor, error: string): void
  }
}

/** Capability lookup or authorization failure. */
export class RpCapabilityError extends Error {
  /** Machine-readable failure category. */
  readonly code: 'DUPLICATE' | 'MISSING' | 'INVALID' | 'SCOPE' | 'PERMISSION' | 'TRUST' | 'NOT_EXECUTABLE'

  /** @param message - Human-readable failure. @param code - Stable failure category. */
  constructor(message: string, code: RpCapabilityError['code']) {
    super(message)
    this.name = 'RpCapabilityError'
    this.code = code
  }
}

/** Process-local directory over adapters owned by Tool, Skill, Agent, Pipeline, and RP plugins. */
export class RpCapabilityCatalog extends Service {
  private readonly contributions = new Map<RpCapabilityId, RpCapabilityContribution>()
  private readonly authorizers = new Map<string, RpCapabilityAuthorizer>()

  constructor(ctx: Context) {
    super(ctx, 'rpCapabilities')
  }

  /**
   * Register one adapter without taking ownership of its underlying registry.
   * @param contribution - Descriptor and optional invocation bridge.
   * @returns Idempotent disposer.
   */
  register(contribution: RpCapabilityContribution): () => void {
    validateDescriptor(contribution.descriptor)
    const { id } = contribution.descriptor
    if (this.contributions.has(id)) {
      throw new RpCapabilityError(`RP capability ${JSON.stringify(id)} is already registered`, 'DUPLICATE')
    }
    const stored = freezeContribution(contribution)
    this.contributions.set(id, stored)
    this.ctx.emit('rp/capabilities-changed', id)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.contributions.get(id) !== stored) return
      this.contributions.delete(id)
      this.ctx.emit('rp/capabilities-changed', id)
    }
  }

  /**
   * Register a policy adapter which may only narrow invocation authority.
   * @param authorizer - Reversible authorization adapter.
   * @returns Idempotent disposer.
   */
  registerAuthorizer(authorizer: RpCapabilityAuthorizer): () => void {
    if (authorizer.id.trim() === '' || authorizer.id !== authorizer.id.trim()) {
      throw new RpCapabilityError('RP capability authorizer id must be normalized', 'INVALID')
    }
    if (this.authorizers.has(authorizer.id)) {
      throw new RpCapabilityError(
        `RP capability authorizer ${JSON.stringify(authorizer.id)} is already registered`,
        'DUPLICATE',
      )
    }
    const stored = Object.freeze({ ...authorizer })
    this.authorizers.set(stored.id, stored)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.authorizers.get(stored.id) === stored) this.authorizers.delete(stored.id)
    }
  }

  /**
   * List authorization adapters in deterministic execution order.
   * @returns Detached authorizer metadata.
   */
  listAuthorizers(): readonly Readonly<Pick<RpCapabilityAuthorizer, 'id' | 'priority'>>[] {
    return [...this.authorizers.values()]
      .sort(compareAuthorizers)
      .map(item => Object.freeze({ id: item.id, ...(item.priority === undefined ? {} : { priority: item.priority }) }))
  }

  /**
   * Discover authorized metadata in deterministic id order.
   * @param query - Optional conjunctive filters.
   * @returns Detached immutable descriptors.
   */
  list(query: RpCapabilityQuery = {}): readonly RpCapabilityDescriptor[] {
    const permitted = query.permittedBy === undefined ? undefined : new Set(query.permittedBy)
    return [...this.contributions.values()]
      .map(contribution => contribution.descriptor)
      .filter((descriptor) => {
        if (query.kind !== undefined && descriptor.kind !== query.kind) return false
        if (query.scope !== undefined && !descriptor.scopes.includes(query.scope)) return false
        if (query.tag !== undefined && !descriptor.tags?.includes(query.tag)) return false
        if (permitted !== undefined && descriptor.permissions?.some(permission => !permitted.has(permission)) === true) return false
        if (query.trustedBy !== undefined && trustRank(descriptor.trust) > trustRank(query.trustedBy)) return false
        return true
      })
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  }

  /**
   * Return one descriptor.
   * @param id - Registered capability id.
   * @returns Immutable descriptor when registered.
   */
  get(id: RpCapabilityId): RpCapabilityDescriptor | undefined {
    return this.contributions.get(id)?.descriptor
  }

  /**
   * Test whether the owning registry supplied an invocation bridge.
   * @param id - Registered capability id.
   * @returns Whether the contribution is executable through its owner.
   */
  isExecutable(id: RpCapabilityId): boolean {
    return this.contributions.get(id)?.invoke !== undefined
  }

  /**
   * Invoke through the owning adapter after authorization.
   * @param id - Capability to invoke.
   * @param request - Caller authority and input.
   * @returns Adapter result.
   */
  async invoke(id: RpCapabilityId, request: RpCapabilityInvocation): Promise<JsonValue> {
    const contribution = this.contributions.get(id)
    if (contribution === undefined) throw new RpCapabilityError(`RP capability ${JSON.stringify(id)} is not registered`, 'MISSING')
    const { descriptor, invoke } = contribution
    let authority: RpCapabilityAuthorityDecision
    try {
      if (!descriptor.scopes.includes(request.scope.kind)) {
        throw new RpCapabilityError(
          `RP capability ${JSON.stringify(id)} does not support scope ${JSON.stringify(request.scope.kind)}`,
          'SCOPE',
        )
      }
      const granted = new Set(request.grantedPermissions)
      const denied = descriptor.permissions?.find(permission => !granted.has(permission))
      if (denied !== undefined) {
        throw new RpCapabilityError(`RP capability ${JSON.stringify(id)} requires denied permission ${JSON.stringify(denied)}`, 'PERMISSION')
      }
      const grantedTrust = request.grantedTrust ?? 'L0'
      if (trustRank(descriptor.trust) > trustRank(grantedTrust)) {
        throw new RpCapabilityError(
          `RP capability ${JSON.stringify(id)} trust ${descriptor.trust} exceeds caller ceiling ${grantedTrust}`,
          'TRUST',
        )
      }
      if (invoke === undefined) {
        throw new RpCapabilityError(`RP capability ${JSON.stringify(id)} is discovery-only`, 'NOT_EXECUTABLE')
      }
      authority = freezeAuthority({
        permissions: descriptor.permissions ?? [],
        trust: descriptor.trust,
        budget: intersectBudgets(descriptor.budget, request.budget),
        networkDomains: request.networkDomains ?? [],
        fileRoots: request.fileRoots ?? [],
        layers: [],
      })
      for (const authorizer of [...this.authorizers.values()].sort(compareAuthorizers)) {
        const next = freezeAuthority(authorizer.authorize(Object.freeze({
          capability: descriptor,
          invocation: request,
          authority,
        })))
        assertNarrower(authorizer.id, authority, next)
        authority = next
      }
      assertDescriptorAuthority(descriptor, authority)
    } catch (error: unknown) {
      this.ctx.emit('rp/capability-denied', descriptor, renderError(error))
      throw error
    }
    const { onAuthorized, ...adapterRequest } = request
    const resolved: RpResolvedCapabilityInvocation = Object.freeze({
      ...adapterRequest,
      grantedPermissions: Object.freeze([...request.grantedPermissions]),
      ...(request.policyLayers === undefined ? {} : { policyLayers: Object.freeze(request.policyLayers.map(freezePolicyLayer)) }),
      ...(request.networkDomains === undefined ? {} : { networkDomains: Object.freeze([...request.networkDomains]) }),
      ...(request.fileRoots === undefined ? {} : { fileRoots: Object.freeze([...request.fileRoots]) }),
      capability: descriptor,
      effectiveAuthority: authority,
      effectiveBudget: authority.budget,
    })
    this.ctx.emit('rp/capability-authorized', descriptor, authority)
    onAuthorized?.(authority)
    this.ctx.emit('rp/capability-started', descriptor)
    try {
      const result = await invoke(resolved)
      this.ctx.emit('rp/capability-completed', descriptor)
      return result
    } catch (error: unknown) {
      this.ctx.emit('rp/capability-failed', descriptor, renderError(error))
      throw error
    }
  }
}

/**
 * Intersect positive numeric limits by taking the lower supplied value.
 * @param budgets - Optional authority ceilings.
 * @returns Effective budget.
 */
export function intersectBudgets(...budgets: readonly (RpBudget | undefined)[]): RpBudget {
  const keys = ['timeoutMs', 'maxTokens', 'maxToolCalls', 'maxAgents', 'maxCostUsd'] as const
  const result: Record<string, number> = {}
  for (const key of keys) {
    const values = budgets.map(budget => budget?.[key]).filter((value): value is number => value !== undefined)
    if (values.length > 0) result[key] = Math.min(...values)
  }
  return result
}

function compareAuthorizers(left: RpCapabilityAuthorizer, right: RpCapabilityAuthorizer): number {
  return (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id)
}

function freezeAuthority(authority: RpCapabilityAuthorityDecision): RpCapabilityAuthorityDecision {
  return Object.freeze({
    permissions: Object.freeze([...new Set(authority.permissions)].sort()),
    trust: authority.trust,
    budget: Object.freeze({ ...authority.budget }),
    networkDomains: Object.freeze([...new Set(authority.networkDomains)].sort()),
    fileRoots: Object.freeze([...new Set(authority.fileRoots)].sort()),
    layers: Object.freeze([...authority.layers]),
  })
}

function freezePolicyLayer(layer: NonNullable<RpCapabilityInvocation['policyLayers']>[number]) {
  return Object.freeze({
    ...layer,
    ...(layer.permissions === undefined ? {} : { permissions: Object.freeze([...layer.permissions]) }),
    ...(layer.networkDomains === undefined ? {} : { networkDomains: Object.freeze([...layer.networkDomains]) }),
    ...(layer.fileRoots === undefined ? {} : { fileRoots: Object.freeze([...layer.fileRoots]) }),
    ...(layer.budget === undefined ? {} : { budget: Object.freeze({ ...layer.budget }) }),
  })
}

function assertDescriptorAuthority(
  descriptor: RpCapabilityDescriptor,
  authority: RpCapabilityAuthorityDecision,
): void {
  if (trustRank(authority.trust) < trustRank(descriptor.trust)) {
    throw new RpCapabilityError(
      `RP capability ${JSON.stringify(descriptor.id)} trust ${descriptor.trust} exceeds effective authority ${authority.trust}`,
      'TRUST',
    )
  }
  const granted = new Set(authority.permissions)
  const denied = descriptor.permissions?.find(permission => !granted.has(permission))
  if (denied !== undefined) {
    throw new RpCapabilityError(
      `RP capability ${JSON.stringify(descriptor.id)} requires denied permission ${JSON.stringify(denied)}`,
      'PERMISSION',
    )
  }
}

function assertNarrower(
  authorizerId: string,
  before: RpCapabilityAuthorityDecision,
  after: RpCapabilityAuthorityDecision,
): void {
  const invalid = trustRank(after.trust) > trustRank(before.trust)
    || !isSubset(after.permissions, before.permissions)
    || !isSubset(after.networkDomains, before.networkDomains)
    || !isSubset(after.fileRoots, before.fileRoots)
    || budgetWidens(before.budget, after.budget)
  if (invalid) {
    throw new RpCapabilityError(
      `RP capability authorizer ${JSON.stringify(authorizerId)} attempted to widen authority`,
      'INVALID',
    )
  }
}

function isSubset(values: readonly string[], ceiling: readonly string[]): boolean {
  const allowed = new Set(ceiling)
  return values.every(value => allowed.has(value))
}

function budgetWidens(before: RpBudget, after: RpBudget): boolean {
  const keys = ['timeoutMs', 'maxTokens', 'maxToolCalls', 'maxAgents', 'maxCostUsd'] as const
  return keys.some((key) => {
    const ceiling = before[key]
    const value = after[key]
    return ceiling !== undefined && (value === undefined || value > ceiling)
  })
}

function trustRank(value: RpTrustLevel): number { return value === 'L0' ? 0 : value === 'L1' ? 1 : 2 }

/** Validate metadata at its external registration boundary. */
function validateDescriptor(descriptor: RpCapabilityDescriptor): void {
  if (String(descriptor.id).length === 0 || descriptor.version.length === 0
    || descriptor.title.length === 0 || descriptor.description.length === 0) {
    throw new RpCapabilityError('RP capability id, version, title, and description must be non-empty', 'INVALID')
  }
  if (descriptor.scopes.length === 0) {
    throw new RpCapabilityError(`RP capability ${JSON.stringify(descriptor.id)} must support at least one scope`, 'INVALID')
  }
  for (const [key, value] of Object.entries(descriptor.budget ?? {})) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RpCapabilityError(`RP capability ${JSON.stringify(descriptor.id)} budget ${JSON.stringify(key)} must be positive`, 'INVALID')
    }
  }
}

/** Detach caller-owned arrays and records before publication. */
function freezeContribution(contribution: RpCapabilityContribution): RpCapabilityContribution {
  const descriptor = contribution.descriptor
  return Object.freeze({
    descriptor: Object.freeze({
      ...descriptor,
      scopes: Object.freeze([...descriptor.scopes]),
      ...(descriptor.permissions === undefined ? {} : { permissions: Object.freeze([...descriptor.permissions]) }),
      ...(descriptor.tags === undefined ? {} : { tags: Object.freeze([...descriptor.tags]) }),
      ...(descriptor.budget === undefined ? {} : { budget: Object.freeze({ ...descriptor.budget }) }),
      ...(descriptor.inputSchema === undefined ? {} : { inputSchema: Object.freeze({ ...descriptor.inputSchema }) }),
      ...(descriptor.outputSchema === undefined ? {} : { outputSchema: Object.freeze({ ...descriptor.outputSchema }) }),
    }),
    ...(contribution.invoke === undefined ? {} : { invoke: contribution.invoke }),
  })
}

/** Render thrown values without allowing hostile coercion to replace the original failure. */
function renderError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

export default RpCapabilityCatalog
