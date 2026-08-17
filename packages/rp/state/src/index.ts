/** Scoped, owner-isolated RP state with atomic revision-checked patches. @module @dsh-rp/state */

import { Context, Service } from '@deepseek-ai/cordis'
import type { JsonObject, JsonValue, RpScopeRef, StateDocument, StatePatch, StatePatchOperation } from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpState: RpStateRuntime }
  interface Events {
    /**
     * A state document committed a new revision.
     * @param scope - State lifecycle scope.
     * @param document - Newly committed immutable state.
     * @mode emit
     */
    'rp/state-document-changed'(scope: RpScopeRef, document: StateDocument): void
  }
}

/** State lookup, ownership, revision, or JSON Pointer failure. */
export class RpStateError extends Error {
  /** Stable failure category. */
  readonly code: 'MISSING' | 'EXISTS' | 'REVISION' | 'OWNER' | 'POINTER' | 'TEST'
  constructor(message: string, code: RpStateError['code']) { super(message); this.name = 'RpStateError'; this.code = code }
}

/** Process-local state projection. Durable owners replay committed documents into this service. */
export class RpStateRuntime extends Service {
  private readonly documents = new Map<string, StateDocument>()
  constructor(ctx: Context) { super(ctx, 'rpState') }

  /**
   * Create revision zero for one scope and owner.
   * @param scope - State lifecycle scope.
   * @param owner - Component-owned state namespace.
   * @param value - Initial JSON object.
   * @returns Frozen revision-zero document.
   */
  initialize(scope: RpScopeRef, owner: string, value: JsonObject = {}): StateDocument {
    const key = stateKey(scope, owner)
    if (this.documents.has(key)) throw new RpStateError(`RP state ${JSON.stringify(key)} already exists`, 'EXISTS')
    const document = freezeDocument({ schemaVersion: 1, revision: 0, owner, value })
    this.documents.set(key, document)
    this.ctx.emit('rp/state-document-changed', freezeScope(scope), document)
    return document
  }

  /**
   * Read an immutable state document.
   * @param scope - State lifecycle scope.
   * @param owner - Component-owned state namespace.
   * @returns Frozen document when initialized.
   */
  read(scope: RpScopeRef, owner: string): StateDocument | undefined { return this.documents.get(stateKey(scope, owner)) }

  /**
   * Apply a complete patch to a detached clone, then publish exactly one new revision.
   * @param scope - State lifecycle scope.
   * @param patch - Revision-checked patch operations.
   * @returns Newly committed frozen document.
   */
  applyPatch(scope: RpScopeRef, patch: StatePatch): StateDocument {
    const key = stateKey(scope, patch.owner)
    const current = this.documents.get(key)
    if (current === undefined) throw new RpStateError(`RP state ${JSON.stringify(key)} does not exist`, 'MISSING')
    if (current.owner !== patch.owner) throw new RpStateError('RP state patch cannot cross owner boundaries', 'OWNER')
    if (current.revision !== patch.baseRevision) {
      throw new RpStateError(`RP state revision ${current.revision} does not match patch base ${patch.baseRevision}`, 'REVISION')
    }
    let next: JsonValue = cloneJson(current.value)
    for (const operation of patch.operations) next = applyOperation(next, operation)
    if (!isObject(next)) throw new RpStateError('RP state root must remain an object', 'POINTER')
    const document = freezeDocument({
      schemaVersion: 1,
      revision: current.revision + 1,
      owner: current.owner,
      value: next,
    })
    this.documents.set(key, document)
    this.ctx.emit('rp/state-document-changed', freezeScope(scope), document)
    return document
  }

  /**
   * Remove all documents owned by a scope when its lifecycle ends.
   * @param scope - State lifecycle scope.
   * @returns Number of removed owner documents.
   */
  release(scope: RpScopeRef): number {
    const prefix = `${scope.kind}:${scope.id}\u0000`
    let removed = 0
    for (const key of this.documents.keys()) {
      if (key.startsWith(prefix)) {
        this.documents.delete(key)
        removed += 1
      }
    }
    return removed
  }
}

function applyOperation(root: JsonValue, operation: StatePatchOperation): JsonValue {
  const tokens = pointerTokens(operation.path)
  if (tokens.length === 0) {
    if (operation.op === 'remove') throw new RpStateError('RP state root cannot be removed', 'POINTER')
    if (operation.op === 'test') {
      if (!equalJson(root, operation.value)) throw new RpStateError('RP state test failed at root', 'TEST')
      return root
    }
    return cloneJson(operation.value)
  }
  const next = cloneJson(root)
  let parent: JsonValue = next
  for (const token of tokens.slice(0, -1)) parent = childAt(parent, token)
  const leaf = tokens.at(-1) as string
  if (operation.op === 'test') {
    if (!equalJson(childAt(parent, leaf), operation.value)) {
      throw new RpStateError(`RP state test failed at ${operation.path}`, 'TEST')
    }
    return next
  }
  if (Array.isArray(parent)) {
    if (leaf === '-' && operation.op === 'add') parent.push(cloneJson(operation.value))
    else {
      const index = arrayIndex(leaf, parent.length, operation.op === 'add')
      if (operation.op === 'remove') parent.splice(index, 1)
      else if (operation.op === 'add') parent.splice(index, 0, cloneJson(operation.value))
      else parent[index] = cloneJson(operation.value)
    }
    return next
  }
  if (!isObject(parent)) throw new RpStateError(`RP state pointer ${operation.path} has a scalar parent`, 'POINTER')
  if (operation.op !== 'add' && !Object.hasOwn(parent, leaf)) {
    throw new RpStateError(`RP state pointer ${operation.path} does not exist`, 'POINTER')
  }
  if (operation.op === 'remove') Reflect.deleteProperty(parent, leaf)
  else parent[leaf] = cloneJson(operation.value)
  return next
}

function pointerTokens(path: string): string[] {
  if (path === '') return []
  if (!path.startsWith('/')) throw new RpStateError(`Invalid JSON Pointer ${JSON.stringify(path)}`, 'POINTER')
  return path.slice(1).split('/').map((token) => {
    if (/~(?:[^01]|$)/u.test(token)) throw new RpStateError(`Invalid JSON Pointer escape in ${JSON.stringify(path)}`, 'POINTER')
    const decoded = token.replace(/~1/gu, '/').replace(/~0/gu, '~')
    if (decoded === '__proto__' || decoded === 'prototype' || decoded === 'constructor') {
      throw new RpStateError(`Unsafe JSON Pointer segment ${JSON.stringify(decoded)}`, 'POINTER')
    }
    return decoded
  })
}

function childAt(parent: JsonValue, token: string): JsonValue {
  if (Array.isArray(parent)) return parent[arrayIndex(token, parent.length, false)] as JsonValue
  if (isObject(parent) && Object.hasOwn(parent, token)) return parent[token] as JsonValue
  throw new RpStateError(`RP state pointer segment ${JSON.stringify(token)} does not exist`, 'POINTER')
}

function arrayIndex(value: string, length: number, insertion: boolean): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new RpStateError(`Invalid RP state array index ${JSON.stringify(value)}`, 'POINTER')
  }
  const index = Number(value)
  if (!Number.isSafeInteger(index) || index < 0 || index >= length + (insertion ? 1 : 0)) {
    throw new RpStateError(`RP state array index ${value} is out of range`, 'POINTER')
  }
  return index
}

function stateKey(scope: RpScopeRef, owner: string): string {
  if (scope.id.length === 0 || owner.length === 0) throw new RpStateError('RP state scope id and owner must be non-empty', 'OWNER')
  return `${scope.kind}:${scope.id}\u0000${owner}`
}
function cloneJson<T extends JsonValue>(value: T): T { return structuredClone(value) }
function equalJson(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
function isObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function freezeDocument(document: StateDocument): StateDocument {
  return Object.freeze({ ...document, value: Object.freeze(cloneJson(document.value)) })
}
function freezeScope(scope: RpScopeRef): RpScopeRef {
  return Object.freeze({
    ...scope,
    ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }),
  })
}

export default RpStateRuntime
