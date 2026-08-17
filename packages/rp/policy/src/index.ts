/** Layered RP authorization: deployment ∩ product ∩ plugin ∩ user ∩ agent ∩ call. @module @dsh-rp/policy */

import { Context, Service } from '@deepseek-ai/cordis'
import type { RpBudget, RpTrustLevel } from '@dsh-rp/contracts'
import type {
  RpCapabilityAuthorizationRequest,
  RpCapabilityAuthorityDecision,
} from '@dsh-rp/capability-catalog'

declare module '@deepseek-ai/cordis' {
  interface Context {
    rpPolicy: RpPolicyRuntime
  }

  interface Events {
    /**
     * A policy layer was added or removed.
     * @param name - Stable layer name.
     * @mode emit
     */
    'rp/policy-changed'(name: string): void
    /**
     * An authority request was denied.
     * @param reason - Stable diagnostic.
     * @mode emit
     */
    'rp/policy-denied'(reason: string): void
  }
}

/** One independently owned authority ceiling. Omitted fields do not constrain that dimension. */
export interface RpPolicyLayer {
  readonly name: string
  readonly permissions?: readonly string[]
  readonly maxTrust?: RpTrustLevel
  readonly budget?: RpBudget
  readonly networkDomains?: readonly string[]
  readonly fileRoots?: readonly string[]
}

/** Per-call authority being intersected with registered policy layers. */
export interface RpAuthorityRequest {
  readonly requestedPermissions: readonly string[]
  readonly requestedTrust: RpTrustLevel
  readonly budget?: RpBudget
  readonly networkDomains?: readonly string[]
  readonly fileRoots?: readonly string[]
  readonly layers?: readonly RpPolicyLayer[]
}

/** Immutable effective authority passed to execution adapters. */
export interface RpAuthorityDecision {
  readonly permissions: readonly string[]
  readonly trust: RpTrustLevel
  readonly budget: RpBudget
  readonly networkDomains: readonly string[]
  readonly fileRoots: readonly string[]
  readonly layers: readonly string[]
}

/** Policy validation or denial. */
export class RpPolicyError extends Error {
  /** Machine-readable failure category. */
  readonly code: 'DUPLICATE' | 'INVALID' | 'TRUST_DENIED'

  /**
   * Create a policy failure.
   * @param message - Human-readable diagnostic.
   * @param code - Stable failure category.
   */
  constructor(message: string, code: RpPolicyError['code']) {
    super(message)
    this.name = 'RpPolicyError'
    this.code = code
  }
}

/** Reversible registry for deployment and product policy plus pure per-call resolution. */
export class RpPolicyRuntime extends Service {
  static inject = ['rpCapabilities']

  private readonly registered = new Map<string, RpPolicyLayer>()

  constructor(ctx: Context) {
    super(ctx, 'rpPolicy')
    ctx.effect(() => ctx.rpCapabilities.registerAuthorizer({
      id: 'rp-policy-layers',
      priority: 1_000,
      authorize: request => this.authorizeCapability(request),
    }))
  }

  /**
   * Register a deployment- or product-owned ceiling.
   * @param layer - Immutable authority ceiling.
   * @returns Idempotent disposer.
   */
  register(layer: RpPolicyLayer): () => void {
    const stored = freezeLayer(layer)
    if (this.registered.has(stored.name)) throw new RpPolicyError(`RP policy layer ${JSON.stringify(stored.name)} already exists`, 'DUPLICATE')
    this.registered.set(stored.name, stored)
    this.ctx.emit('rp/policy-changed', stored.name)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.registered.get(stored.name) !== stored) return
      this.registered.delete(stored.name)
      this.ctx.emit('rp/policy-changed', stored.name)
    }
  }

  /**
   * List registered layer metadata in deterministic order.
   * @returns Frozen policy layers.
   */
  list(): readonly RpPolicyLayer[] {
    return [...this.registered.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Intersect registered layers with per-call ceilings.
   * @param request - Requested authority and additional layers.
   * @returns Immutable effective authority.
   */
  resolve(request: RpAuthorityRequest): RpAuthorityDecision {
    const layers = [...this.list(), ...(request.layers ?? []).map(freezeLayer)]
    const trust = layers.reduce((current, layer) => minimumTrust(current, layer.maxTrust), request.requestedTrust)
    if (trust !== request.requestedTrust) {
      const reason = `requested trust ${request.requestedTrust} exceeds effective ceiling ${trust}`
      this.ctx.emit('rp/policy-denied', reason)
      throw new RpPolicyError(reason, 'TRUST_DENIED')
    }
    return Object.freeze({
      permissions: Object.freeze(intersectRequested(request.requestedPermissions, layers.map(layer => layer.permissions))),
      trust,
      budget: Object.freeze(intersectBudgets(request.budget, ...layers.map(layer => layer.budget))),
      networkDomains: Object.freeze(intersectRequested(request.networkDomains ?? [], layers.map(layer => layer.networkDomains))),
      fileRoots: Object.freeze(intersectRequested(request.fileRoots ?? [], layers.map(layer => layer.fileRoots))),
      layers: Object.freeze(layers.map(layer => layer.name)),
    })
  }

  private authorizeCapability(request: RpCapabilityAuthorizationRequest): RpCapabilityAuthorityDecision {
    const decision = this.resolve({
      requestedPermissions: request.authority.permissions,
      requestedTrust: request.authority.trust,
      budget: request.authority.budget,
      networkDomains: request.authority.networkDomains,
      fileRoots: request.authority.fileRoots,
      ...(request.invocation.policyLayers === undefined
        ? {}
        : { layers: request.invocation.policyLayers }),
    })
    return Object.freeze({
      permissions: decision.permissions,
      trust: decision.trust,
      budget: decision.budget,
      networkDomains: decision.networkDomains,
      fileRoots: decision.fileRoots,
      layers: decision.layers,
    })
  }
}

/**
 * Intersect positive budget ceilings by taking the smallest declared limit.
 * @param budgets - Optional budget ceilings.
 * @returns Effective budget.
 */
export function intersectBudgets(...budgets: readonly (RpBudget | undefined)[]): RpBudget {
  const keys = ['timeoutMs', 'maxTokens', 'maxToolCalls', 'maxAgents', 'maxCostUsd'] as const
  const result: Partial<Record<typeof keys[number], number>> = {}
  for (const key of keys) {
    const values = budgets.flatMap(budget => budget?.[key] === undefined ? [] : [budget[key]])
    if (values.length > 0) result[key] = Math.min(...values)
  }
  return result
}

function intersectRequested(requested: readonly string[], ceilings: readonly (readonly string[] | undefined)[]): string[] {
  const constrained = ceilings.filter((value): value is readonly string[] => value !== undefined).map(value => new Set(value))
  return [...new Set(requested)].filter(value => constrained.every(ceiling => ceiling.has(value))).sort()
}

function minimumTrust(left: RpTrustLevel, right: RpTrustLevel | undefined): RpTrustLevel {
  if (right === undefined) return left
  const order: readonly RpTrustLevel[] = ['L0', 'L1', 'L2']
  return order[Math.min(order.indexOf(left), order.indexOf(right))] ?? 'L0'
}

function freezeLayer(layer: RpPolicyLayer): RpPolicyLayer {
  if (layer.name.trim() === '') throw new RpPolicyError('RP policy layer name must be non-empty', 'INVALID')
  for (const [key, value] of Object.entries(layer.budget ?? {})) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RpPolicyError(`RP policy ${JSON.stringify(layer.name)} budget ${JSON.stringify(key)} must be positive`, 'INVALID')
    }
  }
  return Object.freeze({
    ...layer,
    ...(layer.permissions === undefined ? {} : { permissions: Object.freeze([...new Set(layer.permissions)]) }),
    ...(layer.networkDomains === undefined ? {} : { networkDomains: Object.freeze([...new Set(layer.networkDomains)]) }),
    ...(layer.fileRoots === undefined ? {} : { fileRoots: Object.freeze([...new Set(layer.fileRoots)]) }),
    ...(layer.budget === undefined ? {} : { budget: Object.freeze({ ...layer.budget }) }),
  })
}

export default RpPolicyRuntime
