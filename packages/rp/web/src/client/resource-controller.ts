/** Session-scoped RP asset and preset controller shared by the two conversation rails. */
import {
  createSnapshotStore,
  type SessionId,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { CharacterIR, LoreIR, PersonaIR } from '@dsh-rp/contracts'
import type {
  RpWebLibraryAssetDetailResponse,
  RpWebLibraryCatalogResponse,
  RpWebLibraryImportKind,
  RpWebLibraryMutationRequest,
  RpWebLibraryMutationResponse,
  RpWebPresetCatalogResponse,
  RpWebPresetDetailResponse,
  RpWebPresetDocument,
  RpWebPresetMutationRequest,
  RpWebPresetMutationResponse,
} from '../types.ts'

export type RpSessionImportKind = RpWebLibraryImportKind | 'preset'
export type RpSessionAssetKind = 'character' | 'persona' | 'lore'
export type RpResourceEditorKind = RpSessionAssetKind | 'preset'
export interface RpResourceEditorTarget { readonly kind: RpResourceEditorKind; readonly id: string }
export type RpResourceEditorDocument =
  | { readonly kind: 'character'; readonly asset: CharacterIR; readonly savedAt: number }
  | { readonly kind: 'persona'; readonly asset: PersonaIR; readonly savedAt: number }
  | { readonly kind: 'lore'; readonly asset: LoreIR; readonly savedAt: number }
  | { readonly kind: 'preset'; readonly preset: RpWebPresetDocument; readonly savedAt: number }

export interface RpResourceEditorState {
  readonly phase: 'closed' | 'loading' | 'ready' | 'saving' | 'error'
  readonly target: RpResourceEditorTarget | undefined
  readonly document: RpResourceEditorDocument | undefined
  readonly error: string | undefined
}

/** Detached resource state for one live browser Session. */
export interface RpWebResourceClientState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'mutating' | 'error'
  readonly library: RpWebLibraryCatalogResponse | undefined
  readonly presets: RpWebPresetCatalogResponse | undefined
  readonly importedFile: string | undefined
  readonly error: string | undefined
  readonly editor: RpResourceEditorState
}

interface ResourceEntry {
  readonly store: SnapshotStore<RpWebResourceClientState>
  abort: AbortController | undefined
  generation: number
}

const INITIAL: RpWebResourceClientState = Object.freeze({
  phase: 'idle',
  library: undefined,
  presets: undefined,
  importedFile: undefined,
  error: undefined,
  editor: Object.freeze({ phase: 'closed', target: undefined, document: undefined, error: undefined }),
})

/** Apply-scoped resource controller; never a process singleton. */
export class RpWebResourceController {
  private readonly entries = new Map<SessionId, ResourceEntry>()
  private disposed = false

  constructor(private readonly endpoint: string) {}

  storeFor(sessionId: SessionId): SnapshotStore<RpWebResourceClientState> {
    return this.entry(sessionId).store
  }

  /** Refresh both durable catalogs and their exact current-Session bindings. */
  async load(sessionId: SessionId, refresh = false): Promise<void> {
    const current = this.entry(sessionId).store.getSnapshot()
    if (!refresh && (current.phase === 'loading' || current.phase === 'ready' || current.phase === 'mutating')) return
    const entry = this.begin(sessionId, 'loading')
    const generation = entry.generation
    const signal = entry.abort?.signal
    try {
      const query = `?sessionId=${encodeURIComponent(sessionId)}`
      const [library, presets] = await Promise.all([
        this.request<RpWebLibraryCatalogResponse>(`${this.endpoint}/library${query}`, undefined, signal),
        this.request<RpWebPresetCatalogResponse>(`${this.endpoint}/presets${query}`, undefined, signal),
      ])
      if (!this.current(entry, generation)) return
      entry.abort = undefined
      entry.store.set(Object.freeze({
        phase: 'ready', library, presets, importedFile: undefined, error: undefined,
        editor: entry.store.getSnapshot().editor,
      }))
    } catch (reason: unknown) {
      this.fail(entry, generation, reason)
    }
  }

  /** Persist one file and immediately activate every resulting asset for this Session. */
  async importFile(sessionId: SessionId, kind: RpSessionImportKind, file: File): Promise<void> {
    const entry = this.begin(sessionId, 'mutating')
    const generation = entry.generation
    const signal = entry.abort?.signal
    try {
      if (kind === 'preset') {
        const saved = await this.mutatePreset({
          action: 'save', source: await file.text(), sourceId: file.name,
        }, signal)
        if (saved.presetId === undefined) throw new Error('Preset save did not return an id')
        const presets = await this.mutatePreset({
          action: 'activate', sessionId, presetId: saved.presetId,
        }, signal)
        if (!this.current(entry, generation)) return
        entry.abort = undefined
        entry.store.set(Object.freeze({
          phase: 'ready', library: entry.store.getSnapshot().library, presets,
          importedFile: file.name, error: undefined, editor: entry.store.getSnapshot().editor,
        }))
        return
      }

      const binary = kind === 'character-card-png' || kind === 'character-card-charx'
      const request: RpWebLibraryMutationRequest = {
        action: 'save', kind, sourceId: file.name,
        ...(binary ? { base64: await fileToBase64(file) } : { source: await file.text() }),
      }
      const saved = await this.mutateLibrary(request, signal)
      let library = saved
      for (const assetId of saved.assetIds) {
        const assetKind = savedAssetKind(saved, assetId)
        if (assetKind === undefined) continue
        library = await this.mutateLibrary({
          action: 'activate', sessionId, assetKind, assetId,
        }, signal)
      }
      if (!this.current(entry, generation)) return
      entry.abort = undefined
      entry.store.set(Object.freeze({
        phase: 'ready', library, presets: entry.store.getSnapshot().presets,
        importedFile: file.name, error: undefined, editor: entry.store.getSnapshot().editor,
      }))
    } catch (reason: unknown) {
      this.fail(entry, generation, reason)
    }
  }

  /** Toggle a saved Character, Persona, or Lorebook in the current composition. */
  async setAssetActive(
    sessionId: SessionId,
    assetKind: RpSessionAssetKind,
    assetId: string,
    active: boolean,
  ): Promise<void> {
    const entry = this.begin(sessionId, 'mutating')
    const generation = entry.generation
    try {
      const library = await this.mutateLibrary({
        action: active ? 'activate' : 'deactivate', sessionId, assetKind, assetId,
      }, entry.abort?.signal)
      if (!this.current(entry, generation)) return
      entry.abort = undefined
      entry.store.set(Object.freeze({
        phase: 'ready', library, presets: entry.store.getSnapshot().presets,
        importedFile: undefined, error: undefined, editor: entry.store.getSnapshot().editor,
      }))
    } catch (reason: unknown) {
      this.fail(entry, generation, reason)
    }
  }

  /** Activate one durable preset, or clear the current preset binding. */
  async setPresetActive(sessionId: SessionId, presetId: string | undefined): Promise<void> {
    const entry = this.begin(sessionId, 'mutating')
    const generation = entry.generation
    try {
      const request: RpWebPresetMutationRequest = presetId === undefined
        ? { action: 'deactivate', sessionId }
        : { action: 'activate', sessionId, presetId }
      const presets = await this.mutatePreset(request, entry.abort?.signal)
      if (!this.current(entry, generation)) return
      entry.abort = undefined
      entry.store.set(Object.freeze({
        phase: 'ready', library: entry.store.getSnapshot().library, presets,
        importedFile: undefined, error: undefined, editor: entry.store.getSnapshot().editor,
      }))
    } catch (reason: unknown) {
      this.fail(entry, generation, reason)
    }
  }

  /** Load one full resource document into the shared right-rail editor. */
  async openEditor(sessionId: SessionId, target: RpResourceEditorTarget): Promise<void> {
    const entry = this.begin(sessionId, 'loading')
    const generation = entry.generation
    entry.store.set(Object.freeze({
      ...entry.store.getSnapshot(),
      editor: Object.freeze({ phase: 'loading', target, document: undefined, error: undefined }),
    }))
    try {
      let document: RpResourceEditorDocument
      if (target.kind === 'preset') {
        const detail = await this.request<RpWebPresetDetailResponse>(
          `${this.endpoint}/presets?presetId=${encodeURIComponent(target.id)}`,
          undefined,
          entry.abort?.signal,
        )
        document = Object.freeze({
          kind: 'preset', preset: detail.preset, savedAt: detail.preset.savedAt,
        })
      } else {
        const query = `?assetKind=${encodeURIComponent(target.kind)}&assetId=${encodeURIComponent(target.id)}`
        const detail = await this.request<RpWebLibraryAssetDetailResponse>(
          `${this.endpoint}/library${query}`,
          undefined,
          entry.abort?.signal,
        )
        document = libraryEditorDocument(detail)
      }
      if (!this.current(entry, generation)) return
      entry.abort = undefined
      entry.store.set(Object.freeze({
        ...entry.store.getSnapshot(), phase: 'ready', error: undefined,
        editor: Object.freeze({ phase: 'ready', target, document, error: undefined }),
      }))
    } catch (reason: unknown) {
      this.fail(entry, generation, reason)
    }
  }

  /** Validate and durably replace the open resource without changing its identity or Session binding. */
  async saveEditor(sessionId: SessionId, document: RpResourceEditorDocument): Promise<void> {
    const snapshot = this.entry(sessionId).store.getSnapshot()
    const target = snapshot.editor.target
    if (target === undefined || target.kind !== document.kind) throw new Error('RP editor target changed before save')
    const documentId = document.kind === 'preset' ? document.preset.id : document.asset.id
    if (documentId !== target.id) throw new Error('RP editor cannot change a resource id')
    const entry = this.begin(sessionId, 'mutating')
    const generation = entry.generation
    entry.store.set(Object.freeze({
      ...entry.store.getSnapshot(),
      editor: Object.freeze({ phase: 'saving', target, document, error: undefined }),
    }))
    try {
      if (document.kind === 'preset') {
        const presets = await this.mutatePreset({
          action: 'update', sessionId, presetId: target.id, preset: document.preset,
        }, entry.abort?.signal)
        const detail = await this.request<RpWebPresetDetailResponse>(
          `${this.endpoint}/presets?presetId=${encodeURIComponent(target.id)}`,
          undefined,
          entry.abort?.signal,
        )
        if (!this.current(entry, generation)) return
        entry.abort = undefined
        entry.store.set(Object.freeze({
          ...entry.store.getSnapshot(), phase: 'ready', presets, error: undefined,
          editor: Object.freeze({
            phase: 'ready', target,
            document: Object.freeze({ kind: 'preset', preset: detail.preset, savedAt: detail.preset.savedAt }),
            error: undefined,
          }),
        }))
        return
      }
      const library = await this.mutateLibrary({
        action: 'update', sessionId, assetKind: document.kind, assetId: target.id, asset: document.asset,
      }, entry.abort?.signal)
      const query = `?assetKind=${encodeURIComponent(target.kind)}&assetId=${encodeURIComponent(target.id)}`
      const detail = await this.request<RpWebLibraryAssetDetailResponse>(
        `${this.endpoint}/library${query}`,
        undefined,
        entry.abort?.signal,
      )
      if (!this.current(entry, generation)) return
      entry.abort = undefined
      entry.store.set(Object.freeze({
        ...entry.store.getSnapshot(), phase: 'ready', library, error: undefined,
        editor: Object.freeze({ phase: 'ready', target, document: libraryEditorDocument(detail), error: undefined }),
      }))
    } catch (reason: unknown) {
      this.fail(entry, generation, reason)
    }
  }

  /** Close the editor and cancel only its current resource request. */
  closeEditor(sessionId: SessionId): void {
    const entry = this.entry(sessionId)
    entry.abort?.abort('RP resource editor closed')
    entry.abort = undefined
    entry.generation += 1
    const current = entry.store.getSnapshot()
    entry.store.set(Object.freeze({
      ...current,
      phase: current.library === undefined || current.presets === undefined ? 'idle' : 'ready',
      error: undefined,
      editor: Object.freeze({ phase: 'closed', target: undefined, document: undefined, error: undefined }),
    }))
  }

  prune(live: ReadonlySet<SessionId>): void {
    for (const [sessionId, entry] of this.entries) {
      if (live.has(sessionId)) continue
      entry.abort?.abort('Session removed')
      this.entries.delete(sessionId)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.entries.values()) entry.abort?.abort('RP resources disposed')
    this.entries.clear()
  }

  private entry(sessionId: SessionId): ResourceEntry {
    if (this.disposed) throw new Error('RP Web resource controller is disposed')
    let entry = this.entries.get(sessionId)
    if (entry === undefined) {
      entry = { store: createSnapshotStore(INITIAL), abort: undefined, generation: 0 }
      this.entries.set(sessionId, entry)
    }
    return entry
  }

  private begin(sessionId: SessionId, phase: 'loading' | 'mutating'): ResourceEntry {
    const entry = this.entry(sessionId)
    entry.abort?.abort('Superseded RP resource request')
    entry.abort = new AbortController()
    entry.generation += 1
    entry.store.set(Object.freeze({ ...entry.store.getSnapshot(), phase, importedFile: undefined, error: undefined }))
    return entry
  }

  private current(entry: ResourceEntry, generation: number): boolean {
    return !this.disposed && entry.generation === generation && entry.abort?.signal.aborted !== true
  }

  private fail(entry: ResourceEntry, generation: number, reason: unknown): void {
    if (!this.current(entry, generation)) return
    entry.abort = undefined
    const current = entry.store.getSnapshot()
    const message = reason instanceof Error ? reason.message : String(reason)
    entry.store.set(Object.freeze({
      ...current, phase: 'error', importedFile: undefined, error: message,
      editor: current.editor.phase === 'closed' ? current.editor : Object.freeze({
        ...current.editor, phase: 'error', error: message,
      }),
    }))
  }

  private async mutateLibrary(
    request: RpWebLibraryMutationRequest,
    signal?: AbortSignal,
  ): Promise<RpWebLibraryMutationResponse> {
    return await this.request(`${this.endpoint}/library`, jsonRequest(request), signal)
  }

  private async mutatePreset(
    request: RpWebPresetMutationRequest,
    signal?: AbortSignal,
  ): Promise<RpWebPresetMutationResponse> {
    return await this.request(`${this.endpoint}/presets`, jsonRequest(request), signal)
  }

  private async request<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
    const headers = new Headers(init?.headers)
    if (!headers.has('accept')) headers.set('accept', 'application/json')
    const response = await fetch(url, {
      ...init,
      headers,
      ...(signal === undefined ? {} : { signal }),
    })
    const value = await response.json() as T & { error?: string }
    if (!response.ok) throw new Error(value.error ?? `RP resource request failed (${response.status})`)
    return value
  }
}

function libraryEditorDocument(detail: RpWebLibraryAssetDetailResponse): RpResourceEditorDocument {
  if (detail.assetKind === 'character') {
    return Object.freeze({ kind: 'character', asset: detail.asset as CharacterIR, savedAt: detail.savedAt })
  }
  if (detail.assetKind === 'persona') {
    return Object.freeze({ kind: 'persona', asset: detail.asset as PersonaIR, savedAt: detail.savedAt })
  }
  return Object.freeze({ kind: 'lore', asset: detail.asset as LoreIR, savedAt: detail.savedAt })
}

function jsonRequest(value: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  }
}

function savedAssetKind(
  catalog: RpWebLibraryCatalogResponse,
  assetId: string,
): RpSessionAssetKind | undefined {
  if (catalog.characters.some(item => item.id === assetId)) return 'character'
  if (catalog.personas.some(item => item.id === assetId)) return 'persona'
  if (catalog.lorebooks.some(item => item.id === assetId)) return 'lore'
  return undefined
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}
