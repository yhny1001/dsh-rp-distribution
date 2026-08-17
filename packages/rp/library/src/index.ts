/** Durable RP asset library and scoped Turn snapshots. @module @dsh-rp/library */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  CharacterIR,
  CompatibilityEnvelope,
  JsonObject,
  JsonValue,
  LoreIR,
  PersonaIR,
  RpScopeRef,
} from '@dsh-rp/contracts'
import z from 'zod'

/** Asset families owned by the library. */
export type RpLibraryAssetKind = 'character' | 'persona' | 'lore'

/** One durable asset plus its latest save time. */
export interface RpLibraryAssetRecord<T extends CharacterIR | PersonaIR | LoreIR> {
  readonly asset: T
  readonly savedAt: number
}

/** One complete exact-scope selection for an asset family. */
export interface RpLibrarySelection {
  readonly schemaVersion: 1
  readonly scope: RpScopeRef
  readonly kind: RpLibraryAssetKind
  readonly assetIds: readonly string[]
  readonly activatedAt: number
}

/** Immutable active assets frozen at one Turn boundary. */
export interface RpLibrarySnapshot {
  readonly schemaVersion: 1
  readonly characters: readonly CharacterIR[]
  readonly personas: readonly PersonaIR[]
  readonly lorebooks: readonly LoreIR[]
  readonly bindingScopes: Readonly<Partial<Record<RpLibraryAssetKind, RpScopeRef>>>
  readonly snapshotHash: string
}

/** One atomic Creator import spanning any library asset families. */
export interface RpLibrarySaveBundle {
  readonly characters?: readonly CharacterIR[]
  readonly personas?: readonly PersonaIR[]
  readonly lorebooks?: readonly LoreIR[]
}

/** Records published by one atomic Creator import. */
export interface RpLibrarySaveResult {
  readonly characters: readonly RpLibraryAssetRecord<CharacterIR>[]
  readonly personas: readonly RpLibraryAssetRecord<PersonaIR>[]
  readonly lorebooks: readonly RpLibraryAssetRecord<LoreIR>[]
}

interface RpLibraryState {
  readonly schemaVersion: 1
  readonly characters: readonly RpLibraryAssetRecord<CharacterIR>[]
  readonly personas: readonly RpLibraryAssetRecord<PersonaIR>[]
  readonly lorebooks: readonly RpLibraryAssetRecord<LoreIR>[]
  readonly selections: readonly RpLibrarySelection[]
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number(), z.string(),
  z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema),
]))
const jsonObjectSchema = z.record(z.string(), jsonValueSchema) as z.ZodType<JsonObject>
const scopeSchema = z.lazy(() => z.object({
  kind: z.enum(['deployment', 'experience', 'profile', 'conversation', 'scene', 'turn', 'agent']),
  id: z.string().min(1),
  parent: scopeSchema.optional(),
}).strict()) as unknown as z.ZodType<RpScopeRef>
const compatibilitySchema = z.object({
  source: z.object({
    format: z.string(), sourceId: z.string().optional(), importedAt: z.number(), contentHash: z.string().optional(),
  }).strict(),
  unknownFields: jsonObjectSchema,
  warnings: z.array(z.string()).optional(),
  lossReport: z.object({
    schemaVersion: z.literal(1), losslessData: z.boolean(), executableBehaviorDisabled: z.boolean(),
    items: z.array(z.object({
      path: z.string(), feature: z.string(),
      disposition: z.enum(['preserved-inert', 'normalized', 'disabled', 'omitted']), reason: z.string(),
    }).strict()),
  }).strict().optional(),
}).strict() as z.ZodType<CompatibilityEnvelope>
const characterSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string().min(1),
  description: z.string().optional(), personality: z.string().optional(), scenario: z.string().optional(),
  firstMessages: z.array(z.string()), examples: z.array(z.string()).optional(), tags: z.array(z.string()).optional(),
  extensions: jsonObjectSchema.optional(), compatibility: compatibilitySchema.optional(),
}).strict() as z.ZodType<CharacterIR>
const personaSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string().min(1), description: z.string(),
  extensions: jsonObjectSchema.optional(), compatibility: compatibilitySchema.optional(),
}).strict() as z.ZodType<PersonaIR>
const loreEntrySchema = z.object({
  id: z.string().min(1), content: z.string(), keys: z.array(z.string()), secondaryKeys: z.array(z.string()).optional(),
  constant: z.boolean().optional(), enabled: z.boolean(), priority: z.number(), extensions: jsonObjectSchema.optional(),
}).strict()
const loreSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string().min(1),
  entries: z.array(loreEntrySchema), compatibility: compatibilitySchema.optional(),
}).strict() as z.ZodType<LoreIR>
const characterRecordSchema = z.object({ asset: characterSchema, savedAt: z.number().int().nonnegative() }).strict()
const personaRecordSchema = z.object({ asset: personaSchema, savedAt: z.number().int().nonnegative() }).strict()
const loreRecordSchema = z.object({ asset: loreSchema, savedAt: z.number().int().nonnegative() }).strict()
const selectionSchema = z.object({
  schemaVersion: z.literal(1), scope: scopeSchema, kind: z.enum(['character', 'persona', 'lore']),
  assetIds: z.array(z.string().min(1)), activatedAt: z.number().int().nonnegative(),
}).strict() as z.ZodType<RpLibrarySelection>
const stateSchema = z.object({
  schemaVersion: z.literal(1), characters: z.array(characterRecordSchema), personas: z.array(personaRecordSchema),
  lorebooks: z.array(loreRecordSchema), selections: z.array(selectionSchema),
}).strict() as z.ZodType<RpLibraryState>

/** Storage-domain schema containing the complete portable asset catalog. */
export const RP_LIBRARY_DOMAIN = defineDomain({
  name: 'dsh_rp_library',
  version: 1,
  tables: { state: domainTable<string, RpLibraryState>(stateSchema) },
})

declare module '@deepseek-ai/cordis' {
  interface Context { rpLibrary: RpLibraryRuntime }
  interface Events {
    /**
     * A durable asset or scope selection changed.
     * @param action - Completed mutation kind.
     * @param kind - Changed asset family.
     * @param id - Asset or scope identity.
     * @mode emit
     */
    'rp/library-changed'(action: 'saved' | 'removed' | 'selected', kind: RpLibraryAssetKind, id: string): void
  }
}

/** Durable asset catalog with exact-scope selections and per-Turn snapshots. */
export class RpLibraryRuntime {
  private state: RpLibraryState
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly ctx: Context,
    private readonly table: KvTable<string, RpLibraryState>,
  ) {
    this.state = freezeState(table.get('current') ?? emptyState())
    assertState(this.state)
  }

  /**
   * Read all saved Character records.
   * @returns Detached records ordered by id.
   */
  listCharacters(): readonly RpLibraryAssetRecord<CharacterIR>[] { return this.state.characters }

  /**
   * Read all saved Persona records.
   * @returns Detached records ordered by id.
   */
  listPersonas(): readonly RpLibraryAssetRecord<PersonaIR>[] { return this.state.personas }

  /**
   * Read all saved Lore records.
   * @returns Detached records ordered by id.
   */
  listLorebooks(): readonly RpLibraryAssetRecord<LoreIR>[] { return this.state.lorebooks }

  /**
   * Read every exact selection.
   * @returns Detached selections in deterministic order.
   */
  listSelections(): readonly RpLibrarySelection[] { return this.state.selections }

  /**
   * Save or replace one Character.
   * @param asset - Normalized Character IR.
   * @returns Frozen record.
   */
  saveCharacter(asset: CharacterIR): Promise<RpLibraryAssetRecord<CharacterIR>> {
    return this.saveAsset('character', characterSchema.parse(asset))
  }

  /**
   * Save or replace one Persona.
   * @param asset - Normalized Persona IR.
   * @returns Frozen record.
   */
  savePersona(asset: PersonaIR): Promise<RpLibraryAssetRecord<PersonaIR>> {
    return this.saveAsset('persona', personaSchema.parse(asset))
  }

  /**
   * Save or replace one Lorebook.
   * @param asset - Normalized Lore IR.
   * @returns Frozen record.
   */
  saveLore(asset: LoreIR): Promise<RpLibraryAssetRecord<LoreIR>> {
    return this.saveAsset('lore', loreSchema.parse(asset))
  }

  /**
   * Validate and publish a multi-asset import in one durable state replacement.
   * @param bundle - Complete normalized assets produced by one importer.
   * @returns Frozen saved records grouped by family.
   */
  saveBundle(bundle: RpLibrarySaveBundle): Promise<RpLibrarySaveResult> {
    const characters = (bundle.characters ?? []).map(asset => characterSchema.parse(asset))
    const personas = (bundle.personas ?? []).map(asset => personaSchema.parse(asset))
    const lorebooks = (bundle.lorebooks ?? []).map(asset => loreSchema.parse(asset))
    if (characters.length + personas.length + lorebooks.length === 0) {
      return Promise.reject(new Error('RP library save bundle is empty'))
    }
    uniqueAssetInput(characters, 'Character')
    uniqueAssetInput(personas, 'Persona')
    uniqueAssetInput(lorebooks, 'Lore')
    return this.enqueue(async () => {
      const savedAt = Date.now()
      const characterRecords = characters.map(asset => deepFreeze(structuredClone({ asset, savedAt })))
      const personaRecords = personas.map(asset => deepFreeze(structuredClone({ asset, savedAt })))
      const loreRecords = lorebooks.map(asset => deepFreeze(structuredClone({ asset, savedAt })))
      let state = this.state
      if (characterRecords.length > 0) state = replaceRecords(state, 'character', upsertRecords(state.characters, characterRecords))
      if (personaRecords.length > 0) state = replaceRecords(state, 'persona', upsertRecords(state.personas, personaRecords))
      if (loreRecords.length > 0) state = replaceRecords(state, 'lore', upsertRecords(state.lorebooks, loreRecords))
      await this.publishBatch(state, [
        ...characterRecords.map(record => ({ kind: 'character' as const, id: record.asset.id })),
        ...personaRecords.map(record => ({ kind: 'persona' as const, id: record.asset.id })),
        ...loreRecords.map(record => ({ kind: 'lore' as const, id: record.asset.id })),
      ])
      return deepFreeze({ characters: characterRecords, personas: personaRecords, lorebooks: loreRecords })
    })
  }

  /**
   * Remove one asset and every selection reference to it.
   * @param kind - Asset family.
   * @param id - Asset identity.
   * @returns Whether the asset existed.
   */
  remove(kind: RpLibraryAssetKind, id: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.has(kind, id)) return false
      const state = replaceRecords(this.state, kind, records(this.state, kind).filter(record => record.asset.id !== id))
      await this.publish({
        ...state,
        selections: state.selections.flatMap(selection => selection.kind !== kind
          ? [selection]
          : selection.assetIds.filter(assetId => assetId !== id).length === 0
            ? []
            : [{ ...selection, assetIds: selection.assetIds.filter(assetId => assetId !== id) }]),
      }, 'removed', kind, id)
      return true
    })
  }

  /**
   * Replace one exact scope selection atomically.
   * @param scope - Exact selection owner.
   * @param kind - Asset family.
   * @param assetIds - Complete ordered asset identities; Persona accepts at most one.
   * @returns Frozen selection, or undefined when cleared.
   */
  select(scope: RpScopeRef, kind: RpLibraryAssetKind, assetIds: readonly string[]): Promise<RpLibrarySelection | undefined> {
    return this.enqueue(() => this.replaceSelection(scope, kind, assetIds))
  }

  /**
   * Add one saved asset to an exact scope selection.
   * @param scope - Exact selection owner.
   * @param kind - Asset family.
   * @param id - Saved asset identity.
   * @returns Updated selection.
   */
  activate(scope: RpScopeRef, kind: RpLibraryAssetKind, id: string): Promise<RpLibrarySelection> {
    return this.enqueue(async () => {
      const exact = this.state.selections.find(selection => selectionKey(selection.scope, selection.kind) === selectionKey(scope, kind))
      const ids = kind === 'persona' ? [id] : [...exact?.assetIds ?? [], id]
      const selection = await this.replaceSelection(scope, kind, [...new Set(ids)])
      if (selection === undefined) throw new Error('RP library activation produced no selection')
      return selection
    })
  }

  /**
   * Remove one asset or the whole exact selection.
   * @param scope - Exact selection owner.
   * @param kind - Asset family.
   * @param id - Optional selected asset identity.
   * @returns Whether the exact selection changed.
   */
  deactivate(scope: RpScopeRef, kind: RpLibraryAssetKind, id?: string): Promise<boolean> {
    return this.enqueue(async () => {
      const exact = this.state.selections.find(selection => selectionKey(selection.scope, selection.kind) === selectionKey(scope, kind))
      if (exact === undefined || (id !== undefined && !exact.assetIds.includes(id))) return false
      const remaining = id === undefined ? [] : exact.assetIds.filter(assetId => assetId !== id)
      await this.replaceSelection(scope, kind, remaining)
      return true
    })
  }

  /**
   * Freeze the nearest selection for each asset family.
   * @param scope - Turn scope and ancestry.
   * @returns Content-addressed immutable snapshot when any family is active.
   */
  capture(scope: RpScopeRef): RpLibrarySnapshot | undefined {
    const characters = this.resolve(scope, 'character')
    const personas = this.resolve(scope, 'persona')
    const lore = this.resolve(scope, 'lore')
    if (characters === undefined && personas === undefined && lore === undefined) return undefined
    const snapshot = {
      schemaVersion: 1 as const,
      characters: Object.freeze(characters?.records.map(record => record.asset as CharacterIR) ?? []),
      personas: Object.freeze(personas?.records.map(record => record.asset as PersonaIR) ?? []),
      lorebooks: Object.freeze(lore?.records.map(record => record.asset as LoreIR) ?? []),
      bindingScopes: Object.freeze({
        ...(characters === undefined ? {} : { character: characters.scope }),
        ...(personas === undefined ? {} : { persona: personas.scope }),
        ...(lore === undefined ? {} : { lore: lore.scope }),
      }),
    }
    const snapshotHash = createHash('sha256').update(stableJson(snapshot)).digest('hex')
    return deepFreeze(structuredClone({ ...snapshot, snapshotHash }))
  }

  private resolve(scope: RpScopeRef, kind: RpLibraryAssetKind): {
    readonly scope: RpScopeRef
    readonly records: readonly RpLibraryAssetRecord<CharacterIR | PersonaIR | LoreIR>[]
  } | undefined {
    const selection = this.state.selections.find(item => selectionKey(item.scope, item.kind) === selectionKey(scope, kind))
    if (selection !== undefined) {
      const available = new Map(records(this.state, kind).map(record => [record.asset.id, record]))
      return Object.freeze({
        scope: freezeScope(scope),
        records: Object.freeze(selection.assetIds.map((id) => {
          const record = available.get(id)
          if (record === undefined) throw new Error(`RP library selection references missing ${kind} ${JSON.stringify(id)}`)
          return record
        })),
      })
    }
    return scope.parent === undefined ? undefined : this.resolve(scope.parent, kind)
  }

  private has(kind: RpLibraryAssetKind, id: string): boolean {
    return records(this.state, kind).some(record => record.asset.id === id)
  }

  private async replaceSelection(
    scope: RpScopeRef,
    kind: RpLibraryAssetKind,
    assetIds: readonly string[],
  ): Promise<RpLibrarySelection | undefined> {
    const unique = [...new Set(assetIds)]
    if (unique.length !== assetIds.length) throw new Error('RP library selection repeats an asset id')
    if (kind === 'persona' && unique.length > 1) throw new Error('RP library selection accepts at most one Persona')
    for (const id of unique) if (!this.has(kind, id)) throw new Error(`RP library ${kind} ${JSON.stringify(id)} is not saved`)
    const key = selectionKey(scope, kind)
    const base = this.state.selections.filter(selection => selectionKey(selection.scope, selection.kind) !== key)
    const selection = unique.length === 0 ? undefined : freezeSelection({
      schemaVersion: 1, scope, kind, assetIds: unique, activatedAt: Date.now(),
    })
    const selections = selection === undefined ? base : [...base, selection]
    await this.publish({ ...this.state, selections }, 'selected', kind, scopeKey(scope))
    return selection
  }

  private saveAsset<T extends CharacterIR | PersonaIR | LoreIR>(
    kind: RpLibraryAssetKind,
    asset: T,
  ): Promise<RpLibraryAssetRecord<T>> {
    return this.enqueue(async () => {
      const record = deepFreeze(structuredClone({ asset, savedAt: Date.now() }))
      const next = [...records(this.state, kind).filter(item => item.asset.id !== asset.id), record]
        .sort((left, right) => left.asset.id.localeCompare(right.asset.id))
      await this.publish(replaceRecords(this.state, kind, next), 'saved', kind, asset.id)
      return record
    })
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.chain.then(job)
    this.chain = result.then(() => {}, () => {})
    return result
  }

  private async publish(
    state: RpLibraryState,
    action: 'saved' | 'removed' | 'selected',
    kind: RpLibraryAssetKind,
    id: string,
  ): Promise<void> {
    const frozen = freezeState(state)
    assertState(frozen)
    await this.table.put('current', frozen)
    this.state = frozen
    this.ctx.emit('rp/library-changed', action, kind, id)
  }

  private async publishBatch(
    state: RpLibraryState,
    assets: readonly { readonly kind: RpLibraryAssetKind; readonly id: string }[],
  ): Promise<void> {
    const frozen = freezeState(state)
    assertState(frozen)
    await this.table.put('current', frozen)
    this.state = frozen
    for (const asset of assets) this.ctx.emit('rp/library-changed', 'saved', asset.kind, asset.id)
  }
}

function emptyState(): RpLibraryState {
  return { schemaVersion: 1, characters: [], personas: [], lorebooks: [], selections: [] }
}

function records(
  state: RpLibraryState,
  kind: RpLibraryAssetKind,
): readonly RpLibraryAssetRecord<CharacterIR | PersonaIR | LoreIR>[] {
  if (kind === 'character') return state.characters
  if (kind === 'persona') return state.personas
  return state.lorebooks
}

function replaceRecords(
  state: RpLibraryState,
  kind: RpLibraryAssetKind,
  value: readonly RpLibraryAssetRecord<CharacterIR | PersonaIR | LoreIR>[],
): RpLibraryState {
  if (kind === 'character') return { ...state, characters: value as readonly RpLibraryAssetRecord<CharacterIR>[] }
  if (kind === 'persona') return { ...state, personas: value as readonly RpLibraryAssetRecord<PersonaIR>[] }
  return { ...state, lorebooks: value as readonly RpLibraryAssetRecord<LoreIR>[] }
}

function assertState(state: RpLibraryState): void {
  const assetIds = new Map<RpLibraryAssetKind, Set<string>>([
    ['character', uniqueIds(state.characters, 'Character')],
    ['persona', uniqueIds(state.personas, 'Persona')],
    ['lore', uniqueIds(state.lorebooks, 'Lore')],
  ])
  const keys = new Set<string>()
  for (const selection of state.selections) {
    const key = selectionKey(selection.scope, selection.kind)
    if (keys.has(key)) throw new Error(`RP library repeats selection ${JSON.stringify(key)}`)
    if (selection.assetIds.length === 0) throw new Error(`RP library selection ${JSON.stringify(key)} is empty`)
    if (selection.kind === 'persona' && selection.assetIds.length > 1) throw new Error('RP library selection contains multiple Personas')
    const ids = assetIds.get(selection.kind)
    if (ids === undefined) throw new Error(`RP library has no asset family ${JSON.stringify(selection.kind)}`)
    for (const id of selection.assetIds) if (!ids.has(id)) throw new Error(`RP library selection references missing ${selection.kind} ${JSON.stringify(id)}`)
    keys.add(key)
  }
}

function uniqueIds(recordsValue: readonly RpLibraryAssetRecord<CharacterIR | PersonaIR | LoreIR>[], label: string): Set<string> {
  const ids = new Set<string>()
  for (const record of recordsValue) {
    if (ids.has(record.asset.id)) throw new Error(`RP library repeats ${label} ${JSON.stringify(record.asset.id)}`)
    ids.add(record.asset.id)
  }
  return ids
}

function uniqueAssetInput(assets: readonly (CharacterIR | PersonaIR | LoreIR)[], label: string): void {
  const ids = new Set<string>()
  for (const asset of assets) {
    if (ids.has(asset.id)) throw new Error(`RP library save repeats ${label} ${JSON.stringify(asset.id)}`)
    ids.add(asset.id)
  }
}

function upsertRecords<T extends CharacterIR | PersonaIR | LoreIR>(
  current: readonly RpLibraryAssetRecord<T>[],
  saved: readonly RpLibraryAssetRecord<T>[],
): readonly RpLibraryAssetRecord<T>[] {
  const ids = new Set(saved.map(record => record.asset.id))
  return [...current.filter(record => !ids.has(record.asset.id)), ...saved]
    .sort((left, right) => left.asset.id.localeCompare(right.asset.id))
}

function freezeState(state: RpLibraryState): RpLibraryState {
  return deepFreeze(stateSchema.parse(structuredClone(state)))
}

function freezeSelection(selection: RpLibrarySelection): RpLibrarySelection {
  return deepFreeze(selectionSchema.parse(structuredClone(selection)))
}

function scopeKey(scope: RpScopeRef): string { return `${scope.kind}:${scope.id}` }
function selectionKey(scope: RpScopeRef, kind: RpLibraryAssetKind): string { return `${scopeKey(scope)}:${kind}` }
function freezeScope(scope: RpScopeRef): RpScopeRef {
  return deepFreeze(structuredClone(scope))
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]))
    }
    return item
  }
  return JSON.stringify(normalize(value))
}

export const name = 'rp-library'
export const inject = ['storageDomain']

/** Open the durable asset catalog and provide it as one reversible service. */
export async function apply(ctx: Context): Promise<void> {
  const domain: Domain<typeof RP_LIBRARY_DOMAIN> = await ctx.storageDomain.open(RP_LIBRARY_DOMAIN)
  try {
    ctx.provide('rpLibrary', new RpLibraryRuntime(ctx, domain.table('state')))
    ctx.effect(() => async () => { await domain.close() })
  } catch (error: unknown) {
    await domain.close()
    throw error
  }
}
