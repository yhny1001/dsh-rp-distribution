/** Agent-plane prompt projection for one RP Studio Session composition. */

import { renderPromptLayer, resolvePromptLayers, type PromptLayerKind } from './model.ts'
import { readProductStateSync } from './store.ts'

export const name = 'dsh-rp-product/agent'
export const inject = ['systemPrompt', 'agents']

interface ProductAgentContext {
  readonly systemPrompt: {
    section(section: {
      readonly name: string
      readonly order: number
      readonly text: () => string
    }): () => void
  }
  readonly agents: { requireInitiator(): { readonly id: string } }
  effect(factory: () => (() => void) | void, label?: string): unknown
}

const SECTIONS: readonly { readonly kind: PromptLayerKind; readonly name: string; readonly order: number }[] = Object.freeze([
  { kind: 'system', name: 'deployment:persona', order: 0 },
  { kind: 'world', name: 'rp-product:world', order: 10 },
  { kind: 'character', name: 'rp-product:characters', order: 20 },
  { kind: 'persona', name: 'rp-product:user-persona', order: 30 },
  { kind: 'scene', name: 'rp-product:scene', order: 40 },
])

/** Register five independent dynamic system-prompt sections for every composed Session. */
export function apply(ctx: ProductAgentContext): void {
  for (const section of SECTIONS) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: section.name,
      order: section.order,
      text: () => {
        const agent = ctx.agents.requireInitiator()
        const layer = resolvePromptLayers(readProductStateSync(), agent.id).find(item => item.kind === section.kind)
        return layer === undefined ? '' : renderPromptLayer(layer)
      },
    }), `dsh-rp-product: ${section.kind} prompt layer`)
  }
}
