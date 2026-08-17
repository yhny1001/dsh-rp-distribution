/** Atomic local storage for RP product catalogs and Session compositions. */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  adaptPresetToHarness,
  applyRuntimeEffect,
  bindSession,
  commitRuntimeTurn,
  defaultProductState,
  editTranscriptMessage,
  forkSessionProjection,
  importTranscriptHistory,
  mergeImportedEntities,
  normalizeEntity,
  normalizeProductState,
  recordOpeningMessage,
  recordTranscriptMessage,
  replaceRuntimeChoices,
  removeEntity,
  selectPrimaryCharacter,
  selectRuntimeChoice,
  upsertEntity,
  type ImportedProductEntities,
  type ProductEntityKind,
  type ProductState,
  type RuntimeLocation,
  type TranscriptRole,
} from './model.ts'

const STATE_FILE = 'product-state.json'
const ASSET_ID_PATTERN = /^avatar-[0-9a-f]{64}$/u
let synchronousReadCache: { readonly path: string; readonly millisecond: number; readonly state: ProductState } | undefined
const storeRegistry = (globalThis as typeof globalThis & { __dshRpProductStores?: Map<string, ProductStore> })
storeRegistry.__dshRpProductStores ??= new Map<string, ProductStore>()

export interface ProductAssetInput {
  readonly id: string
  readonly bytes: Uint8Array
}

/** Resolve the product-owned directory under the active Harness home. */
export function productDataRoot(): string {
  const home = process.env.DSH_HOME?.trim()
  return join(resolve(home === undefined || home === '' ? join(homedir(), '.dsh') : home), 'rp-product')
}

/** Resolve the one durable state document shared by Host and Agent entries. */
export function productStatePath(): string { return join(productDataRoot(), STATE_FILE) }

/** Resolve one immutable, hash-addressed product asset. */
export function productAssetPath(id: string): string {
  return assetPathAt(productDataRoot(), id)
}

function assetPathAt(root: string, id: string): string {
  if (!ASSET_ID_PATTERN.test(id)) throw new Error('invalid RP product asset id')
  return join(root, 'assets', `${id}.png`)
}

/** Read the latest state synchronously for per-request system prompt assembly. */
export function readProductStateSync(): ProductState {
  const path = productStatePath()
  const millisecond = Date.now()
  if (synchronousReadCache?.path === path && synchronousReadCache.millisecond === millisecond) return synchronousReadCache.state
  const state = existsSync(path)
    ? normalizeProductState(JSON.parse(readFileSync(path, 'utf8')) as unknown)
    : defaultProductState()
  synchronousReadCache = { path, millisecond, state }
  return state
}

/** Serialized mutation owner for the local product state document. */
export class ProductStore {
  private mutationTail: Promise<void> = Promise.resolve()
  private state: ProductState

  private constructor(private readonly path: string, state: ProductState) { this.state = state }

  /** Open the product store, returning default content when no file exists. */
  static async open(path = productStatePath()): Promise<ProductStore> {
    const existing = storeRegistry.__dshRpProductStores?.get(path)
    if (existing !== undefined) return existing
    let state = defaultProductState()
    try { state = normalizeProductState(JSON.parse(await readFile(path, 'utf8')) as unknown) }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const store = new ProductStore(path, state)
    storeRegistry.__dshRpProductStores?.set(path, store)
    return store
  }

  /** Return an immutable detached state snapshot. */
  snapshot(): ProductState { return structuredClone(this.state) }

  /** Create or update one catalog entity under optimistic revision control. */
  async upsert(kind: ProductEntityKind, value: unknown, baseRevision: number): Promise<ProductState> {
    return await this.mutate(() => upsertEntity(this.state, kind, normalizeEntity(kind, value), baseRevision))
  }

  /** Remove one catalog entity and repair every binding that referenced it. */
  async remove(kind: ProductEntityKind, id: string, baseRevision: number): Promise<ProductState> {
    return await this.mutate(() => removeEntity(this.state, kind, id, baseRevision))
  }

  /** Commit one Session's five-layer composition. */
  async bind(value: unknown, baseRevision: number): Promise<ProductState> {
    return await this.mutate(() => bindSession(this.state, value, baseRevision))
  }

  /** Commit one validated multi-file import as one revision. */
  async importBatch(imported: ImportedProductEntities, assets: readonly ProductAssetInput[], baseRevision: number): Promise<ProductState> {
    const snapshots = assets.map(asset => ({ id: asset.id, bytes: Uint8Array.from(asset.bytes) }))
    let result: ProductState | undefined
    await this.enqueue(async () => {
      const next = mergeImportedEntities(this.state, imported, baseRevision)
      for (const asset of snapshots) await writeAssetAtomic(dirname(this.path), asset)
      await writeAtomic(this.path, next)
      this.state = next
      result = structuredClone(next)
    })
    if (result === undefined) throw new Error('product import completed without a state result')
    return result
  }

  /** Create or refresh a Harness-native copy while retaining its ST source preset. */
  async adaptPreset(presetId: string, baseRevision: number): Promise<{ readonly state: ProductState; readonly presetId: string }> {
    let result: { readonly state: ProductState; readonly presetId: string } | undefined
    await this.enqueue(async () => {
      const adapted = adaptPresetToHarness(this.state, presetId, baseRevision)
      await writeAtomic(this.path, adapted.state)
      this.state = adapted.state
      result = { state: structuredClone(adapted.state), presetId: adapted.presetId }
    })
    if (result === undefined) throw new Error('preset adaptation completed without a result')
    return result
  }

  /** Persist the speaker selected when an append-origin message landed. */
  async observeMessage(sessionId: string, sourceSeq: number, role: TranscriptRole, createdAt: number): Promise<ProductState> {
    return await this.mutate(() => recordTranscriptMessage(this.state, sessionId, sourceSeq, role, createdAt), true)
  }

  /** Commit one Agent RP domain effect from a logged tool call. */
  async runtimeEffect(sessionId: string, callId: string, value: unknown, location?: RuntimeLocation): Promise<ProductState> {
    return await this.mutate(() => applyRuntimeEffect(this.state, sessionId, callId, value, Date.now(), location))
  }

  /** Atomically commit one Agent RP turn ledger and its optional choices. */
  async runtimeTurn(sessionId: string, callId: string, value: unknown, location?: RuntimeLocation): Promise<ProductState> {
    return await this.mutate(() => commitRuntimeTurn(this.state, sessionId, callId, value, Date.now(), location))
  }

  /** Replace structured choices proposed by one logged Agent RP tool call. */
  async runtimeChoices(sessionId: string, callId: string, title: unknown, choices: unknown, location?: RuntimeLocation): Promise<ProductState> {
    return await this.mutate(() => replaceRuntimeChoices(this.state, sessionId, callId, title, choices, location))
  }

  /** Mark one choice selected before its prompt is sent to the native Agent. */
  async selectChoice(sessionId: string, choiceId: string): Promise<ProductState> {
    return await this.mutate(() => selectRuntimeChoice(this.state, sessionId, choiceId))
  }

  /** Select one configured cast member as the next Agent RP speaker. */
  async primaryCharacter(sessionId: string, characterId: string): Promise<ProductState> {
    return await this.mutate(() => selectPrimaryCharacter(this.state, sessionId, characterId))
  }

  /** Clone RP projections into one already-created native Session fork. */
  async forkProjection(sourceSessionId: string, childSessionId: string, childEventCount: number, maxTurn: number): Promise<ProductState> {
    return await this.mutate(() => forkSessionProjection(this.state, sourceSessionId, childSessionId, childEventCount, maxTurn))
  }

  /** Commit a binding while serializing its cross-service activation and rollback. */
  async bindWithEffect(
    value: unknown,
    baseRevision: number,
    effect: (state: ProductState) => Promise<void>,
  ): Promise<ProductState> {
    let result: ProductState | undefined
    await this.enqueue(async () => {
      const previous = this.state
      const next = bindSession(previous, value, baseRevision)
      await writeAtomic(this.path, next)
      this.state = next
      try {
        await effect(structuredClone(next))
      } catch (error: unknown) {
        await writeAtomic(this.path, previous)
        this.state = previous
        throw error
      }
      result = structuredClone(next)
    })
    if (result === undefined) throw new Error('product binding effect completed without a state result')
    return result
  }

  /** Persist and append one character-card opening as one serialized activation. */
  async openingWithEffect(
    sessionId: string,
    sourceSeq: number,
    content: string,
    effect: () => void,
  ): Promise<ProductState> {
    return await this.mutateWithEffect(
      () => recordOpeningMessage(this.state, sessionId, sourceSeq, content),
      effect,
    )
  }

  /** Persist and append one validated Tavern chat history batch. */
  async historyWithEffect(
    sessionId: string,
    startSeq: number,
    messages: unknown,
    effect: () => void,
  ): Promise<ProductState> {
    return await this.mutateWithEffect(
      () => importTranscriptHistory(this.state, sessionId, startSeq, messages),
      effect,
    )
  }

  /** Persist and append one model-visible transcript replacement. */
  async editWithEffect(
    sessionId: string,
    sourceSeq: number,
    expectedEditRevision: number,
    content: string,
    replacementSeq: number,
    effect: () => void,
  ): Promise<ProductState> {
    return await this.mutateWithEffect(
      () => editTranscriptMessage(this.state, sessionId, sourceSeq, expectedEditRevision, content, replacementSeq),
      effect,
    )
  }

  private async mutate(factory: () => ProductState, allowUnchanged = false): Promise<ProductState> {
    let result: ProductState | undefined
    await this.enqueue(async () => {
      const next = factory()
      if (allowUnchanged && next === this.state) {
        result = structuredClone(this.state)
        return
      }
      await writeAtomic(this.path, next)
      this.state = next
      result = structuredClone(next)
    })
    if (result === undefined) throw new Error('product mutation completed without a state result')
    return result
  }

  private async mutateWithEffect(factory: () => ProductState, effect: () => void): Promise<ProductState> {
    let result: ProductState | undefined
    await this.enqueue(async () => {
      const previous = this.state
      const next = factory()
      await writeAtomic(this.path, next)
      this.state = next
      try {
        effect()
      } catch (error: unknown) {
        await writeAtomic(this.path, previous)
        this.state = previous
        throw error
      }
      result = structuredClone(next)
    })
    if (result === undefined) throw new Error('product mutation effect completed without a state result')
    return result
  }

  private async enqueue(task: () => Promise<void>): Promise<void> {
    const current = this.mutationTail.catch(() => undefined).then(task)
    this.mutationTail = current
    await current
  }
}

async function writeAtomic(path: string, state: ProductState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
    synchronousReadCache = { path, millisecond: Date.now(), state }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function writeAssetAtomic(root: string, asset: ProductAssetInput): Promise<void> {
  const path = assetPathAt(root, asset.id)
  if (existsSync(path)) return
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, asset.bytes, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
