/** Cordis registry for RP components and immutable composition snapshots. @module @dsh-rp/component-runtime */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { RpCompositionId } from '@dsh-rp/contracts'
import type { RpComponentId } from '@dsh-rp/contracts'
import type {
  RpComponentDefinition,
  RpComponentDependency,
  RpCompositionRequest,
  RpCompositionSnapshot,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    rpComponents: RpComponentRegistry
  }

  interface Events {
    /**
     * A component registration changed.
     * @param id - Changed component id.
     * @mode emit
     */
    'rp/components-changed'(id: RpComponentId): void
    /**
     * A composition was resolved and frozen.
     * @param snapshot - Immutable resolved composition.
     * @mode emit
     */
    'rp/composition-resolved'(snapshot: RpCompositionSnapshot): void
  }
}

/** Registry error with a stable machine-readable code. */
export class RpComponentError extends Error {
  /** Machine-readable failure category. */
  readonly code: 'DUPLICATE' | 'MISSING' | 'VERSION' | 'CYCLE' | 'SCOPE' | 'CAPABILITY' | 'INVALID'

  /** @param message - Human-readable failure. @param code - Stable failure category. */
  constructor(message: string, code: RpComponentError['code']) {
    super(message)
    this.name = 'RpComponentError'
    this.code = code
  }
}

/** Dynamic component registry. Registrations disappear when their returned disposer runs. */
export class RpComponentRegistry extends Service {
  private readonly definitions = new Map<RpComponentId, RpComponentDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'rpComponents')
  }

  /**
   * Register one component.
   * @param definition - Complete immutable metadata.
   * @returns Idempotent disposer.
   */
  register(definition: RpComponentDefinition): () => void {
    validateDefinition(definition)
    if (this.definitions.has(definition.id)) {
      throw new RpComponentError(`RP component ${JSON.stringify(definition.id)} is already registered`, 'DUPLICATE')
    }
    const snapshot = freezeDefinition(definition)
    this.definitions.set(snapshot.id, snapshot)
    this.ctx.emit('rp/components-changed', snapshot.id)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.definitions.get(snapshot.id) !== snapshot) return
      this.definitions.delete(snapshot.id)
      this.ctx.emit('rp/components-changed', snapshot.id)
    }
  }

  /**
   * Return registered component metadata in deterministic id order.
   * @returns Frozen definitions.
   */
  list(): readonly RpComponentDefinition[] {
    return [...this.definitions.values()].sort(compareComponent)
  }

  /**
   * Resolve dependencies, scopes, versions, and capabilities.
   * @param request - Requested roots and authority.
   * @returns Frozen composition.
   */
  resolve(request: RpCompositionRequest): RpCompositionSnapshot {
    if (request.components.length === 0) {
      throw new RpComponentError('RP composition must request at least one component', 'INVALID')
    }
    const granted = new Set(request.grantedCapabilities)
    const resolved: RpComponentDefinition[] = []
    const visiting: RpComponentId[] = []
    const visited = new Set<RpComponentId>()

    const visit = (id: RpComponentId, dependency?: RpComponentDependency): void => {
      if (visited.has(id)) return
      const definition = this.definitions.get(id)
      if (definition === undefined) {
        if (dependency?.optional === true) return
        throw new RpComponentError(`RP component ${JSON.stringify(id)} is not registered`, 'MISSING')
      }
      if (dependency?.version !== undefined && dependency.version !== '*' && dependency.version !== definition.version) {
        throw new RpComponentError(
          `RP component ${JSON.stringify(id)} has version ${JSON.stringify(definition.version)} but ${JSON.stringify(dependency.version)} is required`,
          'VERSION',
        )
      }
      const cycleAt = visiting.indexOf(id)
      if (cycleAt >= 0) {
        const path = [...visiting.slice(cycleAt), id].join(' -> ')
        throw new RpComponentError(`RP component dependency cycle: ${path}`, 'CYCLE')
      }
      if (!definition.scopes.includes(request.scope.kind)) {
        throw new RpComponentError(
          `RP component ${JSON.stringify(id)} does not support scope ${JSON.stringify(request.scope.kind)}`,
          'SCOPE',
        )
      }
      const missingCapability = definition.requires?.find(capability => !granted.has(capability))
      if (missingCapability !== undefined) {
        throw new RpComponentError(
          `RP component ${JSON.stringify(id)} requires denied capability ${JSON.stringify(missingCapability)}`,
          'CAPABILITY',
        )
      }
      visiting.push(id)
      for (const child of [...definition.dependencies ?? []].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
        visit(child.id, child)
      }
      visiting.pop()
      visited.add(id)
      resolved.push(definition)
    }

    for (const id of request.components) visit(id)
    const hashInput = JSON.stringify({
      scope: request.scope,
      grantedCapabilities: [...granted].sort(),
      components: resolved.map(component => componentHashRecord(component)),
    })
    const snapshot: RpCompositionSnapshot = Object.freeze({
      id: RpCompositionId(createHash('sha256').update(hashInput).digest('hex')),
      scope: freezeScope(request.scope),
      components: Object.freeze([...resolved]),
      grantedCapabilities: Object.freeze([...granted].sort()),
      createdAt: Date.now(),
    })
    this.ctx.emit('rp/composition-resolved', snapshot)
    return snapshot
  }
}

/** Validate fields that are unsafe or ambiguous at the registration boundary. */
function validateDefinition(definition: RpComponentDefinition): void {
  if (String(definition.id).length === 0 || String(definition.packageId).length === 0 || definition.version.length === 0) {
    throw new RpComponentError('RP component id, packageId, and version must be non-empty', 'INVALID')
  }
  if (definition.scopes.length === 0) {
    throw new RpComponentError(`RP component ${JSON.stringify(definition.id)} must support at least one scope`, 'INVALID')
  }
}

/** Detach caller-owned arrays before publication. */
function freezeDefinition(definition: RpComponentDefinition): RpComponentDefinition {
  return Object.freeze({
    ...definition,
    scopes: Object.freeze([...definition.scopes]),
    ...(definition.dependencies === undefined ? {} : {
      dependencies: Object.freeze(definition.dependencies.map(dependency => Object.freeze({ ...dependency }))),
    }),
    ...(definition.provides === undefined ? {} : { provides: Object.freeze([...definition.provides]) }),
    ...(definition.requires === undefined ? {} : { requires: Object.freeze([...definition.requires]) }),
  })
}

/** Freeze a scope chain without retaining mutable caller objects. */
function freezeScope(scope: RpCompositionRequest['scope']): RpCompositionRequest['scope'] {
  return Object.freeze({
    kind: scope.kind,
    id: scope.id,
    ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }),
  })
}

/** Stable component data included in a composition hash. */
function componentHashRecord(component: RpComponentDefinition): object {
  return {
    id: component.id,
    packageId: component.packageId,
    version: component.version,
    trust: component.trust,
    scopes: [...component.scopes].sort(),
    dependencies: [...component.dependencies ?? []]
      .map(dependency => ({ ...dependency }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    provides: [...component.provides ?? []].sort(),
    requires: [...component.requires ?? []].sort(),
  }
}

/** Stable component ordering for diagnostics and discovery. */
function compareComponent(left: RpComponentDefinition, right: RpComponentDefinition): number {
  return String(left.id).localeCompare(String(right.id))
}

export default RpComponentRegistry
