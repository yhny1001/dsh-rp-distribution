/** Scoped directed relationship graph. @module @dsh-rp/relationship */
import { Context, Service } from '@deepseek-ai/cordis'
import type { RelationshipIR, RpScopeRef } from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpRelationships: RpRelationshipRuntime }
  interface Events {
    /**
     * A directed relationship committed a new revision.
     * @param scope - Relationship lifecycle scope.
     * @param relationship - Frozen committed relationship.
     * @mode emit
     */
    'rp/relationship-runtime-changed'(scope: RpScopeRef, relationship: RelationshipIR): void
  }
}

/** Complete relationship update without its runtime-owned revision. */
export interface RpRelationshipUpdate {
  readonly from: string
  readonly to: string
  readonly dimensions: Readonly<Record<string, number>>
  readonly notes?: readonly string[]
}

/** Conflict raised when a relationship write is based on an obsolete revision. */
export class RpRelationshipConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`RP relationship revision conflict: expected ${expected}, actual ${actual}`)
    this.name = 'RpRelationshipConflictError'
  }
}

/** Owner-scoped directed relationship graph with optimistic writes. */
export class RpRelationshipRuntime extends Service {
  private readonly graphs = new Map<string, Map<string, RelationshipIR>>()
  constructor(ctx: Context) { super(ctx, 'rpRelationships') }

  /**
   * Read one directed relationship.
   * @param scope - Relationship lifecycle scope.
   * @param from - Source entity id.
   * @param to - Target entity id.
   * @returns Frozen current relationship, when present.
   */
  read(scope: RpScopeRef, from: string, to: string): RelationshipIR | undefined {
    return this.graphs.get(scopeKey(scope))?.get(edgeKey(from, to))
  }

  /**
   * List a scope's directed relationships in deterministic order.
   * @param scope - Relationship lifecycle scope.
   * @returns Frozen relationship list.
   */
  list(scope: RpScopeRef): readonly RelationshipIR[] {
    return Object.freeze([...this.graphs.get(scopeKey(scope))?.values() ?? []]
      .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)))
  }

  /**
   * Replace one directed relationship after an optimistic revision check.
   * @param scope - Relationship lifecycle scope.
   * @param update - Complete new relationship values.
   * @param expectedRevision - Current revision expected by the writer.
   * @returns Frozen committed relationship.
   */
  replace(scope: RpScopeRef, update: RpRelationshipUpdate, expectedRevision: number = 0): RelationshipIR {
    validateUpdate(update)
    const graphKey = scopeKey(scope)
    const graph = this.graphs.get(graphKey) ?? new Map<string, RelationshipIR>()
    const key = edgeKey(update.from, update.to)
    const actual = graph.get(key)?.revision ?? 0
    if (actual !== expectedRevision) throw new RpRelationshipConflictError(expectedRevision, actual)
    const relationship = freezeRelationship({ schemaVersion: 1, revision: actual + 1, ...update })
    graph.set(key, relationship)
    this.graphs.set(graphKey, graph)
    this.ctx.emit('rp/relationship-runtime-changed', freezeScope(scope), relationship)
    return relationship
  }

  /**
   * Remove every relationship in one scope.
   * @param scope - Relationship lifecycle scope.
   * @returns Whether a graph existed.
   */
  release(scope: RpScopeRef): boolean { return this.graphs.delete(scopeKey(scope)) }
}

function validateUpdate(update: RpRelationshipUpdate): void {
  if (update.from.trim() === '' || update.to.trim() === '' || update.from === update.to) {
    throw new Error('RP relationship requires distinct non-empty from and to ids')
  }
  const entries = Object.entries(update.dimensions)
  if (entries.length > 100) throw new Error('RP relationship supports at most 100 dimensions')
  for (const [name, value] of entries) {
    if (name.trim() === '' || !Number.isFinite(value) || value < -100 || value > 100) {
      throw new Error('RP relationship dimensions require non-empty names and finite values from -100 to 100')
    }
  }
  if ((update.notes?.length ?? 0) > 100 || update.notes?.some(note => note.trim() === '' || note.length > 4_000) === true) {
    throw new Error('RP relationship notes must contain at most 100 non-empty values of at most 4000 characters')
  }
}
function freezeRelationship(value: RelationshipIR): RelationshipIR {
  return Object.freeze({
    ...value,
    dimensions: Object.freeze({ ...value.dimensions }),
    ...(value.notes === undefined ? {} : { notes: Object.freeze([...value.notes]) }),
  })
}
function edgeKey(from: string, to: string): string { return `${from}\u0000${to}` }
function scopeKey(scope: RpScopeRef): string { return `${scope.kind}:${scope.id}` }
function freezeScope(scope: RpScopeRef): RpScopeRef {
  return Object.freeze({ ...scope, ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }) })
}

export default RpRelationshipRuntime
