/** Agent-plane prompt projection for one RP Studio Session composition. */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { PRODUCT_PROMPT_SEAT_COUNT, renderPromptLayer, renderRuntimeContext, resolveGenerationSettings, resolvePromptLayers } from './model.ts'
import { ProductStore, readProductStateSync } from './store.ts'

export const name = 'dsh-rp-product/agent'
export const inject = ['systemPrompt', 'agents', 'tools']

interface ProductAgentContext {
  readonly systemPrompt: {
    section(section: {
      readonly name: string
      readonly order: number
      readonly text: () => string
    }): () => void
  }
  readonly agents: { requireInitiator(): { readonly id: string } }
  readonly tools: { register(tool: ReturnType<typeof defineTool>): () => void }
  on(event: 'agent/request', listener: (
    payload: unknown,
    next: () => Promise<RequestConfig>,
  ) => Promise<RequestConfig>): () => void
  effect(factory: () => (() => void) | void, label?: string): unknown
}

interface RequestConfig {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly temperature?: number
  readonly maxTokens?: number
  readonly stop?: readonly string[]
}

export interface Config { readonly mode?: 'tavern' | 'agent' }

/** Register the ordered Prompt Manager stack and supported request generation settings. */
export function apply(ctx: ProductAgentContext, config: Config = {}): void {
  for (let index = 0; index < PRODUCT_PROMPT_SEAT_COUNT; index += 1) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: index === 0 ? 'deployment:persona' : `rp-product:preset-${String(index).padStart(2, '0')}`,
      order: index,
      text: () => {
        const agent = ctx.agents.requireInitiator()
        const layer = resolvePromptLayers(readProductStateSync(), agent.id)[index]
        return layer === undefined ? '' : renderPromptLayer(layer)
      },
    }), `dsh-rp-product: prompt slot ${String(index)}`)
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'rp-product:runtime-mode',
    order: PRODUCT_PROMPT_SEAT_COUNT + 10,
    text: () => config.mode === 'agent'
      ? `${'<rp-runtime-mode>Agent RP：使用已注册的 RP 领域工具维护世界、时间、场景、角色状态、关系、记忆与选项。任何在正文、progress、current_event 或其他输出格式中出现的时间推进、地点变化、世界事件、角色/Persona 状态、关系或记忆变化，都必须在最终回复前通过 rp_update_state 分项提交；文本标签不算状态提交。只提交本轮明确发生的变化，不重复写入未变化事实。除非用户明确要求不要选项或场景没有有意义的分支，每次非终局回复都应通过 rp_propose_choices 提供 2-4 个结构化选项。</rp-runtime-mode>'}\n${renderRuntimeContext(readProductStateSync(), ctx.agents.requireInitiator().id)}`
      : '<rp-runtime-mode>Tavern Chat：只生成角色对话与叙事，不主动维护结构化世界状态，也不虚构工具调用。</rp-runtime-mode>',
  }), 'dsh-rp-product: runtime mode prompt')

  ctx.effect(() => ctx.on('agent/request', async (_payload, next) => {
    const base = await next()
    const agent = ctx.agents.requireInitiator()
    const generation = resolveGenerationSettings(readProductStateSync(), agent.id)
    if (generation === undefined) return base
    return {
      ...base,
      ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
      ...(generation.maxTokens === undefined ? {} : { maxTokens: generation.maxTokens }),
      ...(generation.reasoningEffort === undefined ? {} : { reasoningEffort: generation.reasoningEffort }),
    }
  }), 'dsh-rp-product: preset generation settings')

  if (config.mode === 'agent') registerAgentTools(ctx)
}

function registerAgentTools(ctx: ProductAgentContext): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'rp_update_state',
    description: 'Commit one structured RP fact that actually changed this turn. Kinds: world, time, scene, character, persona, relationship, memory. Use a concise title and summary; data carries typed details such as time, location, weather, target, delta, or provenance.',
    parameters: {
      kind: { type: 'string', required: true, enum: ['world', 'time', 'scene', 'character', 'persona', 'relationship', 'memory'] },
      title: { type: 'string', required: true },
      summary: { type: 'string', required: true },
      data: { type: 'json', description: 'Structured JSON facts for the committed change.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('rp_update_state requires an Agent-owned call')
      const store = await ProductStore.open()
      const sessionId = String(exec.agent.id)
      const state = await store.runtimeEffect(sessionId, String(exec.callId), {
        kind: args.kind, title: args.title, summary: args.summary, data: args.data ?? {},
      })
      return { committed: true, sessionId, revision: state.runtimes[sessionId]?.revision ?? 0, kind: args.kind, title: args.title }
    },
  })), 'dsh-rp-product: Agent RP state tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'rp_propose_choices',
    description: 'Propose 1-8 concise user choices after the character reply when meaningful alternatives exist. Each option needs a stable id, visible label, and the exact user prompt submitted when clicked. Do not use for a trivial yes/no unless the scene benefits from explicit choices.',
    parameters: {
      title: { type: 'string', required: true },
      options: { type: 'json', required: true, description: 'Array of {id,label,prompt} objects.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('rp_propose_choices requires an Agent-owned call')
      const store = await ProductStore.open()
      const sessionId = String(exec.agent.id)
      const state = await store.runtimeChoices(sessionId, String(exec.callId), args.title, args.options)
      return { committed: true, sessionId, revision: state.runtimes[sessionId]?.revision ?? 0, optionCount: state.runtimes[sessionId]?.choices.length ?? 0 }
    },
  })), 'dsh-rp-product: Agent RP choices tool')
}
