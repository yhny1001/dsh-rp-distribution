/** Scoped character assets and bounded model-safe projections. @module @dsh-rp/character */
import { Context, Service } from '@deepseek-ai/cordis'
import type { CharacterIR, JsonValue, RpScopeRef } from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpCharacters: RpCharacterRuntime }
  interface Events {
    /**
     * Character registrations changed in one exact scope.
     * @param scope - Character lifecycle scope.
     * @mode emit
     */
    'rp/characters-changed'(scope: RpScopeRef): void
  }
}

/** Character fields intentionally eligible for model context. */
export interface RpCharacterContextEntry {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly personality?: string
  readonly scenario?: string
  readonly examples?: readonly string[]
  readonly tags?: readonly string[]
}

/** Hard bounds for a model-safe character projection. */
export interface RpCharacterContextQuery {
  readonly maxEntries?: number
  readonly maxCharacters?: number
}

/** Exact-scope character registry with detached storage and safe model views. */
export class RpCharacterRuntime extends Service {
  private readonly characters = new Map<string, Map<string, CharacterIR>>()

  constructor(ctx: Context) { super(ctx, 'rpCharacters') }

  /**
   * Register one immutable character in an exact scope.
   * @param scope - Character lifecycle scope.
   * @param character - Versioned character data.
   * @returns Idempotent registration disposer.
   */
  register(scope: RpScopeRef, character: CharacterIR): () => void {
    const key = scopeKey(scope)
    const table = this.characters.get(key) ?? new Map<string, CharacterIR>()
    validateCharacter(character)
    if (table.has(character.id)) {
      throw new Error(`RP character ${JSON.stringify(character.id)} already exists in ${key}`)
    }
    const stored = cloneAndFreeze(character)
    table.set(stored.id, stored)
    this.characters.set(key, table)
    this.ctx.emit('rp/characters-changed', freezeScope(scope))
    let active = true
    return () => {
      if (!active) return
      active = false
      table.delete(stored.id)
      if (table.size === 0) this.characters.delete(key)
      this.ctx.emit('rp/characters-changed', freezeScope(scope))
    }
  }

  /**
   * Read one character from an exact scope.
   * @param scope - Character lifecycle scope.
   * @param id - Character identifier.
   * @returns Frozen character or undefined.
   */
  get(scope: RpScopeRef, id: string): CharacterIR | undefined {
    return this.characters.get(scopeKey(scope))?.get(id)
  }

  /**
   * List characters from an exact scope in deterministic identifier order.
   * @param scope - Character lifecycle scope.
   * @returns Frozen character list.
   */
  list(scope: RpScopeRef): readonly CharacterIR[] {
    return Object.freeze(
      [...this.characters.get(scopeKey(scope))?.values() ?? []]
        .sort((left, right) => left.id.localeCompare(right.id)),
    )
  }

  /**
   * Project bounded character fields for an Agent or prompt consumer.
   * Compatibility envelopes, extensions, and greeting alternatives are never exposed.
   * @param scope - Character lifecycle scope.
   * @param query - Optional output bounds.
   * @returns Frozen safe context rows.
   */
  context(scope: RpScopeRef, query: RpCharacterContextQuery = {}): readonly RpCharacterContextEntry[] {
    return projectCharacterContext(this.list(scope), query)
  }
}

/**
 * Project model-safe Character fields from an immutable asset snapshot.
 * @param charactersValue - Selected normalized Characters.
 * @param query - Optional output bounds.
 * @returns Frozen safe context rows.
 */
export function projectCharacterContext(
  charactersValue: readonly CharacterIR[],
  query: RpCharacterContextQuery = {},
): readonly RpCharacterContextEntry[] {
  const maxEntries = bound(query.maxEntries ?? 32, 1, 256, 'entry')
  const maxCharacters = bound(query.maxCharacters ?? 32_000, 1, 500_000, 'character')
  const result: RpCharacterContextEntry[] = []
  let characters = 0
  for (const stored of charactersValue) {
    if (result.length >= maxEntries) break
    const row = contextEntry(stored)
    const size = JSON.stringify(row).length
    if (characters + size > maxCharacters) break
    result.push(row)
    characters += size
  }
  return Object.freeze(result)
}

function validateCharacter(character: CharacterIR): void {
  validateJsonData(character, 'character')
  const schemaVersion: unknown = (character as { readonly schemaVersion: unknown }).schemaVersion
  if (schemaVersion !== 1) throw new Error('RP character schemaVersion must be 1')
  validateLabel(character.id, 'id', 256)
  validateLabel(character.name, 'name', 1_000)
  validateOptionalText(character.description, 'description')
  validateOptionalText(character.personality, 'personality')
  validateOptionalText(character.scenario, 'scenario')
  validateStringList(character.firstMessages, 'firstMessages', 100)
  if (character.examples !== undefined) validateStringList(character.examples, 'examples', 1_000)
  if (character.tags !== undefined) validateStringList(character.tags, 'tags', 1_000, 1_000)
  const serialized = JSON.stringify(character)
  if (new TextEncoder().encode(serialized).byteLength > 4 * 1024 * 1024) {
    throw new Error('RP character exceeds the 4 MiB serialized limit')
  }
}

function contextEntry(character: CharacterIR): RpCharacterContextEntry {
  return Object.freeze({
    id: character.id,
    name: character.name,
    ...(character.description === undefined ? {} : { description: character.description }),
    ...(character.personality === undefined ? {} : { personality: character.personality }),
    ...(character.scenario === undefined ? {} : { scenario: character.scenario }),
    ...(character.examples === undefined ? {} : { examples: Object.freeze([...character.examples]) }),
    ...(character.tags === undefined ? {} : { tags: Object.freeze([...character.tags]) }),
  })
}

function validateOptionalText(value: string | undefined, field: string): void {
  if (value !== undefined && (typeof value !== 'string' || value.length > 1_000_000)) {
    throw new Error(`RP character ${field} must be a string of at most 1000000 characters`)
  }
}

function validateLabel(value: string, field: string, max: number): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new Error(`RP character ${field} must be a non-empty control-free string of at most ${max} characters`)
  }
}

function validateStringList(
  value: readonly string[],
  field: string,
  maxItems: number,
  maxItemCharacters = 1_000_000,
): void {
  if (!Array.isArray(value) || value.length > maxItems
    || value.some(item => typeof item !== 'string' || item.length > maxItemCharacters)) {
    throw new Error(`RP character ${field} must contain at most ${maxItems} bounded strings`)
  }
}

function validateJsonData(
  value: unknown,
  path: string,
  seen = new Set<object>(),
  budget = { nodes: 0 },
  depth = 0,
): asserts value is JsonValue {
  budget.nodes += 1
  if (budget.nodes > 100_000 || depth > 64) {
    throw new Error(`RP character ${path} exceeds the JSON structure budget`)
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error(`RP character ${path} contains a lossy number`)
    return
  }
  if (typeof value !== 'object') throw new Error(`RP character ${path} must be JSON data`)
  if (seen.has(value)) throw new Error(`RP character ${path} contains a cycle`)
  seen.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new Error(`RP character ${path} contains a sparse array`)
      validateJsonData(value[index], `${path}[${index}]`, seen, budget, depth + 1)
    }
  } else {
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`RP character ${path} must use a plain object`)
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new Error(`RP character ${path} contains a symbol key`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new Error(`RP character ${path}.${key} must be an enumerable data property`)
      }
      validateJsonData(descriptor.value, `${path}.${key}`, seen, budget, depth + 1)
    }
  }
  seen.delete(value)
}

function cloneAndFreeze(character: CharacterIR): CharacterIR {
  return deepFreeze(JSON.parse(JSON.stringify(character)) as CharacterIR)
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function bound(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`RP character ${label} bound must be between ${min} and ${max}`)
  }
  return value
}

function scopeKey(scope: RpScopeRef): string { return `${scope.kind}:${scope.id}` }
function freezeScope(scope: RpScopeRef): RpScopeRef {
  return Object.freeze({
    ...scope,
    ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }),
  })
}

export default RpCharacterRuntime
