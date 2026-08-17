/** Reversible registry for opaque-origin installable RP UI Slots. @module @dsh-rp/ui-slot-runtime */
import { Context, Service } from '@deepseek-ai/cordis'
import type { RpPackageId, RpTrustLevel, RpUiSlotManifest } from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpUiSlots: RpUiSlotRegistry }
  interface Events {
    /**
     * One package's public UI roster changed; observers may refresh their detached catalog.
     * @param packageId - Package whose UI contributions changed.
     * @mode emit
     */
    'rp/ui-slots-changed'(packageId: RpPackageId): void
  }
}

/** One immutable public UI contribution. Resource bytes remain Host-private. */
export interface RpUiSlotDefinition extends RpUiSlotManifest {
  readonly packageId: RpPackageId
  readonly packageVersion: string
  readonly trust: RpTrustLevel
}

/** One detached package resource returned to an HTTP carrier. */
export interface RpUiSlotResource {
  readonly path: string
  readonly bytes: Uint8Array
}

/** Activation input containing a definition and its integrity-verified resources. */
export interface RpUiSlotContribution {
  readonly definition: RpUiSlotDefinition
  readonly resources: readonly RpUiSlotResource[]
}

/** Stable UI registry failure. */
export class RpUiSlotError extends Error {
  constructor(message: string, readonly code: 'INVALID' | 'DUPLICATE' | 'MISSING') {
    super(message)
    this.name = 'RpUiSlotError'
  }
}

interface StoredSlot {
  readonly definition: RpUiSlotDefinition
  readonly resources: ReadonlyMap<string, Uint8Array>
}

/** Host-owned dynamic Slot registry. Every registration has one idempotent disposer. */
export class RpUiSlotRegistry extends Service {
  private readonly slots = new Map<string, StoredSlot>()

  constructor(ctx: Context) { super(ctx, 'rpUiSlots') }

  /**
   * Register one package frame and copy every resource across the trust boundary.
   * @param contribution - Immutable definition and integrity-verified resource bytes.
   * @returns Idempotent disposer that removes exactly this live contribution.
   */
  register(contribution: RpUiSlotContribution): () => void {
    const definition = freezeDefinition(contribution.definition)
    const key = slotKey(definition.packageId, definition.id)
    if (this.slots.has(key)) throw new RpUiSlotError(`RP UI Slot ${key} is already registered`, 'DUPLICATE')
    const allowed = new Set(definition.assets)
    const resources = new Map<string, Uint8Array>()
    for (const resource of contribution.resources) {
      const path = safePath(resource.path)
      if (!allowed.has(path)) throw new RpUiSlotError(`RP UI resource ${JSON.stringify(path)} is not declared by Slot ${key}`, 'INVALID')
      if (resources.has(path)) throw new RpUiSlotError(`RP UI Slot ${key} repeats resource ${JSON.stringify(path)}`, 'INVALID')
      if (!(resource.bytes instanceof Uint8Array)) throw new RpUiSlotError(`RP UI resource ${JSON.stringify(path)} has invalid bytes`, 'INVALID')
      resources.set(path, Uint8Array.from(resource.bytes))
    }
    const missing = definition.assets.find(path => !resources.has(path))
    if (missing !== undefined) throw new RpUiSlotError(`RP UI Slot ${key} is missing resource ${JSON.stringify(missing)}`, 'MISSING')
    const stored = Object.freeze({ definition, resources })
    this.slots.set(key, stored)
    this.ctx.emit('rp/ui-slots-changed', definition.packageId)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.slots.get(key) !== stored) return
      this.slots.delete(key)
      this.ctx.emit('rp/ui-slots-changed', definition.packageId)
    }
  }

  /**
   * Produce the deterministic detached catalog.
   * @returns Immutable public definitions sorted by placement, package, and Slot id.
   */
  list(): readonly RpUiSlotDefinition[] {
    return Object.freeze([...this.slots.values()]
      .map(slot => slot.definition)
      .sort((left, right) => `${left.placement}:${String(left.packageId)}:${left.id}`
        .localeCompare(`${right.placement}:${String(right.packageId)}:${right.id}`)))
  }

  /**
   * Resolve one immutable public definition.
   * @param packageId - Owning package id.
   * @param id - Package-local Slot id.
   * @returns The live definition, or undefined when it is absent.
   */
  get(packageId: string, id: string): RpUiSlotDefinition | undefined {
    return this.slots.get(slotKey(packageId, id))?.definition
  }

  /**
   * Return detached bytes only when both Slot and resource are declared and still live.
   * @param packageId - Owning package id.
   * @param id - Package-local Slot id.
   * @param path - Exact declared resource path.
   * @returns A defensive byte copy, or undefined when the resource is absent.
   */
  resource(packageId: string, id: string, path: string): Uint8Array | undefined {
    const normalized = safePath(path)
    const value = this.slots.get(slotKey(packageId, id))?.resources.get(normalized)
    return value?.slice()
  }
}

function freezeDefinition(value: RpUiSlotDefinition): RpUiSlotDefinition {
  for (const [label, candidate] of [['package id', value.packageId], ['version', value.packageVersion], ['id', value.id], ['title', value.title]] as const) {
    if (typeof candidate !== 'string' || candidate.trim() === '' || candidate !== candidate.trim() || candidate.length > 256) {
      throw new RpUiSlotError(`RP UI Slot ${label} must be a normalized string of at most 256 characters`, 'INVALID')
    }
  }
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(String(value.packageId))) {
    throw new RpUiSlotError('RP UI Slot package id is invalid', 'INVALID')
  }
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value.packageVersion)) {
    throw new RpUiSlotError('RP UI Slot package version is not exact SemVer', 'INVALID')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value.id)) {
    throw new RpUiSlotError('RP UI Slot id contains unsupported syntax', 'INVALID')
  }
  if (/[\u0000-\u001f\u007f]/u.test(value.title)) throw new RpUiSlotError('RP UI Slot title contains controls', 'INVALID')
  if (!['studio.overview', 'studio.creator', 'studio.inspector', 'conversation.sidebar', 'message.after'].includes(value.placement)) {
    throw new RpUiSlotError(`RP UI Slot placement ${JSON.stringify(value.placement)} is unsupported`, 'INVALID')
  }
  if (value.script !== 'none') throw new RpUiSlotError('Runtime v1 RP UI Slots cannot execute browser script', 'INVALID')
  const assets = value.assets.map(safePath)
  if (assets.length === 0 || new Set(assets).size !== assets.length) throw new RpUiSlotError('RP UI Slot assets must be non-empty and unique', 'INVALID')
  const entry = safePath(value.entry)
  if (!entry.toLowerCase().endsWith('.html') || !assets.includes(entry)) {
    throw new RpUiSlotError('RP UI Slot entry must be a declared .html asset', 'INVALID')
  }
  if (value.height !== undefined && (!Number.isSafeInteger(value.height) || value.height < 120 || value.height > 1600)) {
    throw new RpUiSlotError('RP UI Slot height must be an integer from 120 through 1600', 'INVALID')
  }
  return Object.freeze({ ...value, entry, assets: Object.freeze(assets) })
}

function slotKey(packageId: string, id: string): string { return `${packageId}:${id}` }

function safePath(value: string): string {
  if (typeof value !== 'string' || value === '' || value.startsWith('/') || value.includes('\\')
    || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RpUiSlotError(`RP UI resource path ${JSON.stringify(value)} is unsafe`, 'INVALID')
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new RpUiSlotError(`RP UI resource path ${JSON.stringify(value)} is unsafe`, 'INVALID')
  }
  return value
}

/** Cordis plugin name. */
export const name = 'rp-ui-slot-runtime'
/** No dependencies: package lifecycle adapters inject this service explicitly. */
export const inject: readonly string[] = []
/** Install the Host registry service. */
export function apply(ctx: Context): void { ctx.plugin(RpUiSlotRegistry) }

export default RpUiSlotRegistry
