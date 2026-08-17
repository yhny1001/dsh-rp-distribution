/** Scoped persona assets and bounded model-safe projections. @module @dsh-rp/persona */
import { Context, Service } from '@deepseek-ai/cordis'
import type { JsonValue, PersonaIR, RpScopeRef } from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpPersonas: RpPersonaRuntime }
  interface Events {
    /**
     * Persona registrations changed in one exact scope.
     * @param scope - Persona lifecycle scope.
     * @mode emit
     */
    'rp/personas-changed'(scope: RpScopeRef): void
  }
}

/** Persona fields intentionally eligible for model context. */
export interface RpPersonaContextEntry {
  readonly id: string
  readonly name: string
  readonly description: string
}

/** Hard bounds for a model-safe persona projection. */
export interface RpPersonaContextQuery {
  readonly maxEntries?: number
  readonly maxCharacters?: number
}

/** Exact-scope persona registry with detached storage and safe model views. */
export class RpPersonaRuntime extends Service {
  private readonly personas = new Map<string, Map<string, PersonaIR>>()

  constructor(ctx: Context) { super(ctx, 'rpPersonas') }

  /**
   * Register one immutable persona in an exact scope.
   * @param scope - Persona lifecycle scope.
   * @param persona - Versioned persona data.
   * @returns Idempotent registration disposer.
   */
  register(scope: RpScopeRef, persona: PersonaIR): () => void {
    const key = scopeKey(scope)
    const table = this.personas.get(key) ?? new Map<string, PersonaIR>()
    validatePersona(persona)
    if (table.has(persona.id)) {
      throw new Error(`RP persona ${JSON.stringify(persona.id)} already exists in ${key}`)
    }
    const stored = cloneAndFreeze(persona)
    table.set(stored.id, stored)
    this.personas.set(key, table)
    this.ctx.emit('rp/personas-changed', freezeScope(scope))
    let active = true
    return () => {
      if (!active) return
      active = false
      table.delete(stored.id)
      if (table.size === 0) this.personas.delete(key)
      this.ctx.emit('rp/personas-changed', freezeScope(scope))
    }
  }

  /**
   * Read one persona from an exact scope.
   * @param scope - Persona lifecycle scope.
   * @param id - Persona identifier.
   * @returns Frozen persona or undefined.
   */
  get(scope: RpScopeRef, id: string): PersonaIR | undefined {
    return this.personas.get(scopeKey(scope))?.get(id)
  }

  /**
   * List personas from an exact scope in deterministic identifier order.
   * @param scope - Persona lifecycle scope.
   * @returns Frozen persona list.
   */
  list(scope: RpScopeRef): readonly PersonaIR[] {
    return Object.freeze(
      [...this.personas.get(scopeKey(scope))?.values() ?? []]
        .sort((left, right) => left.id.localeCompare(right.id)),
    )
  }

  /**
   * Project bounded persona fields for an Agent or prompt consumer.
   * Compatibility envelopes and extensions are never exposed.
   * @param scope - Persona lifecycle scope.
   * @param query - Optional output bounds.
   * @returns Frozen safe context rows.
   */
  context(scope: RpScopeRef, query: RpPersonaContextQuery = {}): readonly RpPersonaContextEntry[] {
    return projectPersonaContext(this.list(scope), query)
  }
}

/**
 * Project model-safe Persona fields from an immutable asset snapshot.
 * @param personasValue - Selected normalized Personas.
 * @param query - Optional output bounds.
 * @returns Frozen safe context rows.
 */
export function projectPersonaContext(
  personasValue: readonly PersonaIR[],
  query: RpPersonaContextQuery = {},
): readonly RpPersonaContextEntry[] {
  const maxEntries = bound(query.maxEntries ?? 8, 1, 64, 'entry')
  const maxCharacters = bound(query.maxCharacters ?? 8_000, 1, 100_000, 'character')
  const result: RpPersonaContextEntry[] = []
  let characters = 0
  for (const stored of personasValue) {
    if (result.length >= maxEntries) break
    const row = Object.freeze({ id: stored.id, name: stored.name, description: stored.description })
    const size = JSON.stringify(row).length
    if (characters + size > maxCharacters) break
    result.push(row)
    characters += size
  }
  return Object.freeze(result)
}

function validatePersona(persona: PersonaIR): void {
  validateJsonData(persona, 'persona')
  const schemaVersion: unknown = (persona as { readonly schemaVersion: unknown }).schemaVersion
  if (schemaVersion !== 1) throw new Error('RP persona schemaVersion must be 1')
  validateLabel(persona.id, 'id', 256)
  validateLabel(persona.name, 'name', 1_000)
  if (typeof persona.description !== 'string' || persona.description.length > 1_000_000) {
    throw new Error('RP persona description must be a string of at most 1000000 characters')
  }
  const serialized = JSON.stringify(persona)
  if (new TextEncoder().encode(serialized).byteLength > 2 * 1024 * 1024) {
    throw new Error('RP persona exceeds the 2 MiB serialized limit')
  }
}

function validateLabel(value: string, field: string, max: number): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new Error(`RP persona ${field} must be a non-empty control-free string of at most ${max} characters`)
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
    throw new Error(`RP persona ${path} exceeds the JSON structure budget`)
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error(`RP persona ${path} contains a lossy number`)
    return
  }
  if (typeof value !== 'object') throw new Error(`RP persona ${path} must be JSON data`)
  if (seen.has(value)) throw new Error(`RP persona ${path} contains a cycle`)
  seen.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new Error(`RP persona ${path} contains a sparse array`)
      validateJsonData(value[index], `${path}[${index}]`, seen, budget, depth + 1)
    }
  } else {
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`RP persona ${path} must use a plain object`)
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new Error(`RP persona ${path} contains a symbol key`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new Error(`RP persona ${path}.${key} must be an enumerable data property`)
      }
      validateJsonData(descriptor.value, `${path}.${key}`, seen, budget, depth + 1)
    }
  }
  seen.delete(value)
}

function cloneAndFreeze(persona: PersonaIR): PersonaIR {
  return deepFreeze(JSON.parse(JSON.stringify(persona)) as PersonaIR)
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
    throw new Error(`RP persona ${label} bound must be between ${min} and ${max}`)
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

export default RpPersonaRuntime
