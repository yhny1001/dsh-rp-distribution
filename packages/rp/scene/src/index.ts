/** Scoped revisioned scene projection. @module @dsh-rp/scene */
import { Context, Service } from '@deepseek-ai/cordis'
import type { RpScopeRef, SceneIR } from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpScene: RpSceneRuntime }
  interface Events {
    /**
     * A live scene projection changed after its revision committed.
     * @param scope - Scene lifecycle scope.
     * @param snapshot - New frozen scene snapshot, or null after removal.
     * @mode emit
     */
    'rp/scene-runtime-changed'(scope: RpScopeRef, snapshot: RpSceneSnapshot | null): void
  }
}

/** Revisioned live scene value. */
export interface RpSceneSnapshot {
  readonly revision: number
  readonly scene: SceneIR
}

/** Conflict raised when a scene write is based on an obsolete revision. */
export class RpSceneConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`RP scene revision conflict: expected ${expected}, actual ${actual}`)
    this.name = 'RpSceneConflictError'
  }
}

/** Owner-scoped active-scene store with optimistic revisions. */
export class RpSceneRuntime extends Service {
  private readonly scenes = new Map<string, RpSceneSnapshot>()
  constructor(ctx: Context) { super(ctx, 'rpScene') }

  /**
   * Read the active scene for one scope.
   * @param scope - Scene lifecycle scope.
   * @returns Frozen scene snapshot, when present.
   */
  read(scope: RpScopeRef): RpSceneSnapshot | undefined { return this.scenes.get(scopeKey(scope)) }

  /**
   * Replace the complete active scene after an optimistic revision check.
   * @param scope - Scene lifecycle scope.
   * @param scene - Complete new scene value.
   * @param expectedRevision - Current revision expected by the writer.
   * @returns Committed frozen scene snapshot.
   */
  replace(scope: RpScopeRef, scene: SceneIR, expectedRevision: number = 0): RpSceneSnapshot {
    validateScene(scene)
    const key = scopeKey(scope)
    const actual = this.scenes.get(key)?.revision ?? 0
    if (expectedRevision !== actual) throw new RpSceneConflictError(expectedRevision, actual)
    const snapshot = Object.freeze({ revision: actual + 1, scene: freezeScene(scene) })
    this.scenes.set(key, snapshot)
    this.ctx.emit('rp/scene-runtime-changed', freezeScope(scope), snapshot)
    return snapshot
  }

  /**
   * Remove the active scene after an optimistic revision check.
   * @param scope - Scene lifecycle scope.
   * @param expectedRevision - Current revision expected by the writer.
   * @returns Whether an active scene was removed.
   */
  clear(scope: RpScopeRef, expectedRevision: number): boolean {
    const key = scopeKey(scope)
    const current = this.scenes.get(key)
    const actual = current?.revision ?? 0
    if (expectedRevision !== actual) throw new RpSceneConflictError(expectedRevision, actual)
    if (current === undefined) return false
    this.scenes.delete(key)
    this.ctx.emit('rp/scene-runtime-changed', freezeScope(scope), null)
    return true
  }
}

function validateScene(scene: SceneIR): void {
  if (scene.id.trim() === '' || scene.title.trim() === '') {
    throw new Error('RP scene schemaVersion, id, and title are required')
  }
  if (scene.participants.length > 1_000 || scene.participants.some(value => value.trim() === '')) {
    throw new Error('RP scene participants must contain at most 1000 non-empty ids')
  }
  if (new Set(scene.participants).size !== scene.participants.length) {
    throw new Error('RP scene participants must be unique')
  }
}

function freezeScene(scene: SceneIR): SceneIR {
  return Object.freeze({
    ...scene,
    participants: Object.freeze([...scene.participants]),
    ...(scene.extensions === undefined ? {} : { extensions: Object.freeze(structuredClone(scene.extensions)) }),
  })
}
function scopeKey(scope: RpScopeRef): string { return `${scope.kind}:${scope.id}` }
function freezeScope(scope: RpScopeRef): RpScopeRef {
  return Object.freeze({ ...scope, ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }) })
}

export default RpSceneRuntime
