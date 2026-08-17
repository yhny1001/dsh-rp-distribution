/** Scoped branch and swipe projection. @module @dsh-rp/branches */
import { Context, Service } from '@deepseek-ai/cordis'
import type { JsonObject, RpScopeRef } from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpBranches: RpBranchRuntime }
  interface Events {
    /**
     * A revisioned branch graph changed.
     * @param scope - Branch lifecycle scope.
     * @param snapshot - Newly committed graph.
     * @mode emit
     */
    'rp/branches-changed'(scope: RpScopeRef, snapshot: RpBranchSnapshot): void
  }
}

/** One selectable generated reply. */
export interface RpSwipeCandidate {
  readonly id: string
  readonly message: string
  readonly createdAt: number
  readonly metadata?: JsonObject
}
/** One branch and its ordered swipe candidates. */
export interface RpBranchNode {
  readonly id: string
  readonly parentId?: string
  readonly forkMessageSeq?: number
  readonly candidates: readonly RpSwipeCandidate[]
  readonly activeCandidateId?: string
  readonly createdAt: number
}
/** Immutable revisioned branch graph. */
export interface RpBranchSnapshot {
  readonly revision: number
  readonly activeBranchId: string
  readonly branches: readonly RpBranchNode[]
}
interface MutableGraph { revision: number; activeBranchId: string; branches: Map<string, RpBranchNode> }

/** Branch lookup, revision, identity, or graph-validation failure. */
export class RpBranchError extends Error {
  /** Stable failure category. */
  readonly code: 'MISSING' | 'DUPLICATE' | 'REVISION' | 'INVALID'
  constructor(message: string, code: RpBranchError['code']) { super(message); this.name = 'RpBranchError'; this.code = code }
}

/** Process-local revisioned branch and swipe projection. */
export class RpBranchRuntime extends Service {
  private readonly graphs = new Map<string, MutableGraph>()
  constructor(ctx: Context) { super(ctx, 'rpBranches') }

  /**
   * Initialize one scope with an empty root branch.
   * @param scope - Branch lifecycle scope.
   * @param branchId - Root branch identity.
   * @returns Revision-zero graph.
   */
  initialize(scope: RpScopeRef, branchId: string = 'main'): RpBranchSnapshot {
    const key = scopeKey(scope)
    if (this.graphs.has(key)) throw new RpBranchError('RP branch graph already exists', 'DUPLICATE')
    const root = freezeBranch({ id: branchId, candidates: [], createdAt: Date.now() })
    this.graphs.set(key, { revision: 0, activeBranchId: branchId, branches: new Map([[branchId, root]]) })
    return this.publish(scope)
  }

  /**
   * Read the immutable graph for one scope.
   * @param scope - Branch lifecycle scope.
   * @returns Frozen graph when initialized.
   */
  snapshot(scope: RpScopeRef): RpBranchSnapshot | undefined {
    const graph = this.graphs.get(scopeKey(scope))
    return graph === undefined ? undefined : freezeSnapshot(graph)
  }

  /**
   * Add and activate a child branch under an exact base revision.
   * @param scope - Branch lifecycle scope.
   * @param baseRevision - Required current graph revision.
   * @param node - Complete child branch.
   * @returns Newly committed graph.
   */
  fork(scope: RpScopeRef, baseRevision: number, node: RpBranchNode): RpBranchSnapshot {
    const graph = this.requireGraph(scope, baseRevision)
    if (graph.branches.has(node.id)) {
      throw new RpBranchError(`RP branch ${JSON.stringify(node.id)} already exists`, 'DUPLICATE')
    }
    if (node.parentId === undefined || !graph.branches.has(node.parentId)) throw new RpBranchError('A fork must name an existing parent branch', 'INVALID')
    graph.branches.set(node.id, freezeBranch(node)); graph.activeBranchId = node.id; graph.revision += 1; return this.publish(scope)
  }

  /**
   * Append a swipe candidate under an exact base revision.
   * @param scope - Branch lifecycle scope.
   * @param baseRevision - Required current graph revision.
   * @param branchId - Target branch identity.
   * @param candidate - New swipe candidate.
   * @param activate - Whether to select the new candidate.
   * @returns Newly committed graph.
   */
  addCandidate(
    scope: RpScopeRef,
    baseRevision: number,
    branchId: string,
    candidate: RpSwipeCandidate,
    activate: boolean = true,
  ): RpBranchSnapshot {
    const graph = this.requireGraph(scope, baseRevision)
    const branch = graph.branches.get(branchId)
    if (branch === undefined) throw new RpBranchError(`RP branch ${JSON.stringify(branchId)} does not exist`, 'MISSING')
    if (branch.candidates.some(item => item.id === candidate.id)) {
      throw new RpBranchError(`RP swipe ${JSON.stringify(candidate.id)} already exists`, 'DUPLICATE')
    }
    const frozen = freezeCandidate(candidate)
    graph.branches.set(branchId, freezeBranch({
      ...branch,
      candidates: [...branch.candidates, frozen],
      ...(activate ? { activeCandidateId: frozen.id } : {}),
    }))
    graph.revision += 1
    return this.publish(scope)
  }

  /**
   * Activate a branch and optionally one of its candidates.
   * @param scope - Branch lifecycle scope.
   * @param baseRevision - Required current graph revision.
   * @param branchId - Target branch identity.
   * @param candidateId - Optional swipe identity.
   * @returns Newly committed graph.
   */
  activate(scope: RpScopeRef, baseRevision: number, branchId: string, candidateId?: string): RpBranchSnapshot {
    const graph = this.requireGraph(scope, baseRevision)
    const branch = graph.branches.get(branchId)
    if (branch === undefined) throw new RpBranchError(`RP branch ${JSON.stringify(branchId)} does not exist`, 'MISSING')
    if (candidateId !== undefined && !branch.candidates.some(candidate => candidate.id === candidateId)) {
      throw new RpBranchError(`RP swipe ${JSON.stringify(candidateId)} does not exist`, 'MISSING')
    }
    graph.activeBranchId = branchId
    graph.branches.set(branchId, freezeBranch({
      ...branch,
      ...(candidateId === undefined ? {} : { activeCandidateId: candidateId }),
    }))
    graph.revision += 1
    return this.publish(scope)
  }

  /**
   * Remove one inactive leaf branch.
   * @param scope - Branch lifecycle scope.
   * @param baseRevision - Required current graph revision.
   * @param branchId - Branch identity to remove.
   * @returns Newly committed graph.
   */
  remove(scope: RpScopeRef, baseRevision: number, branchId: string): RpBranchSnapshot {
    const graph = this.requireGraph(scope, baseRevision)
    if (branchId === graph.activeBranchId) throw new RpBranchError('The active RP branch cannot be removed', 'INVALID')
    if ([...graph.branches.values()].some(branch => branch.parentId === branchId)) {
      throw new RpBranchError('An RP branch with children cannot be removed', 'INVALID')
    }
    if (!graph.branches.delete(branchId)) throw new RpBranchError(`RP branch ${JSON.stringify(branchId)} does not exist`, 'MISSING')
    graph.revision += 1; return this.publish(scope)
  }

  private requireGraph(scope: RpScopeRef, revision: number): MutableGraph {
    const graph = this.graphs.get(scopeKey(scope))
    if (graph === undefined) throw new RpBranchError('RP branch graph does not exist', 'MISSING')
    if (graph.revision !== revision) {
      throw new RpBranchError(`RP branch revision ${graph.revision} does not match ${revision}`, 'REVISION')
    }
    return graph
  }

  private publish(scope: RpScopeRef): RpBranchSnapshot {
    const graph = this.graphs.get(scopeKey(scope))
    if (graph === undefined) throw new RpBranchError('RP branch graph does not exist', 'MISSING')
    const snapshot = freezeSnapshot(graph)
    this.ctx.emit('rp/branches-changed', freezeScope(scope), snapshot)
    return snapshot
  }
}

function freezeCandidate(candidate: RpSwipeCandidate): RpSwipeCandidate {
  if (candidate.id.length === 0 || candidate.message.length === 0) {
    throw new RpBranchError('RP swipe id and message must be non-empty', 'INVALID')
  }
  return Object.freeze({
    ...candidate,
    ...(candidate.metadata === undefined
      ? {}
      : { metadata: Object.freeze(structuredClone(candidate.metadata)) }),
  })
}

function freezeBranch(branch: RpBranchNode): RpBranchNode {
  if (branch.id.length === 0) throw new RpBranchError('RP branch id must be non-empty', 'INVALID')
  const candidates = Object.freeze(branch.candidates.map(freezeCandidate))
  if (branch.activeCandidateId !== undefined
    && !candidates.some(candidate => candidate.id === branch.activeCandidateId)) {
    throw new RpBranchError('Active swipe must exist in the branch', 'INVALID')
  }
  return Object.freeze({ ...branch, candidates })
}

function freezeSnapshot(graph: MutableGraph): RpBranchSnapshot {
  return Object.freeze({
    revision: graph.revision,
    activeBranchId: graph.activeBranchId,
    branches: Object.freeze([...graph.branches.values()].sort((a, b) => a.id.localeCompare(b.id))),
  })
}
function scopeKey(scope: RpScopeRef): string { return `${scope.kind}:${scope.id}` }
function freezeScope(scope: RpScopeRef): RpScopeRef {
  return Object.freeze({
    ...scope,
    ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }),
  })
}
export default RpBranchRuntime
