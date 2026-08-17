/** Deterministic prompt-section composition. @module @dsh-rp/prompt */
import { Context, Service } from '@deepseek-ai/cordis'
import type { PromptSectionIR, RpScopeRef } from '@dsh-rp/contracts'
declare module '@deepseek-ai/cordis' {
  interface Context { rpPrompt: RpPromptRuntime }
  interface Events {
    /**
     * Prompt section registrations changed in a scope.
     * @param scope - Prompt lifecycle scope.
     * @mode emit
     */
    'rp/prompt-changed'(scope: RpScopeRef): void
  }
}

/** Ordered prompt sections and their explicit serialized representation. */
export interface RpComposedPrompt { readonly sections: readonly PromptSectionIR[]; readonly text: string }
/** Prompt registration or dependency-graph failure. */
export class RpPromptError extends Error {
  /** Stable failure category. */
  readonly code: 'DUPLICATE' | 'MISSING' | 'CYCLE'
  constructor(message: string, code: RpPromptError['code']) { super(message); this.name = 'RpPromptError'; this.code = code }
}

/** Scoped prompt contribution registry with deterministic topological composition. */
export class RpPromptRuntime extends Service {
  private readonly sections = new Map<string, Map<string, PromptSectionIR>>()
  constructor(ctx: Context) { super(ctx, 'rpPrompt') }

  /**
   * Register one uniquely owned prompt section.
   * @param scope - Prompt lifecycle scope.
   * @param section - Versioned prompt contribution.
   * @returns Idempotent registration disposer.
   */
  register(scope: RpScopeRef, section: PromptSectionIR): () => void {
    const key = scopeKey(scope)
    const table = this.sections.get(key) ?? new Map<string, PromptSectionIR>()
    if (table.has(section.id)) {
      throw new RpPromptError(`RP prompt section ${JSON.stringify(section.id)} already exists`, 'DUPLICATE')
    }
    const stored = freezeSection(section)
    table.set(stored.id, stored)
    this.sections.set(key, table)
    this.ctx.emit('rp/prompt-changed', freezeScope(scope))
    let active = true
    return () => {
      if (!active) return
      active = false
      table.delete(stored.id)
      if (table.size === 0) this.sections.delete(key)
      this.ctx.emit('rp/prompt-changed', freezeScope(scope))
    }
  }

  /**
   * Compose registered and per-call sections without implicit overrides.
   * @param scope - Prompt lifecycle scope.
   * @param additional - Frozen per-call contributions.
   * @returns Ordered sections and serialized text.
   */
  compose(scope: RpScopeRef, additional: readonly PromptSectionIR[] = []): RpComposedPrompt {
    const all = [
      ...this.sections.get(scopeKey(scope))?.values() ?? [],
      ...additional.map(freezeSection),
    ]
    const byId = new Map<string, PromptSectionIR>()
    for (const section of all) {
      if (byId.has(section.id)) {
        throw new RpPromptError(`RP prompt section ${JSON.stringify(section.id)} is duplicated`, 'DUPLICATE')
      }
      byId.set(section.id, section)
    }
    const dependencies = new Map([...byId].map(([id, section]) => [id, new Set(section.after ?? [])]))
    for (const section of byId.values()) {
      for (const target of section.before ?? []) {
        const set = dependencies.get(target)
        if (set === undefined) {
          throw new RpPromptError(`RP prompt before target ${JSON.stringify(target)} is missing`, 'MISSING')
        }
        set.add(section.id)
      }
      for (const dependency of section.after ?? []) {
        if (!byId.has(dependency)) {
          throw new RpPromptError(`RP prompt dependency ${JSON.stringify(dependency)} is missing`, 'MISSING')
        }
      }
    }
    const remaining = new Set(byId.keys()); const ordered: PromptSectionIR[] = []
    while (remaining.size > 0) {
      const ready = [...remaining]
        .filter(id => [...dependencies.get(id) ?? []].every(dependency => !remaining.has(dependency)))
        .sort((a, b) => {
          const left = byId.get(a)
          const right = byId.get(b)
          if (left === undefined || right === undefined) {
            throw new RpPromptError('RP prompt ordering lost a registered section', 'MISSING')
          }
          return left.priority - right.priority || a.localeCompare(b)
        })
      if (ready.length === 0) throw new RpPromptError('RP prompt section constraints contain a cycle', 'CYCLE')
      for (const id of ready) {
        const section = byId.get(id)
        if (section === undefined) throw new RpPromptError('RP prompt ordering lost a registered section', 'MISSING')
        remaining.delete(id)
        ordered.push(section)
      }
    }
    return Object.freeze({
      sections: Object.freeze(ordered),
      text: ordered
        .map(section => `<rp-section id="${escapeAttribute(section.id)}" role="${section.role}">\n${section.content}\n</rp-section>`)
        .join('\n'),
    })
  }
}

function freezeSection(section: PromptSectionIR): PromptSectionIR {
  return Object.freeze({
    ...section,
    ...(section.before === undefined ? {} : { before: Object.freeze([...section.before]) }),
    ...(section.after === undefined ? {} : { after: Object.freeze([...section.after]) }),
  })
}
function scopeKey(scope: RpScopeRef): string { return `${scope.kind}:${scope.id}` }
function escapeAttribute(value: string): string { return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;') }
function freezeScope(scope: RpScopeRef): RpScopeRef {
  return Object.freeze({
    ...scope,
    ...(scope.parent === undefined ? {} : { parent: freezeScope(scope.parent) }),
  })
}
export default RpPromptRuntime
