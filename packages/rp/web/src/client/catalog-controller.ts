/** Apply-scoped browser projection of the RP Host catalog. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { RpWebCatalog } from '../types.ts'

/** Browser fetch lifecycle and the latest detached Host catalog. */
export type RpWebCatalogState =
  | { readonly status: 'loading' | 'error' }
  | { readonly status: 'ready'; readonly catalog: RpWebCatalog }

/** One request/cache owner shared by every RP Web surface in this plugin fiber. */
export class RpWebCatalogController {
  /** Observable snapshot shared by every native RP Web surface in this fiber. */
  readonly store: SnapshotStore<RpWebCatalogState> = createSnapshotStore<RpWebCatalogState>({ status: 'loading' })
  private request: Promise<void> | undefined
  private abort: AbortController | undefined
  private disposed = false

  constructor(private readonly endpoint: string) {}

  /**
   * Load once, or explicitly replace the cached catalog after a mutation.
   * @param refresh - Abort any older read and request a replacement snapshot.
   * @returns Completion of the active catalog request.
   */
  load(refresh = false): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (!refresh && this.store.getSnapshot().status === 'ready') return Promise.resolve()
    if (!refresh && this.request !== undefined) return this.request
    this.abort?.abort()
    const abort = new AbortController()
    this.abort = abort
    this.store.set({ status: 'loading' })
    const request = fetch(`${this.endpoint}/catalog`, {
      headers: { accept: 'application/json' },
      signal: abort.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`catalog ${response.status}`)
      return await response.json() as RpWebCatalog
    }).then(
      (catalog) => {
        if (!this.disposed && this.abort === abort) this.store.set({ status: 'ready', catalog })
      },
      () => {
        if (!this.disposed && this.abort === abort && !abort.signal.aborted) this.store.set({ status: 'error' })
      },
    ).finally(() => {
      if (this.request === request) this.request = undefined
    })
    this.request = request
    return request
  }

  /** Cancel in-flight work when Cordis tears down the owning plugin fiber. */
  dispose(): void {
    this.disposed = true
    this.abort?.abort()
    this.abort = undefined
    this.request = undefined
  }
}
