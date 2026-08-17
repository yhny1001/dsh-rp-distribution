/** Deterministic literal lore activation. @module @dsh-rp/lore */
import { Context, Service } from '@deepseek-ai/cordis'
import type { LoreEntryIR, LoreIR, RpScopeRef } from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpLore: RpLoreRuntime }
  interface Events {
    /**
     * Lorebook registrations changed in a scope.
     * @param scope - Lore lifecycle scope.
     * @mode emit
     */
    'rp/lore-changed'(scope: RpScopeRef): void
  }
}

/** One activated lore entry with its source book and literal matches. */
export interface RpLoreMatch {
  readonly bookId: string
  readonly entry: LoreEntryIR
  readonly matchedKeys: readonly string[]
}
/** Bounded lore activation query. */
export interface RpLoreQuery {
  readonly text: string
  readonly maxEntries?: number
  readonly maxCharacters?: number
}

/** Scoped registry and deterministic matcher for inert lorebooks. */
export class RpLoreRuntime extends Service {
  private readonly books = new Map<string, Map<string, LoreIR>>()
  constructor(ctx: Context) { super(ctx, 'rpLore') }

  /**
   * Register one immutable lorebook.
   * @param scope - Lore lifecycle scope.
   * @param book - Versioned inert lore data.
   * @returns Idempotent registration disposer.
   */
  register(scope: RpScopeRef, book: LoreIR): () => void {
    const key = scopeKey(scope)
    const table = this.books.get(key) ?? new Map<string, LoreIR>()
    if (table.has(book.id)) throw new Error(`RP lorebook ${JSON.stringify(book.id)} already exists in ${key}`)
    const stored = freezeBook(book)
    table.set(stored.id, stored)
    this.books.set(key, table)
    this.ctx.emit('rp/lore-changed', freezeScope(scope))
    let active = true
    return () => {
      if (!active) return
      active = false
      table.delete(stored.id)
      if (table.size === 0) this.books.delete(key)
      this.ctx.emit('rp/lore-changed', freezeScope(scope))
    }
  }

  /**
   * List lorebooks in deterministic id order.
   * @param scope - Lore lifecycle scope.
   * @returns Frozen lorebook list.
   */
  list(scope: RpScopeRef): readonly LoreIR[] {
    return Object.freeze(
      [...this.books.get(scopeKey(scope))?.values() ?? []].sort((a, b) => a.id.localeCompare(b.id)),
    )
  }

  /**
   * Match constant and literal-key lore within hard result bounds.
   * @param scope - Lore lifecycle scope.
   * @param query - Text and output limits.
   * @returns Frozen matches in priority order.
   */
  match(scope: RpScopeRef, query: RpLoreQuery): readonly RpLoreMatch[] {
    return matchLoreBooks(this.list(scope), query)
  }
}

/**
 * Match literal Lore against an immutable selected-book snapshot.
 * @param books - Selected normalized Lorebooks.
 * @param query - Text and output limits.
 * @returns Frozen matches in priority order.
 */
export function matchLoreBooks(books: readonly LoreIR[], query: RpLoreQuery): readonly RpLoreMatch[] {
  const haystack = query.text.normalize('NFKC').toLocaleLowerCase()
  const maxEntries = bound(query.maxEntries ?? 32, 1, 500)
  const maxCharacters = bound(query.maxCharacters ?? 16_000, 1, 500_000)
  const rows = books
    .flatMap(book => book.entries
      .filter(entry => entry.enabled)
      .flatMap((entry) => {
        const keys = entry.keys.filter(key => key.length > 0
          && haystack.includes(key.normalize('NFKC').toLocaleLowerCase()))
        const secondary = entry.secondaryKeys ?? []
        const secondaryMatch = secondary.length === 0
          || secondary.some(key => haystack.includes(key.normalize('NFKC').toLocaleLowerCase()))
        return entry.constant || (keys.length > 0 && secondaryMatch)
          ? [{ bookId: book.id, entry, matchedKeys: Object.freeze(keys) } satisfies RpLoreMatch]
          : []
      }))
    .sort((a, b) => b.entry.priority - a.entry.priority
      || a.bookId.localeCompare(b.bookId)
      || a.entry.id.localeCompare(b.entry.id))
  const result: RpLoreMatch[] = []
  let chars = 0
  for (const row of rows) {
    if (result.length >= maxEntries || chars + row.entry.content.length > maxCharacters) break
    result.push(Object.freeze(row))
    chars += row.entry.content.length
  }
  return Object.freeze(result)
}

function freezeBook(book: LoreIR): LoreIR {
  return Object.freeze({
    ...book,
    entries: Object.freeze(book.entries.map(entry => Object.freeze({
      ...entry,
      keys: Object.freeze([...entry.keys]),
      ...(entry.secondaryKeys === undefined
        ? {}
        : { secondaryKeys: Object.freeze([...entry.secondaryKeys]) }),
    }))),
  })
}
function scopeKey(scope: RpScopeRef): string { return `${scope.kind}:${scope.id}` }
function bound(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`RP lore bound must be between ${min} and ${max}`)
  }
  return value
}
function freezeScope(scope: RpScopeRef): RpScopeRef {
  return Object.freeze({
    ...scope,
    ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }),
  })
}
export default RpLoreRuntime
