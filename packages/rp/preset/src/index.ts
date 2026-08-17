/** Durable scoped RP prompt presets and immutable turn snapshots. @module @dsh-rp/preset */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  CompatibilityEnvelope,
  JsonObject,
  JsonValue,
  PromptSectionIR,
  RpScopeRef,
} from '@dsh-rp/contracts'
import z from 'zod'

/** One normalized source prompt retained for inspection and export. */
export interface RpPresetPromptDefinition {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
  readonly marker: boolean
}

/** One complete source ordering profile retained without activation loss. */
export interface RpPresetPromptOrder {
  readonly id: string
  readonly entries: readonly { readonly identifier: string; readonly enabled: boolean }[]
}

/** Durable prompt preset independent of its source adapter. */
export interface RpPromptPresetRecord {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly promptDefinitions: readonly RpPresetPromptDefinition[]
  readonly promptOrders: readonly RpPresetPromptOrder[]
  readonly selectedPromptOrderId: string
  readonly prompts: readonly PromptSectionIR[]
  readonly generation: JsonObject
  readonly compatibility?: CompatibilityEnvelope
  readonly savedAt: number
}

/** Durable scope-to-preset selection. */
export interface RpPresetBinding {
  readonly schemaVersion: 1
  readonly scope: RpScopeRef
  readonly presetId: string
  readonly activatedAt: number
}

/** Exact active preset frozen before one Turn starts. */
export interface RpPresetSnapshot extends RpPromptPresetRecord {
  readonly snapshotHash: string
  readonly bindingScope: RpScopeRef
}

interface RpPresetState {
  readonly schemaVersion: 1
  readonly presets: readonly RpPromptPresetRecord[]
  readonly bindings: readonly RpPresetBinding[]
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
const promptSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), role: z.enum(['system', 'user', 'assistant']),
  content: z.string(), priority: z.number(), before: z.array(z.string()).optional(), after: z.array(z.string()).optional(),
}).strict() as z.ZodType<PromptSectionIR>
const definitionSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string(),
  role: z.enum(['system', 'user', 'assistant']), content: z.string(), marker: z.boolean(),
}).strict() as z.ZodType<RpPresetPromptDefinition>
const orderSchema = z.object({
  id: z.string().min(1),
  entries: z.array(z.object({ identifier: z.string().min(1), enabled: z.boolean() }).strict()),
}).strict() as z.ZodType<RpPresetPromptOrder>
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
const presetSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string().min(1),
  promptDefinitions: z.array(definitionSchema), promptOrders: z.array(orderSchema).min(1),
  selectedPromptOrderId: z.string().min(1), prompts: z.array(promptSchema), generation: jsonObjectSchema,
  compatibility: compatibilitySchema.optional(), savedAt: z.number().int().nonnegative(),
}).strict() as z.ZodType<RpPromptPresetRecord>
const bindingSchema = z.object({
  schemaVersion: z.literal(1), scope: scopeSchema, presetId: z.string().min(1), activatedAt: z.number().int().nonnegative(),
}).strict() as z.ZodType<RpPresetBinding>
const stateSchema = z.object({
  schemaVersion: z.literal(1), presets: z.array(presetSchema), bindings: z.array(bindingSchema),
}).strict() as z.ZodType<RpPresetState>

/** Storage-domain schema containing one atomically replaced preset catalog. */
export const RP_PRESET_DOMAIN = defineDomain({
  name: 'dsh_rp_presets',
  version: 1,
  tables: { state: domainTable<string, RpPresetState>(stateSchema) },
})

declare module '@deepseek-ai/cordis' {
  interface Context { rpPresets: RpPresetRuntime }
  interface Events {
    /**
     * Durable preset catalog or binding state changed.
     * @param action - Completed mutation kind.
     * @param id - Preset identity.
     * @mode emit
     */
    'rp/preset-changed'(action: 'saved' | 'removed' | 'activated' | 'deactivated', id: string): void
  }
}

/** Durable preset catalog with nearest-scope resolution and write-before-publish mutation. */
export class RpPresetRuntime {
  private state: RpPresetState
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly ctx: Context,
    private readonly table: KvTable<string, RpPresetState>,
  ) {
    const loaded = table.get('current') ?? { schemaVersion: 1, presets: [], bindings: [] }
    this.state = freezeState(loaded)
    assertState(this.state)
  }

  /**
   * Read the detached durable preset catalog.
   * @returns All durable presets in deterministic identity order.
   */
  list(): readonly RpPromptPresetRecord[] { return this.state.presets }

  /**
   * Read one durable preset by identity.
   * @param id - Preset identity.
   * @returns The durable preset when present.
   */
  get(id: string): RpPromptPresetRecord | undefined { return this.state.presets.find(item => item.id === id) }

  /**
   * Read the detached durable binding catalog.
   * @returns All exact scope bindings in deterministic scope order.
   */
  listBindings(): readonly RpPresetBinding[] { return this.state.bindings }

  /**
   * Save or replace one complete preset after durable publication.
   * @param record - Complete adapter-neutral preset.
   * @returns The frozen durable record.
   */
  save(record: RpPromptPresetRecord): Promise<RpPromptPresetRecord> {
    return this.enqueue(async () => {
      const stored = normalizePreset(record)
      const presets = this.state.presets.filter(item => item.id !== stored.id).concat(stored)
        .sort((left, right) => left.id.localeCompare(right.id))
      await this.publish({ ...this.state, presets }, 'saved', stored.id)
      return stored
    })
  }

  /**
   * Remove one preset and all exact bindings to it.
   * @param id - Preset identity.
   * @returns Whether a preset existed.
   */
  remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (this.get(id) === undefined) return false
      await this.publish({
        ...this.state,
        presets: this.state.presets.filter(item => item.id !== id),
        bindings: this.state.bindings.filter(item => item.presetId !== id),
      }, 'removed', id)
      return true
    })
  }

  /**
   * Bind a saved preset to one exact scope.
   * @param scope - Binding owner.
   * @param presetId - Existing preset identity.
   * @returns Frozen exact binding.
   */
  activate(scope: RpScopeRef, presetId: string): Promise<RpPresetBinding> {
    return this.enqueue(async () => {
      if (this.get(presetId) === undefined) throw new Error(`RP preset ${JSON.stringify(presetId)} is not saved`)
      const binding = freezeBinding({ schemaVersion: 1, scope, presetId, activatedAt: Date.now() })
      const key = rpPresetScopeKey(scope)
      const bindings = this.state.bindings.filter(item => rpPresetScopeKey(item.scope) !== key).concat(binding)
        .sort((left, right) => rpPresetScopeKey(left.scope).localeCompare(rpPresetScopeKey(right.scope)))
      await this.publish({ ...this.state, bindings }, 'activated', presetId)
      return binding
    })
  }

  /**
   * Remove one exact scope binding.
   * @param scope - Exact binding owner.
   * @returns Whether a binding existed.
   */
  deactivate(scope: RpScopeRef): Promise<boolean> {
    return this.enqueue(async () => {
      const key = rpPresetScopeKey(scope)
      const binding = this.state.bindings.find(item => rpPresetScopeKey(item.scope) === key)
      if (binding === undefined) return false
      await this.publish({
        ...this.state,
        bindings: this.state.bindings.filter(item => rpPresetScopeKey(item.scope) !== key),
      }, 'deactivated', binding.presetId)
      return true
    })
  }

  /**
   * Resolve the nearest active preset through the supplied scope ancestry.
   * @param scope - Current scope with optional parent chain.
   * @returns Exact binding and preset when one is active.
   */
  active(scope: RpScopeRef): { readonly binding: RpPresetBinding; readonly preset: RpPromptPresetRecord } | undefined {
    let current: RpScopeRef | undefined = scope
    while (current !== undefined) {
      const key = rpPresetScopeKey(current)
      const binding = this.state.bindings.find(item => rpPresetScopeKey(item.scope) === key)
      if (binding !== undefined) {
        const preset = this.get(binding.presetId)
        if (preset === undefined) throw new Error(`RP preset binding references missing preset ${JSON.stringify(binding.presetId)}`)
        return Object.freeze({ binding, preset })
      }
      current = current.parent
    }
    return undefined
  }

  /**
   * Freeze the nearest active preset for one Turn.
   * @param scope - Turn scope and ancestry.
   * @returns Content-addressed immutable snapshot, if active.
   */
  capture(scope: RpScopeRef): RpPresetSnapshot | undefined {
    const active = this.active(scope)
    if (active === undefined) return undefined
    const snapshotHash = createHash('sha256').update(stableJson({
      preset: active.preset,
      bindingScope: active.binding.scope,
    })).digest('hex')
    return Object.freeze({
      ...active.preset,
      snapshotHash,
      bindingScope: active.binding.scope,
    })
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.chain.then(job)
    this.chain = result.then(() => {}, () => {})
    return result
  }

  private async publish(
    state: RpPresetState,
    action: 'saved' | 'removed' | 'activated' | 'deactivated',
    id: string,
  ): Promise<void> {
    const frozen = freezeState(state)
    assertState(frozen)
    await this.table.put('current', frozen)
    this.state = frozen
    this.ctx.emit('rp/preset-changed', action, id)
  }
}

/**
 * Encode an exact binding scope without traversing its ancestry.
 * @param scope - Exact preset binding scope.
 * @returns Stable scope identity.
 */
export function rpPresetScopeKey(scope: RpScopeRef): string { return `${scope.kind}:${scope.id}` }

function assertState(state: RpPresetState): void {
  const ids = new Set<string>()
  for (const preset of state.presets) {
    if (ids.has(preset.id)) throw new Error(`RP preset state repeats ${JSON.stringify(preset.id)}`)
    ids.add(preset.id)
    if (!preset.promptOrders.some(order => order.id === preset.selectedPromptOrderId)) {
      throw new Error(`RP preset ${JSON.stringify(preset.id)} selected prompt order is missing`)
    }
    const definitionIds = new Set<string>()
    for (const definition of preset.promptDefinitions) {
      if (definitionIds.has(definition.id)) {
        throw new Error(`RP preset ${JSON.stringify(preset.id)} repeats prompt ${JSON.stringify(definition.id)}`)
      }
      definitionIds.add(definition.id)
    }
    const orderIds = new Set<string>()
    for (const order of preset.promptOrders) {
      if (orderIds.has(order.id)) {
        throw new Error(`RP preset ${JSON.stringify(preset.id)} repeats order ${JSON.stringify(order.id)}`)
      }
      orderIds.add(order.id)
      const entries = new Set<string>()
      for (const entry of order.entries) {
        if (entries.has(entry.identifier)) {
          throw new Error(`RP preset order ${JSON.stringify(order.id)} repeats prompt ${JSON.stringify(entry.identifier)}`)
        }
        if (!definitionIds.has(entry.identifier)) {
          throw new Error(`RP preset order ${JSON.stringify(order.id)} references missing prompt ${JSON.stringify(entry.identifier)}`)
        }
        entries.add(entry.identifier)
      }
    }
  }
  const scopes = new Set<string>()
  for (const binding of state.bindings) {
    const key = rpPresetScopeKey(binding.scope)
    if (scopes.has(key)) throw new Error(`RP preset state repeats scope ${JSON.stringify(key)}`)
    if (!ids.has(binding.presetId)) throw new Error(`RP preset binding references missing preset ${JSON.stringify(binding.presetId)}`)
    scopes.add(key)
  }
}

function freezeState(state: RpPresetState): RpPresetState {
  return Object.freeze({
    schemaVersion: 1,
    presets: Object.freeze(state.presets.map(freezePreset).sort((left, right) => left.id.localeCompare(right.id))),
    bindings: Object.freeze(state.bindings.map(freezeBinding)
      .sort((left, right) => rpPresetScopeKey(left.scope).localeCompare(rpPresetScopeKey(right.scope)))),
  })
}

function freezePreset(record: RpPromptPresetRecord): RpPromptPresetRecord {
  return Object.freeze({
    ...record,
    promptDefinitions: Object.freeze(record.promptDefinitions.map(item => Object.freeze({ ...item }))),
    promptOrders: Object.freeze(record.promptOrders.map(order => Object.freeze({
      id: order.id,
      entries: Object.freeze(order.entries.map(item => Object.freeze({ ...item }))),
    }))),
    prompts: Object.freeze(record.prompts.map(section => Object.freeze({
      ...section,
      ...(section.before === undefined ? {} : { before: Object.freeze([...section.before]) }),
      ...(section.after === undefined ? {} : { after: Object.freeze([...section.after]) }),
    }))),
    generation: freezeJsonObject(record.generation),
    ...(record.compatibility === undefined
      ? {}
      : { compatibility: freezeJsonObject(record.compatibility as unknown as JsonObject) as unknown as CompatibilityEnvelope }),
  })
}

/** Validate an editor/import record and rebuild the executable Prompt projection from its selected order. */
function normalizePreset(record: RpPromptPresetRecord): RpPromptPresetRecord {
  const parsed = presetSchema.parse(structuredClone(record))
  const definitions = new Map(parsed.promptDefinitions.map(item => [item.id, item]))
  const selected = parsed.promptOrders.find(order => order.id === parsed.selectedPromptOrderId)
  if (selected === undefined) {
    throw new Error(`RP preset ${JSON.stringify(parsed.id)} selected prompt order is missing`)
  }
  const prompts = selected.entries.flatMap((entry, priority) => {
    if (!entry.enabled) return []
    const definition = definitions.get(entry.identifier)
    if (definition === undefined) {
      throw new Error(`RP preset order ${JSON.stringify(selected.id)} references missing prompt ${JSON.stringify(entry.identifier)}`)
    }
    return [{
      schemaVersion: 1 as const,
      id: definition.id,
      role: definition.role,
      content: definition.content,
      priority,
    }]
  })
  const normalized = freezePreset({ ...parsed, prompts })
  assertState({ schemaVersion: 1, presets: [normalized], bindings: [] })
  return normalized
}

function freezeBinding(binding: RpPresetBinding): RpPresetBinding {
  return Object.freeze({ ...binding, scope: freezeScope(binding.scope) })
}

function freezeScope(scope: RpScopeRef): RpScopeRef {
  return Object.freeze({
    kind: scope.kind,
    id: scope.id,
    ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }),
  })
}

function freezeJsonObject(value: JsonObject): JsonObject { return freezeJson(structuredClone(value)) as JsonObject }
function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson)) as JsonValue
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freezeJson(child)])))
  }
  return value
}
function stableJson(value: JsonValue | { readonly preset: RpPromptPresetRecord; readonly bindingScope: RpScopeRef }): string {
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

export const name = 'rp-preset'
export const inject = ['storageDomain']

/** Open the durable preset catalog and provide its scoped runtime as one reversible plugin. */
export async function apply(ctx: Context): Promise<void> {
  const domain: Domain<typeof RP_PRESET_DOMAIN> = await ctx.storageDomain.open(RP_PRESET_DOMAIN)
  try {
    const runtime = new RpPresetRuntime(ctx, domain.table('state'))
    ctx.provide('rpPresets', runtime)
    ctx.effect(() => async () => { await domain.close() })
  } catch (error: unknown) {
    await domain.close()
    throw error
  }
}
