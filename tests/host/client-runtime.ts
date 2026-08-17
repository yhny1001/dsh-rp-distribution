/** Minimal observable-store runtime for RP browser unit tests; Host composition is verified by built bundle checks. */

export type SessionId = string & { readonly __sessionId: unique symbol }

export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
  set(next: T): void
  update(mutator: (draft: T) => void): void
}

/** Create the synchronous store contract consumed by RP client controllers. */
export function createSnapshotStore<T>(initial: T): SnapshotStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of [...listeners]) listener() }
  return {
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      value = next
      notify()
    },
    update: (mutator) => {
      mutator(value)
      notify()
    },
  }
}
