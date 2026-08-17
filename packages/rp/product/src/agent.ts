/** Agent-plane prompt projection for one RP Studio Session composition. */

import { randomInt, randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { currentRuntimeEffects, PRODUCT_PROMPT_SEAT_COUNT, renderPromptLayer, renderRuntimeContext, resolveGenerationSettings, resolvePromptLayers } from './model.ts'
import type { ProductState, RuntimeLocation } from './model.ts'
import { ProductStore, readProductStateSync } from './store.ts'

export const name = 'dsh-rp-product/agent'
export const inject = ['systemPrompt', 'agents', 'tools', 'llm']

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
  readonly llm: {
    resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{
      readonly reasoning?: { readonly efforts: readonly { readonly id: string }[] }
    }>
  }
  on(event: 'agent/request', listener: (
    payload: { readonly signal: AbortSignal },
    next: () => Promise<RequestConfig>,
  ) => Promise<RequestConfig>): () => void
  on(event: 'agent/inbox/claimed', listener: (payload: { readonly agent: StateKeeperAgent; readonly turn: number }) => void): () => void
  on(event: 'agent/turn-stopping', listener: (payload: { readonly agent: StateKeeperAgent; readonly turn: number }) => Promise<void> | void): () => void
  effect(factory: () => (() => void) | void, label?: string): unknown
}

interface StateKeeperAgent {
  readonly id: string
  steer(message: {
    readonly id: string
    readonly role: 'user'
    readonly content: readonly { readonly type: 'text'; readonly text: string }[]
    readonly source: { readonly kind: 'plugin'; readonly plugin: '@dsh-rp/product'; readonly form: 'instructions' }
  }): void
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
    text: () => {
      if (config.mode !== 'agent') return '<rp-runtime-mode>Tavern Chat：只生成角色对话与叙事，不主动维护结构化世界状态，也不虚构工具调用。</rp-runtime-mode>'
      const state = readProductStateSync()
      const sessionId = ctx.agents.requireInitiator().id
      return `${'<rp-runtime-mode>Agent RP：把每轮视为世界 Ledger 的 N→N+1 提交。先规划但不要输出任何用户可见的叙事、对白、进度说明或工具说明；第一项可见动作应调用一次 rp_commit_turn，原子提交本轮真实发生的世界、时间、场景、角色、Persona、NPC、关系、记忆、目标、物品与选项变化；若本轮没有状态或选项变化，也调用 rp_commit_turn 并传 updates:[]，作为无变化审计。工具成功后只生成一条最终角色回复，不复述提交成功，不输出 planning/reasoning。正文、progress、current_event 或其他文本标签不算状态提交。updates 只写变化事实，并给 data.key 或 data.target 一个跨轮稳定键；没有变化时不要伪造。除非模式说明另有要求、用户明确不要选项或场景没有有意义的分支，非终局轮次提供 2-4 个结构化选项。rp_update_state 与 rp_propose_choices 只用于需要分步补交的兼容场景。</rp-runtime-mode>'}\n${experienceGuide(state, sessionId)}\n${renderRuntimeContext(state, sessionId)}`
    },
  }), 'dsh-rp-product: runtime mode prompt')

  ctx.effect(() => ctx.on('agent/request', async (payload, next) => {
    const base = await next()
    const agent = ctx.agents.requireInitiator()
    const generation = resolveGenerationSettings(readProductStateSync(), agent.id)
    if (generation === undefined) return base
    const reasoningEffort = await supportedReasoningEffort(ctx, base, generation.reasoningEffort, payload.signal)
    return {
      ...base,
      ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
      ...(generation.maxTokens === undefined ? {} : { maxTokens: generation.maxTokens }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    }
  }), 'dsh-rp-product: preset generation settings')

  if (config.mode === 'agent') {
    registerStateKeeper(ctx)
    registerAgentTools(ctx)
  }
}

async function supportedReasoningEffort(
  ctx: Pick<ProductAgentContext, 'llm'>,
  request: Pick<RequestConfig, 'provider' | 'model'>,
  reasoningEffort: string | undefined,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (reasoningEffort === undefined) return undefined
  const model = await ctx.llm.resolveModelInfo(request.provider, request.model, signal)
  return model.reasoning?.efforts.some(effort => effort.id === reasoningEffort) === true ? reasoningEffort : undefined
}

function registerStateKeeper(ctx: ProductAgentContext): void {
  const baselines = new Map<number, number>()
  const attempts = new Map<number, number>()
  ctx.effect(() => ctx.on('agent/inbox/claimed', ({ agent, turn }) => {
    if (!baselines.has(turn)) baselines.set(turn, readProductStateSync().runtimes[agent.id]?.revision ?? 0)
  }), 'dsh-rp-product: State Keeper turn baseline')
  ctx.effect(() => ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    const current = readProductStateSync().runtimes[agent.id]?.revision ?? 0
    const baseline = baselines.get(turn)
    if (baseline === undefined || current > baseline) {
      baselines.delete(turn)
      attempts.delete(turn)
      return
    }
    const attempt = attempts.get(turn) ?? 0
    if (attempt >= 2) {
      baselines.delete(turn)
      attempts.delete(turn)
      throw new Error(`Agent RP turn ${String(turn)} cannot close without a world Ledger audit`)
    }
    attempts.set(turn, attempt + 1)
    agent.steer({
      id: randomUUID(),
      role: 'user',
      content: [{
        type: 'text',
        text: '<rp-state-keeper-audit>本轮尚无 World Ledger 提交。现在只执行审计：调用 rp_commit_turn 提交真实变化与选项；若确实没有变化，传 updates:[]。不要把本条当作角色台词，不要输出 planning/reasoning，也不要在 Tool 之前继续叙事。</rp-state-keeper-audit>',
      }],
      source: { kind: 'plugin', plugin: '@dsh-rp/product', form: 'instructions' },
    })
  }), 'dsh-rp-product: State Keeper turn audit')
}

function registerAgentTools(ctx: ProductAgentContext): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'rp_commit_turn',
    description: 'Atomically commit the RP world ledger from state N to N+1 before the final reply. updates is an array of changed facts with kind, title, summary, and data. Kinds: world, time, scene, character, persona, npc, relationship, memory, objective, inventory. Use data.key or data.target as a stable cross-turn identity. Optional choices replaces the active user choices in the same transaction.',
    parameters: {
      updates: { type: 'json', required: true, description: 'Array of 0-32 changed facts: {kind,title,summary,data}. Use [] when only choices change.' },
      choicesTitle: { type: 'string', description: 'Visible question above the optional choices.' },
      choices: { type: 'json', description: 'Optional array of 0-8 {id,label,prompt}; [] clears stale choices.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('rp_commit_turn requires an Agent-owned call')
      const store = await ProductStore.open()
      const sessionId = String(exec.agent.id)
      const state = await store.runtimeTurn(sessionId, String(exec.callId), {
        updates: args.updates,
        ...(args.choices === undefined ? {} : { choices: args.choices, choicesTitle: args.choicesTitle }),
      }, toolLocation(exec))
      const runtime = state.runtimes[sessionId]
      return {
        committed: true,
        sessionId,
        revision: runtime?.revision ?? 0,
        currentStateCount: runtime === undefined ? 0 : currentRuntimeEffects(runtime).length,
        optionCount: runtime?.choices.length ?? 0,
      }
    },
  })), 'dsh-rp-product: atomic turn ledger tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'rp_update_state',
    description: 'Compatibility tool for committing one structured RP fact after a split or corrective update. Prefer rp_commit_turn for the normal atomic N→N+1 ledger. Kinds: world, time, scene, character, persona, npc, relationship, memory, objective, inventory.',
    parameters: {
      kind: { type: 'string', required: true, enum: ['world', 'time', 'scene', 'character', 'persona', 'npc', 'relationship', 'memory', 'objective', 'inventory'] },
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
      }, toolLocation(exec))
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
      const state = await store.runtimeChoices(sessionId, String(exec.callId), args.title, args.options, toolLocation(exec))
      return { committed: true, sessionId, revision: state.runtimes[sessionId]?.revision ?? 0, optionCount: state.runtimes[sessionId]?.choices.length ?? 0 }
    },
  })), 'dsh-rp-product: Agent RP choices tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'rp_select_speaker',
    description: 'Select one character from the configured Session cast as the speaker of the next final reply. Use in multi-character scenes before writing that character. Never select a character outside the configured cast.',
    parameters: { characterId: { type: 'string', required: true, description: 'Configured Character Profile id.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('rp_select_speaker requires an Agent-owned call')
      const sessionId = String(exec.agent.id)
      const state = await (await ProductStore.open()).primaryCharacter(sessionId, args.characterId)
      const binding = state.bindings[sessionId]
      const character = state.characters.find(item => item.id === binding?.primaryCharacterId)
      return { selected: true, sessionId, characterId: character?.id ?? '', characterName: character?.name ?? '' }
    },
  })), 'dsh-rp-product: speaker selection tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'rp_roll',
    description: 'Roll logged dice for a TRPG uncertainty. Use only when the Session mode or user calls for dice; never roll to override established facts. After the result, commit any resulting objective, inventory, character, or world changes through rp_commit_turn.',
    parameters: {
      notation: { type: 'string', required: true, description: 'Dice notation NdM or NdM+K, for example 1d20+3 or 2d6.' },
      reason: { type: 'string', required: true, description: 'Short visible reason for the check.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('rp_roll requires an Agent-owned call')
      const roll = rollDice(args.notation)
      return { ...roll, reason: args.reason }
    },
  })), 'dsh-rp-product: logged dice tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'rp_read_state',
    description: 'Read the current projected RP world state and active choices. The same state is already present in the request context; call this only when an explicit structured inspection helps planning.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(_args, exec) {
      if (exec.agent === undefined) throw new Error('rp_read_state requires an Agent-owned call')
      const sessionId = String(exec.agent.id)
      const runtime = (await ProductStore.open()).snapshot().runtimes[sessionId]
      return runtime === undefined
        ? { sessionId, revision: 0, state: [], choices: [] }
        : {
          sessionId,
          revision: runtime.revision,
          state: currentRuntimeEffects(runtime).map(effect => ({ ...effect, data: { ...effect.data } })),
          choicesTitle: runtime.choicesTitle,
          choices: runtime.choices.map(choice => ({ ...choice })),
        }
    },
  })), 'dsh-rp-product: state inspection tool')
}

function experienceGuide(state: ProductState, sessionId: string): string {
  const binding = state.bindings[sessionId]
  if (binding === undefined) return '<rp-experience>Adaptive：按当前场景选择必要的状态与选项。</rp-experience>'
  if (binding.experienceId === 'rp-world-sim') return '<rp-experience>World Simulation：世界不围绕用户停转。优先维护时间、场景、NPC 与目标；只提交有因果依据的后台变化，并给用户观察或介入机会。</rp-experience>'
  if (binding.experienceId === 'rp-multi-character') {
    const cast = binding.characterIds.map(id => state.characters.find(character => character.id === id)).filter(character => character !== undefined)
    return `<rp-experience>Multi-character：角色声音、知识和目标必须分离。最终回复前按本轮实际发言者调用 rp_select_speaker；当前阵容：${cast.map(character => `${character.id}=${character.name}`).join('、') || '未配置'}。</rp-experience>`
  }
  if (binding.experienceId === 'rp-trpg') return '<rp-experience>TRPG：只有结果确实不确定且用户接受规则裁决时调用 rp_roll；公开骰式、理由和结果，再用 rp_commit_turn 提交造成的目标、物品、角色或世界变化。</rp-experience>'
  if (binding.experienceId === 'rp-companion') return '<rp-experience>Companion：优先保持情感连续性，提交关系、记忆、Persona 与角色状态；不要为了游戏化而强制每轮提供选项。</rp-experience>'
  return '<rp-experience>Adaptive：根据场景平衡叙事、世界推进、关系记忆和有意义的用户选项。</rp-experience>'
}

function rollDice(value: string): { readonly notation: string; readonly rolls: number[]; readonly modifier: number; readonly total: number } {
  const match = /^(\d{1,2})d(\d{1,4})([+-]\d{1,5})?$/iu.exec(value.trim())
  if (match === null) throw new Error('dice notation must be NdM or NdM+K')
  const count = Number(match[1])
  const sides = Number(match[2])
  const modifier = match[3] === undefined ? 0 : Number(match[3])
  if (count < 1 || count > 20 || sides < 2 || sides > 1_000 || modifier < -10_000 || modifier > 10_000) throw new Error('dice notation exceeds RP roll limits')
  const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1))
  return { notation: `${String(count)}d${String(sides)}${modifier === 0 ? '' : modifier > 0 ? `+${String(modifier)}` : String(modifier)}`, rolls, modifier, total: rolls.reduce((sum, roll) => sum + roll, modifier) }
}

function toolLocation(exec: { readonly callId: unknown; readonly agent?: { readonly session?: { readonly events: readonly unknown[] } } }): RuntimeLocation | undefined {
  const events = exec.agent?.session?.events
  if (events === undefined) return undefined
  const callId = String(exec.callId)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (typeof event !== 'object' || event === null) continue
    const row = event as Record<string, unknown>
    if (row.type !== 'tool/call' || typeof row.seq !== 'number' || typeof row.data !== 'object' || row.data === null) continue
    const data = row.data as Record<string, unknown>
    if (data.callId !== callId || !Number.isSafeInteger(data.turn) || !Number.isSafeInteger(data.step)) continue
    return { turn: data.turn as number, step: data.step as number, sourceSeq: row.seq }
  }
  return undefined
}
