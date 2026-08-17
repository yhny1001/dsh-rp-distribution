import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyAgent } from '../src/agent.ts'
import { importProductFiles } from '../src/import.ts'
import { apply as applyProduct } from '../src/index.ts'
import {
  adaptPresetToHarness,
  applyRuntimeEffect,
  bindSession,
  defaultProductState,
  mergeImportedEntities,
  normalizeEntity,
  recordTranscriptMessage,
  renderRuntimeContext,
  replaceRuntimeChoices,
  removeEntity,
  renderPromptLayer,
  resolveCharacterText,
  resolveGenerationSettings,
  resolvePromptLayers,
  selectRuntimeChoice,
  upsertEntity,
} from '../src/model.ts'
import { ProductStore, readProductStateSync } from '../src/store.ts'

afterEach(() => { vi.unstubAllEnvs() })

const composition = {
  mode: 'tavern' as const,
  experienceId: 'rp-adaptive',
  presetId: 'tavern-immersive',
  systemId: 'immersive-story',
  characterIds: ['lin-yao'],
  primaryCharacterId: 'lin-yao',
  personaId: 'traveler',
  worldId: 'mist-harbor',
  scene: '观星塔顶层，夜潮刚刚越过北防波堤。',
}

describe('@dsh-rp/product', () => {
  it('resolves Tavern prompt order while preserving system, world, character, persona, scene, and history markers', () => {
    const state = bindSession(defaultProductState(), { sessionId: 'session-one', ...composition, updatedAt: 1 }, 0, 1)
    const layers = resolvePromptLayers(state, 'session-one')
    expect(layers.map(layer => layer.kind)).toEqual([
      'system', 'world', 'persona', 'character', 'character', 'scene', 'examples', 'history', 'custom',
    ])
    expect(layers.find(layer => layer.id === 'charDescription')?.content).toContain('当前主要角色：林遥')
    expect(layers.find(layer => layer.id === 'personaDescription')?.content).toContain('用户人设描述的是对话中的用户')
    expect(layers.find(layer => layer.id === 'worldInfoBefore')?.content).toContain('世界观只定义环境、历史与客观规则')
    expect(layers.find(layer => layer.id === 'chatHistory')).toMatchObject({ marker: true, empty: true })
    expect(renderPromptLayer(layers[0]!)).toMatch(/^<rp-system/u)
    expect(resolveGenerationSettings(state, 'session-one')).toMatchObject({ temperature: 0.9, maxTokens: 8192 })
  })

  it('supports multiple characters with one explicit primary reply speaker', () => {
    const initial = defaultProductState()
    const second = normalizeEntity('characters', {
      id: 'qin', name: '秦雾', summary: '旧灯塔的临时守望者', personality: '直率', speechStyle: '短句',
      appearance: '灰色斗篷', goals: '守住灯塔', scenario: '', openingMessage: '', alternateGreetings: [],
      examples: [], tags: [], accent: '#d97757', updatedAt: 0,
    }, 2)
    const expanded = upsertEntity(initial, 'characters', second, 0)
    const bound = bindSession(expanded, {
      sessionId: 'session-cast', ...composition, characterIds: ['lin-yao', 'qin'], primaryCharacterId: 'qin', updatedAt: 3,
    }, 1, 3)
    const layer = resolvePromptLayers(bound, 'session-cast').find(item => item.id === 'charDescription')
    expect(layer?.subtitle).toBe('秦雾')
    expect(layer?.content).toContain('配角阵容：')
    expect(layer?.content).toContain('林遥')
    const spoken = recordTranscriptMessage(bound, 'session-cast', 7, 'assistant', 4)
    expect(spoken.transcripts['session-cast']?.messages[0]).toMatchObject({ speakerId: 'qin', speakerName: '秦雾' })
  })

  it('repairs Session bindings when a referenced persona is removed', () => {
    const initial = bindSession(defaultProductState(), { sessionId: 'session-delete', ...composition, updatedAt: 1 }, 0, 1)
    const removed = removeEntity(initial, 'personas', 'traveler', 1)
    expect(removed.bindings['session-delete']?.personaId).toBe('')
    expect(resolvePromptLayers(removed, 'session-delete').find(layer => layer.kind === 'persona')?.empty).toBe(true)
  })

  it('serializes durable updates behind optimistic revisions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rp-product-'))
    const store = await ProductStore.open(join(root, 'state.json'))
    const first = await store.upsert('personas', {
      id: 'scholar', name: '学者', description: '研究夜潮的人', traits: '', relationship: '', addressAs: '教授', updatedAt: 0,
    }, 0)
    expect(first.revision).toBe(1)
    await expect(store.upsert('personas', {
      id: 'late', name: '迟到者', description: '旧请求', traits: '', relationship: '', addressAs: '', updatedAt: 0,
    }, 0)).rejects.toThrow(/revision conflict/u)
  })

  it('rolls a binding back before releasing the mutation queue when Agent activation fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rp-product-rollback-'))
    const store = await ProductStore.open(join(root, 'state.json'))
    await expect(store.bindWithEffect({ sessionId: 'session-rollback', ...composition, updatedAt: 1 }, 0,
      async () => { throw new Error('preset unavailable') })).rejects.toThrow(/preset unavailable/u)
    expect(store.snapshot().revision).toBe(0)
    expect(store.snapshot().bindings['session-rollback']).toBeUndefined()
  })

  it('imports a mixed batch of Character Card and Prompt Manager files with per-file reports', () => {
    const encoder = new TextEncoder()
    const card = JSON.stringify({
      spec: 'chara_card_v3', spec_version: '3.0', data: {
        name: '洛弥', description: '月台管理员', personality: '耐心', scenario: '末班车已经离站',
        first_mes: '你还是来了。', alternate_greetings: ['今天比平时更冷。'], mes_example: '<START>\n洛弥：请出示车票。', tags: ['车站'], extensions: {},
      },
    })
    const preset = JSON.stringify({
      name: '夜行预设', prompts: [
        { identifier: 'main', name: 'Main', role: 'system', content: 'Stay in character.', marker: false },
        { identifier: 'chatHistory', name: 'History', role: 'system', content: '', marker: true },
      ],
      prompt_order: [{ character_id: 100001, order: [
        { identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true },
      ] }], temperature: 0.7, openai_max_tokens: 1024,
    })
    const result = importProductFiles([
      { name: 'luomi.json', bytes: encoder.encode(card) },
      { name: 'night.json', bytes: encoder.encode(preset) },
      { name: 'broken.json', bytes: encoder.encode('{') },
    ], 10)
    expect(result.entities.characters).toMatchObject([{ name: '洛弥', openingMessage: '你还是来了。', alternateGreetings: ['今天比平时更冷。'] }])
    expect(result.entities.presets).toMatchObject([{ name: '夜行预设', generation: { temperature: 0.7, maxTokens: 1024 } }])
    expect(result.reports.map(report => report.kind)).toEqual(['character', 'preset', 'error'])
  })

  it('imports rich World Info entries without flattening disabled switches or keywords', () => {
    const source = JSON.stringify({ name: '黎那汐塔', entries: {
      1: { comment: '拉古那城', key: ['拉古那', '水道'], keysecondary: ['港口'], content: '水道贯穿整座城市。', enabled: true, constant: false, order: 20 },
      2: { comment: '隐藏历史', key: ['利维亚坦'], content: '被封存的历史。', enabled: false, constant: true, order: 99 },
    } })
    const result = importProductFiles([{ name: 'world.json', bytes: new TextEncoder().encode(source) }], 1)
    expect(result.reports).toMatchObject([{ kind: 'world' }])
    expect(result.entities.worlds[0]?.entries).toEqual([
      expect.objectContaining({ id: '1', keys: ['拉古那', '水道'], secondaryKeys: ['港口'], enabled: true, priority: 20 }),
      expect.objectContaining({ id: '2', keys: ['利维亚坦'], enabled: false, constant: true, priority: 99 }),
    ])
  })

  it('retains a real-scale ST assembly with 210 definitions, 177 switches, and maxTokens 30000', () => {
    const encoder = new TextEncoder()
    const definitions = Array.from({ length: 210 }, (_, index) => ({
      identifier: index === 0 ? 'main' : `prompt-${index}`,
      name: `Prompt ${index}`,
      role: index === 1 ? 'assistant' : index === 2 ? 'user' : 'system',
      content: `content-${index}`,
      marker: false,
      system_prompt: index === 0,
      forbid_overrides: index === 0,
      injection_position: 0,
      injection_depth: 4,
      injection_order: index,
      injection_trigger: index === 3 ? ['continue'] : [],
    }))
    const preset = JSON.stringify({
      prompts: definitions,
      prompt_order: [{ character_id: 100001, order: definitions.slice(0, 177).map((definition, index) => ({
        identifier: definition.identifier,
        enabled: index < 56,
      })) }],
      temperature: 1,
      openai_max_tokens: 30_000,
      top_p: 1,
      reasoning_effort: 'min',
    })
    const result = importProductFiles([{ name: 'Izumi 0814.json', bytes: encoder.encode(preset) }], 12)
    expect(result.reports).toMatchObject([{ kind: 'preset', names: ['Izumi 0814.json'] }])
    const imported = result.entities.presets[0]!
    expect(imported.mode).toBe('sillytavern')
    expect(imported.promptDefinitions).toHaveLength(210)
    expect(imported.promptOrders[0]?.entries).toHaveLength(177)
    expect(imported.promptOrders[0]?.entries.filter(entry => entry.enabled)).toHaveLength(56)
    expect(imported.promptDefinitions[0]).toMatchObject({
      systemPrompt: true, forbidOverrides: true, injectionPosition: 0, injectionDepth: 4, injectionOrder: 0,
    })
    expect(imported.generation).toMatchObject({
      maxTokens: 30_000,
      reasoningEffort: 'minimal',
      retained: { top_p: 1, source_reasoning_effort: 'min' },
    })
    expect(imported.source?.document?.prompts).toBeInstanceOf(Array)
    expect(result.reports[0]?.ids).toEqual([imported.id])
    const merged = mergeImportedEntities(defaultProductState(), result.entities, 0)
    const adapted = adaptPresetToHarness(merged, imported.id, 1, 13)
    expect(adapted.state.presets.find(preset => preset.id === imported.id)?.mode).toBe('sillytavern')
    expect(adapted.state.presets.find(preset => preset.id === adapted.presetId)).toMatchObject({
      mode: 'harness',
      adaptation: {
        sourcePresetId: imported.id,
        removedInjectionMetadata: 210,
        inertExtensionWarnings: 0,
      },
    })
    const bound = bindSession(adapted.state, { sessionId: 'real-scale', ...composition, presetId: adapted.presetId }, 2, 14)
    expect(resolvePromptLayers(bound, 'real-scale')).toHaveLength(56)
  })

  it('assembles safe ST variables and identity macros without executing scripts', () => {
    const preset = normalizeEntity('presets', {
      id: 'macro-preset', name: 'Macro preset',
      promptDefinitions: [
        { id: 'init', name: 'Init', role: 'system', content: '{{setvar::tone::quiet}}', marker: false },
        { id: 'override', name: 'Override', role: 'system', content: '{{setvar::tone::loud}}', marker: false },
        { id: 'read', name: 'Read', role: 'system', content: 'tone={{getvar::tone}} user={{user}} {{lastUserMessage}} {{//comment}}', marker: false },
      ],
      promptOrders: [{ id: 'global', entries: [
        { identifier: 'init', enabled: true }, { identifier: 'override', enabled: false }, { identifier: 'read', enabled: true },
      ] }],
      selectedPromptOrderId: 'global', generation: { retained: {} }, updatedAt: 0,
    }, 1)
    const expanded = upsertEntity(defaultProductState(), 'presets', preset, 0)
    const bound = bindSession(expanded, { sessionId: 'macro-session', ...composition, presetId: 'macro-preset' }, 1, 2)
    expect(resolvePromptLayers(bound, 'macro-session').map(layer => layer.content).join('\n')).toContain(
      'tone=quiet user=远行者 [当前用户消息由 DSH 原生会话紧随本 Prompt 提供]',
    )
    expect(resolvePromptLayers(bound, 'macro-session').map(layer => layer.content).join('\n')).not.toContain('{{')
    expect(resolveCharacterText(bound, 'macro-session', '{{char}}正在等待{{user}}。')).toBe('林遥正在等待远行者。')
  })

  it('persists imported PNG avatars beside the atomic product state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rp-product-avatar-'))
    const store = await ProductStore.open(join(root, 'state.json'))
    const id = `avatar-${'a'.repeat(64)}`
    const character = {
      ...defaultProductState().characters[0]!,
      id: 'avatar-character',
      name: '头像角色',
      avatar: { id, mediaType: 'image/png' as const, byteLength: 4, width: 1, height: 1 },
    }
    await store.importBatch({ characters: [character], personas: [], worlds: [], presets: [] }, [{ id, bytes: Uint8Array.of(1, 2, 3, 4) }], 0)
    expect([...readFileSync(join(root, 'assets', `${id}.png`))]).toEqual([1, 2, 3, 4])
    expect(store.snapshot().characters.find(item => item.id === character.id)?.avatar).toMatchObject({ id, width: 1, height: 1 })
  })

  it('commits Agent RP effects and choices while rejecting them in Tavern Chat mode', () => {
    const base = bindSession(defaultProductState(), { sessionId: 'agent-runtime', ...composition, mode: 'agent' }, 0, 1)
    const effected = applyRuntimeEffect(base, 'agent-runtime', 'call-world', {
      kind: 'time', title: '时间推进', summary: '清晨推进到上午九点', data: { from: '07:20', to: '09:00' },
    }, 2)
    const proposed = replaceRuntimeChoices(effected, 'agent-runtime', 'call-choice', '接下来做什么？', [
      { id: 'harbor', label: '前往港口', prompt: '我决定前往港口。' },
      { id: 'stay', label: '留在原地', prompt: '我决定留在原地。' },
    ])
    const selected = selectRuntimeChoice(proposed, 'agent-runtime', 'harbor')
    expect(selected.runtimes['agent-runtime']).toMatchObject({ revision: 3, selectedChoiceId: 'harbor', choices: [{ id: 'harbor' }, { id: 'stay' }] })
    expect(renderRuntimeContext(selected, 'agent-runtime')).toContain('[time] 时间推进')
    const tavern = bindSession(defaultProductState(), { sessionId: 'tavern-runtime', ...composition }, 0, 1)
    expect(() => applyRuntimeEffect(tavern, 'tavern-runtime', 'call', {
      kind: 'world', title: '不应提交', summary: '传统酒馆不自动维护', data: {},
    })).toThrow(/Agent RP mode/u)
  })

  it('registers 256 ordered Prompt Manager seats and applies supported generation parameters through next()', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-rp-product-agent-'))
    vi.stubEnv('DSH_HOME', home)
    const store = await ProductStore.open()
    await store.bind({ sessionId: 'session-agent', ...composition, updatedAt: 1 }, 0)
    const sections: Array<{ name: string; order: number; text: () => string }> = []
    let requestListener: ((_payload: unknown, next: () => Promise<RequestConfig>) => Promise<RequestConfig>) | undefined
    const context = {
      systemPrompt: { section: (section: { name: string; order: number; text: () => string }) => { sections.push(section); return () => {} } },
      agents: { requireInitiator: () => ({ id: 'session-agent' }) },
      on: (_event: string, listener: typeof requestListener) => { requestListener = listener; return () => {} },
      effect: (factory: () => unknown) => factory(),
    }
    applyAgent(context)
    expect(sections).toHaveLength(257)
    expect(sections.slice(0, 3).map(section => section.name)).toEqual(['deployment:persona', 'rp-product:preset-01', 'rp-product:preset-02'])
    expect(sections[0]?.text()).toContain('<rp-system')
    expect(sections[1]?.text()).toContain('<rp-world')
    let delegated = false
    const config = await requestListener!({}, async () => { delegated = true; return { provider: 'test', model: 'model' } })
    expect(delegated).toBe(true)
    expect(config).toMatchObject({ provider: 'test', model: 'model', temperature: 0.9, maxTokens: 8192 })
  })

  it('registers Agent RP state and choice tools but keeps Tavern Chat tool-free', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-rp-product-agent-tools-'))
    vi.stubEnv('DSH_HOME', home)
    const store = await ProductStore.open()
    await store.bind({ sessionId: 'agent-tools', ...composition, mode: 'agent', updatedAt: 1 }, 0)
    const definitions: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const base = {
      systemPrompt: { section: () => () => {} },
      agents: { requireInitiator: () => ({ id: 'agent-tools' }) },
      tools: { register: (tool: { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }) => { definitions.push(tool); return () => {} } },
      on: () => () => {},
      effect: (factory: () => unknown) => factory(),
    }
    applyAgent(base, { mode: 'agent' })
    expect(definitions.map(tool => tool.name)).toEqual(['rp_update_state', 'rp_propose_choices'])
    const execution = { agent: { id: 'agent-tools' }, callId: 'call-1', signal: new AbortController().signal }
    await definitions[0]!.execute({ kind: 'scene', title: '场景变化', summary: '进入港口', data: { location: '港口' } }, execution)
    await definitions[1]!.execute({ title: '下一步', options: [{ id: 'ask', label: '询问', prompt: '我询问守卫。' }] }, { ...execution, callId: 'call-2' })
    expect(store.snapshot().runtimes['agent-tools']).toMatchObject({
      effects: [{ kind: 'scene', title: '场景变化' }], choicesTitle: '下一步', choices: [{ id: 'ask' }],
    })
    const tavernTools: unknown[] = []
    applyAgent({ ...base, tools: { register: (tool: unknown) => { tavernTools.push(tool); return () => {} } } }, { mode: 'tavern' })
    expect(tavernTools).toEqual([])
  })

  it('recomposes a blank Session, records speakers, and appends provenance-complete edits', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-rp-product-host-'))
    vi.stubEnv('DSH_HOME', home)
    const commands = new Map<string, (input: CommandInput) => Promise<{ kind: string; text: string }>>()
    const sessionListeners: Array<(session: TestSession, event: TestEvent) => void> = []
    const events: TestEvent[] = []
    const session: TestSession = {
      id: 'session-bind', events,
      append: (type: string, data: unknown, options?: Record<string, unknown>) => {
        const event = { type, seq: events.length, time: Date.now(), data, ...options }
        events.push(event)
        return event
      },
    }
    const context = {
      webServer: { register: () => () => {} },
      commands: { register: (definition: { name: string; handler: (input: CommandInput) => Promise<{ kind: string; text: string }> }) => {
        commands.set(definition.name, definition.handler); return () => {}
      } },
      agentPresets: { composedPreset: () => 'standard', recompose: async (_ctx: object, id: string) => ({ id }) },
      on: (event: string, listener: (...args: never[]) => void) => {
        if (event === 'session/event') sessionListeners.push(listener as unknown as (session: TestSession, event: TestEvent) => void)
        return () => {}
      },
      effect: (factory: () => unknown) => factory(),
    }
    await applyProduct(context)
    const bind = commands.get('rp-studio-bind')!
    const edit = commands.get('rp-studio-edit')!
    const rawInput = Buffer.from(JSON.stringify({ sessionId: 'session-bind', baseRevision: 0, ...composition })).toString('base64url')
    expect((await bind({ agent: { id: 'session-bind', status: 'idle', ctx: {}, session }, rawInput })).kind).toBe('success')
    expect(events[0]).toMatchObject({ type: 'agent-preset/selected', data: { agentPreset: 'rp-tavern' } })
    const assistant: TestEvent = {
      type: 'assistant/message', seq: events.length, time: Date.now(), surfaceOp: 'append', sourceEventSeqs: [],
      data: { turn: 1, step: 1, message: { id: 'assistant-one', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' }, content: [{ type: 'text', text: '旧正文' }] } },
    }
    events.push(assistant)
    for (const listener of sessionListeners) listener(session, assistant)
    await vi.waitFor(() => expect(readProductStateSync().transcripts['session-bind']?.messages).toHaveLength(1))
    const editInput = Buffer.from(JSON.stringify({ sessionId: 'session-bind', sourceSeq: assistant.seq, editRevision: 0, content: '新正文' })).toString('base64url')
    expect((await edit({ agent: { id: 'session-bind', status: 'idle', ctx: {}, session }, rawInput: editInput })).kind).toBe('success')
    expect(events.at(-1)).toMatchObject({
      type: 'user/message',
      surfaceOp: { op: 'replace', start: assistant.seq, end: assistant.seq },
      sourceEventSeqs: [assistant.seq],
      data: { id: 'assistant-one', role: 'user', source: { kind: 'plugin', form: 'recall' } },
    })
    expect((events.at(-1)?.data as { content: Array<{ text: string }> }).content[0]?.text).toContain('新正文')
    expect(readProductStateSync().transcripts['session-bind']?.messages[0]).toMatchObject({
      speakerName: '林遥', editedContent: '新正文', editRevision: 1, currentSurfaceSeq: events.length - 1,
    })
  })
})

interface RequestConfig { readonly provider: string; readonly model: string; readonly temperature?: number; readonly maxTokens?: number }
interface CommandInput { readonly agent: { readonly id: string; readonly status: 'idle'; readonly ctx: object; readonly session: TestSession }; readonly rawInput: string }
interface TestEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  readonly surfaceOp?: unknown
  readonly sourceEventSeqs?: readonly number[]
}
interface TestSession {
  readonly id: string
  readonly events: TestEvent[]
  readonly append: (type: string, data: unknown, options?: Record<string, unknown>) => TestEvent
}
