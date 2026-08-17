import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyAgent } from '../src/agent.ts'
import { parseTavernChat, serializeTavernChat } from '../src/chat.ts'
import { importProductFiles } from '../src/import.ts'
import { apply as applyProduct } from '../src/index.ts'
import { apply as applyProductMedia } from '../src/media.ts'
import {
  adaptPresetToHarness,
  advanceCastSpeaker,
  applyRuntimeEffect,
  bindSession,
  commitRuntimeTurn,
  currentRuntimeEffects,
  defaultProductState,
  forkSessionProjection,
  mergeImportedEntities,
  importTranscriptHistory,
  normalizeEntity,
  recordTranscriptMessage,
  recommendComposition,
  scheduleCast,
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
  it('mounts the shared media registry with a deterministic SVG scene-card Provider', async () => {
    const ctx = new Context()
    await applyProductMedia(ctx)
    expect(ctx.rpMedia.list()).toMatchObject([{ id: 'svg-card', title: 'SVG Scene Card', kinds: ['image'] }])
    const artifact = await ctx.rpMedia.generate({ kind: 'image', prompt: '黑海岸港口的警钟与栈桥', options: { title: '港口警报' } })
    expect(artifact).toMatchObject({ kind: 'image', mimeType: 'image/svg+xml', metadata: { provider: 'svg-card', width: 1024, height: 576 } })
    expect(artifact.uri).toMatch(/^data:image\/svg\+xml;base64,/u)
    await expect(ctx.rpMedia.generate({ kind: 'audio', prompt: '晚安' })).rejects.toThrow(/No RP media Provider supports audio/u)
  })

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

  it('schedules and consumes a bounded Multi-character speaker queue', () => {
    const second = normalizeEntity('characters', {
      id: 'qin', name: '秦雾', summary: '旧灯塔守望者', personality: '', speechStyle: '', appearance: '', goals: '', scenario: '',
      openingMessage: '', alternateGreetings: [], examples: [], tags: [], accent: '#d97757', updatedAt: 0,
    }, 1)
    const expanded = upsertEntity(defaultProductState(), 'characters', second, 0)
    const bound = bindSession(expanded, {
      sessionId: 'group-session', ...composition, mode: 'agent', experienceId: 'rp-multi-character',
      characterIds: ['lin-yao', 'qin'], primaryCharacterId: 'lin-yao',
    }, 1, 2)
    const scheduled = scheduleCast(bound, 'group-session', ['qin', 'lin-yao'], { turn: 1, step: 1, sourceSeq: 10 })
    expect(scheduled.runtimes['group-session']).toMatchObject({ castQueue: ['qin', 'lin-yao'], castRound: 1, castQueueSourceSeq: 10 })
    const qinTurn = advanceCastSpeaker(scheduled, 'group-session', { turn: 1, step: 2, sourceSeq: 12 }, 3)
    expect(qinTurn.bindings['group-session']?.primaryCharacterId).toBe('qin')
    expect(qinTurn.runtimes['group-session']).toMatchObject({ castQueue: ['lin-yao'], lastSpeakerId: 'qin', castRound: 1 })
    const linTurn = advanceCastSpeaker(qinTurn, 'group-session', { turn: 2, step: 1, sourceSeq: 20 }, 4)
    expect(linTurn.bindings['group-session']?.primaryCharacterId).toBe('lin-yao')
    expect(linTurn.runtimes['group-session']).toMatchObject({ castQueue: [], lastSpeakerId: 'lin-yao' })
    expect(() => advanceCastSpeaker(linTurn, 'group-session')).toThrow(/queue is empty/u)
    expect(() => scheduleCast(bound, 'group-session', ['outside'])).toThrow(/Session cast/u)
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
    const merged = mergeImportedEntities(defaultProductState(), result.entities, 0)
    const adapted = adaptPresetToHarness(merged, result.entities.presets[0]!.id, 1, 11)
    expect(recommendComposition(adapted.state, 'agent')).toMatchObject({
      mode: 'agent', presetId: adapted.presetId, primaryCharacterId: result.entities.characters[0]!.id,
      characterIds: [result.entities.characters[0]!.id], scene: '末班车已经离站', experienceId: 'rp-adaptive',
    })
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
    const layers = resolvePromptLayers(bound, 'real-scale', '你是谁？')
    expect(layers).toHaveLength(56)
    expect(renderPromptLayer(layers.find(layer => layer.role === 'assistant')!)).toMatch(/^<st-assistant-prefill/u)
    expect(renderPromptLayer(layers.find(layer => layer.role === 'user')!)).toMatch(/^<st-user-message/u)
  })

  it('keeps planning-prefill source while preventing its open tag from entering visible completion', () => {
    const state = defaultProductState()
    const preset = normalizeEntity('presets', {
      id: 'planning-prefill', name: 'Planning prefill',
      promptDefinitions: [{ id: 'thinking', name: 'Thinking', role: 'assistant', content: '开始规划\n<konatan_planning~>', marker: false }],
      promptOrders: [{ id: 'global', entries: [{ identifier: 'thinking', enabled: true }] }],
      selectedPromptOrderId: 'global', generation: { retained: {} }, updatedAt: 0,
    }, 1)
    const expanded = upsertEntity(state, 'presets', preset, 0)
    const bound = bindSession(expanded, { sessionId: 'planning-session', ...composition, presetId: preset.id }, 1, 2)
    const rendered = renderPromptLayer(resolvePromptLayers(bound, 'planning-session')[0]!)
    expect(rendered).toContain('visibility="private-reasoning"')
    expect(rendered).toContain('&lt;konatan_planning~&gt;')
    expect(rendered).not.toContain('\n<konatan_planning~>')
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
    expect(resolvePromptLayers(bound, 'macro-session', '你是谁？').map(layer => layer.content).join('\n')).toContain(
      'tone=quiet user=远行者 你是谁？',
    )
    expect(resolvePromptLayers(bound, 'macro-session', '你是谁？').map(layer => layer.content).join('\n')).not.toContain('{{')
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

  it('imports Tavern history with separate character and persona attribution', () => {
    const bound = bindSession(defaultProductState(), { sessionId: 'history-import', ...composition }, 0, 1)
    const imported = importTranscriptHistory(bound, 'history-import', 10, [
      { role: 'assistant', speakerName: '林遥', content: '雾正在变浓。' },
      { role: 'user', speakerName: '远行者', content: '我去检查灯塔。' },
    ], 2)
    expect(imported.transcripts['history-import']?.messages).toMatchObject([
      { sourceSeq: 10, role: 'assistant', speakerId: 'lin-yao', speakerName: '林遥', synthetic: true, editedContent: '雾正在变浓。' },
      { sourceSeq: 11, role: 'user', speakerId: 'traveler', speakerName: '远行者', synthetic: true, editedContent: '我去检查灯塔。' },
    ])
  })

  it('round-trips visible Tavern JSONL while omitting metadata and system rows', () => {
    const source = [
      JSON.stringify({ user_name: '远行者', character_name: '林遥', chat_metadata: {} }),
      JSON.stringify({ name: '系统', is_system: true, mes: '不进入 RP Transcript' }),
      JSON.stringify({ name: '林遥', is_user: false, mes: '雾正在变浓。' }),
      JSON.stringify({ name: '远行者', is_user: true, mes: '我去检查灯塔。' }),
    ].join('\n')
    const parsed = parseTavernChat(source, '角色', 'User')
    expect(parsed).toMatchObject({ skipped: 2, messages: [
      { role: 'assistant', speakerName: '林遥', content: '雾正在变浓。' },
      { role: 'user', speakerName: '远行者', content: '我去检查灯塔。' },
    ] })
    const exported = serializeTavernChat(parsed.messages, '林遥', '远行者', '2026-08-17T00:00:00.000Z')
    expect(exported.split('\n').filter(Boolean).map(line => JSON.parse(line) as unknown)).toMatchObject([
      { user_name: '远行者', character_name: '林遥', chat_metadata: { source: '@dsh-rp/product' } },
      { name: '林遥', is_user: false, mes: '雾正在变浓。' },
      { name: '远行者', is_user: true, mes: '我去检查灯塔。' },
    ])
  })

  it('atomically advances a multi-state world ledger and projects last values by stable key', () => {
    const base = bindSession(defaultProductState(), { sessionId: 'world-engine', ...composition, mode: 'agent' }, 0, 1)
    const first = commitRuntimeTurn(base, 'world-engine', 'turn-1', {
      updates: [
        { kind: 'time', title: '深夜', summary: '时钟来到 23:10', data: { key: 'world-clock', time: '23:10' } },
        { kind: 'scene', title: '黑海岸港口', summary: '卡提希娅抵达栈桥', data: { key: 'active-scene', location: '黑海岸港口' } },
        { kind: 'npc', title: '港口守卫', summary: '正在检查夜间通行证', data: { key: 'guard-captain', status: 'alert' } },
      ],
      choicesTitle: '下一步怎么办？',
      choices: [{ id: 'ask', label: '询问守卫', prompt: '我上前询问守卫。' }],
    }, 2)
    expect(first.runtimes['world-engine']).toMatchObject({ revision: 1, effects: [{ kind: 'time' }, { kind: 'scene' }, { kind: 'npc' }], choices: [{ id: 'ask' }] })
    const second = commitRuntimeTurn(first, 'world-engine', 'turn-2', {
      updates: [
        { kind: 'time', title: '午夜', summary: '时钟推进至 00:00', data: { key: 'world-clock', time: '00:00' } },
        { kind: 'objective', title: '调查港口', summary: '找到失踪船只的靠泊记录', data: { key: 'main-objective', status: 'active' } },
      ],
    }, 3)
    const current = currentRuntimeEffects(second.runtimes['world-engine']!)
    expect(current).toHaveLength(4)
    expect(current.find(effect => effect.kind === 'time')).toMatchObject({ title: '午夜', data: { time: '00:00' } })
    expect(renderRuntimeContext(second, 'world-engine')).not.toContain('23:10')
    expect(renderRuntimeContext(second, 'world-engine')).toContain('[objective] 调查港口')
  })

  it('clips transcript, state, and choices when adopting a native Session fork', () => {
    const bound = bindSession(defaultProductState(), { sessionId: 'fork-source', ...composition, mode: 'agent' }, 0, 1)
    const history = importTranscriptHistory(bound, 'fork-source', 10, [
      { role: 'user', speakerName: '远行者', content: '第一轮' },
      { role: 'assistant', speakerName: '林遥', content: '第一轮回复' },
    ], 2)
    const first = commitRuntimeTurn(history, 'fork-source', 'call-1', {
      updates: [{ kind: 'time', title: '第一轮时间', summary: '23:00', data: { key: 'clock' } }],
    }, 3, { turn: 1, step: 1, sourceSeq: 20 })
    const scheduled = scheduleCast(first, 'fork-source', ['lin-yao'], { turn: 1, step: 2, sourceSeq: 25 })
    const second = commitRuntimeTurn(scheduled, 'fork-source', 'call-2', {
      updates: [{ kind: 'time', title: '第二轮时间', summary: '23:10', data: { key: 'clock' } }],
      choicesTitle: '第二轮选项', choices: [{ id: 'later', label: '未来选项', prompt: '未来' }],
    }, 4, { turn: 2, step: 1, sourceSeq: 40 })
    const forked = forkSessionProjection(second, 'fork-source', 'fork-child', 30, 1, 5)
    expect(forked.bindings['fork-child']).toMatchObject({ sessionId: 'fork-child', mode: 'agent', primaryCharacterId: 'lin-yao' })
    expect(forked.transcripts['fork-child']?.messages).toHaveLength(2)
    expect(forked.runtimes['fork-child']).toMatchObject({
      revision: 1, effects: [{ title: '第一轮时间', turn: 1, sourceSeq: 20 }], choices: [], choicesTitle: '',
      castQueue: ['lin-yao'], castRound: 1, castQueueSourceSeq: 25,
    })
    expect(renderRuntimeContext(forked, 'fork-child')).toContain('第一轮时间')
    expect(renderRuntimeContext(forked, 'fork-child')).not.toContain('第二轮时间')
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
      tools: { register: () => () => {} },
      llm: { resolveModelInfo: async () => ({}) },
      on: (event: string, listener: typeof requestListener) => {
        if (event === 'agent/request') requestListener = listener
        return () => {}
      },
      effect: (factory: () => unknown) => factory(),
    }
    applyAgent(context as never)
    expect(sections).toHaveLength(258)
    expect(sections.slice(0, 3).map(section => section.name)).toEqual(['deployment:persona', 'rp-product:preset-01', 'rp-product:preset-02'])
    expect(sections.slice(0, 3).map(section => section.order)).toEqual([1_000, 1_001, 1_002])
    expect(sections[0]?.text()).toContain('<rp-system')
    expect(sections[1]?.text()).toContain('<rp-world')
    expect(sections[256]).toMatchObject({ name: 'rp-product:st-role-protocol', order: 990 })
    expect(sections[256]?.text()).toContain('当前可见 Assistant 回复必须作为角色“林遥”')
    expect(sections[257]).toMatchObject({ name: 'rp-product:runtime-mode', order: 1_254 })
    let delegated = false
    const config = await requestListener!({}, async () => { delegated = true; return { provider: 'test', model: 'model' } })
    expect(delegated).toBe(true)
    expect(config).toMatchObject({ provider: 'test', model: 'model', temperature: 0.9, maxTokens: 8192 })
  })

  it('expands the claimed user input on the first model step before Session history is appended', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-rp-product-claimed-input-'))
    vi.stubEnv('DSH_HOME', home)
    const store = await ProductStore.open()
    const preset = normalizeEntity('presets', {
      id: 'claimed-input-preset', name: 'Claimed input preset',
      promptDefinitions: [
        { id: 'main', name: 'Main', role: 'system', content: '<Master_input>{{lastUserMessage}}</Master_input>', marker: false },
        { id: 'prefill', name: 'Prefill', role: 'assistant', content: '开始角色续写', marker: false },
      ],
      promptOrders: [{ id: 'global', entries: [{ identifier: 'main', enabled: true }, { identifier: 'prefill', enabled: true }] }],
      selectedPromptOrderId: 'global', generation: { retained: {} }, updatedAt: 0,
    }, 1)
    await store.upsert('presets', preset, 0)
    await store.bind({ sessionId: 'claimed-session', ...composition, presetId: preset.id, updatedAt: 2 }, 1)
    const sections: Array<{ name: string; order: number; text: () => string }> = []
    let claimed: ((payload: {
      agent: { id: string }
      message: { role: 'user'; content: readonly { type: string; text?: string }[]; source: { kind: string } }
      turn: number
    }) => void) | undefined
    applyAgent({
      systemPrompt: { section: (section: { name: string; order: number; text: () => string }) => { sections.push(section); return () => {} } },
      agents: { requireInitiator: () => ({ id: 'claimed-session', session: { events: [] } }) },
      tools: { register: () => () => {} },
      llm: { resolveModelInfo: async () => ({}) },
      on: (event: string, listener: typeof claimed) => {
        if (event === 'agent/inbox/claimed') claimed = listener
        return () => {}
      },
      effect: (factory: () => unknown) => factory(),
    } as never)
    expect(sections[0]?.text()).toContain('[当前没有可用的用户消息]')
    claimed!({
      agent: { id: 'claimed-session' }, turn: 1,
      message: { role: 'user', content: [{ type: 'text', text: '你是？' }], source: { kind: 'user' } },
    })
    expect(sections[0]?.text()).toContain('<Master_input>你是？</Master_input>')
    expect(sections[1]?.text()).toBe('')
    expect(sections[255]?.text()).toContain('<st-assistant-prefill')
    expect(sections[257]?.order).toBeLessThan(sections[255]!.order)
  })

  it('applies an imported reasoning effort only when the selected model route supports it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-rp-product-reasoning-'))
    vi.stubEnv('DSH_HOME', home)
    const store = await ProductStore.open()
    const preset = normalizeEntity('presets', {
      id: 'minimal-preset', name: 'Minimal preset',
      promptDefinitions: [{ id: 'main', name: 'Main', role: 'system', content: 'Stay in character.', marker: false }],
      promptOrders: [{ id: 'global', entries: [{ identifier: 'main', enabled: true }] }],
      selectedPromptOrderId: 'global', generation: { reasoningEffort: 'minimal', retained: { source_reasoning_effort: 'min' } }, updatedAt: 0,
    }, 1)
    await store.upsert('presets', preset, 0)
    await store.bind({ sessionId: 'reasoning-session', ...composition, presetId: preset.id, updatedAt: 2 }, 1)
    let requestListener: ((payload: { readonly signal: AbortSignal }, next: () => Promise<RequestConfig>) => Promise<RequestConfig>) | undefined
    let efforts = [{ id: 'high' }]
    const resolveModelInfo = vi.fn(async () => ({ reasoning: { efforts } }))
    applyAgent({
      systemPrompt: { section: () => () => {} },
      agents: { requireInitiator: () => ({ id: 'reasoning-session' }) },
      tools: { register: () => () => {} },
      llm: { resolveModelInfo },
      on: (_event: string, listener: typeof requestListener) => { requestListener = listener; return () => {} },
      effect: (factory: () => unknown) => factory(),
    })
    const signal = new AbortController().signal
    const unsupported = await requestListener!({ signal }, async () => ({ provider: 'kaon', model: 'deepseek-v4-flash', reasoningEffort: 'high' }))
    expect(unsupported.reasoningEffort).toBe('high')
    expect(resolveModelInfo).toHaveBeenLastCalledWith('kaon', 'deepseek-v4-flash', signal)
    efforts = [{ id: 'minimal' }, { id: 'high' }]
    const supported = await requestListener!({ signal }, async () => ({ provider: 'compatible', model: 'reasoner' }))
    expect(supported.reasoningEffort).toBe('minimal')
  })

  it('steers missing world-ledger audits at the turn boundary and fails closed after two retries', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-rp-product-state-keeper-'))
    vi.stubEnv('DSH_HOME', home)
    const store = await ProductStore.open()
    await store.bind({ sessionId: 'keeper-session', ...composition, mode: 'agent', updatedAt: 1 }, 0)
    let claimed: ((payload: { readonly agent: KeeperAgent; readonly turn: number }) => void) | undefined
    let stopping: ((payload: { readonly agent: KeeperAgent; readonly turn: number }) => Promise<void> | void) | undefined
    const context = {
      systemPrompt: { section: () => () => {} },
      agents: { requireInitiator: () => ({ id: 'keeper-session' }) },
      tools: { register: () => () => {} },
      llm: { resolveModelInfo: async () => ({}) },
      on: (event: string, listener: ((payload: { readonly agent: KeeperAgent; readonly turn: number }) => Promise<void> | void)) => {
        if (event === 'agent/inbox/claimed') claimed = listener
        if (event === 'agent/turn-stopping') stopping = listener
        return () => {}
      },
      effect: (factory: () => unknown) => factory(),
    }
    applyAgent(context as never, { mode: 'agent' })
    const steered: unknown[] = []
    const agent: KeeperAgent = { id: 'keeper-session', steer: message => { steered.push(message) } }
    claimed!({ agent, turn: 1 })
    await stopping!({ agent, turn: 1 })
    expect(steered).toMatchObject([{ role: 'user', source: { plugin: '@dsh-rp/product', form: 'instructions' } }])
    await store.runtimeTurn('keeper-session', 'audit-1', { updates: [] })
    await stopping!({ agent, turn: 1 })
    expect(steered).toHaveLength(1)

    claimed!({ agent, turn: 2 })
    await stopping!({ agent, turn: 2 })
    await stopping!({ agent, turn: 2 })
    expect(steered).toHaveLength(3)
    expect(() => stopping!({ agent, turn: 2 })).toThrow(/cannot close without a world Ledger audit/u)
  })

  it('registers Agent RP state and choice tools but keeps Tavern Chat tool-free', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-rp-product-agent-tools-'))
    vi.stubEnv('DSH_HOME', home)
    const store = await ProductStore.open()
    const second = normalizeEntity('characters', {
      id: 'qin', name: '秦雾', summary: '旧灯塔守望者', personality: '', speechStyle: '', appearance: '', goals: '', scenario: '',
      openingMessage: '', alternateGreetings: [], examples: [], tags: [], accent: '#d97757', updatedAt: 0,
    }, 1)
    await store.upsert('characters', second, 0)
    await store.bind({
      sessionId: 'agent-tools', ...composition, mode: 'agent', characterIds: ['lin-yao', 'qin'], primaryCharacterId: 'lin-yao', updatedAt: 1,
    }, 1)
    const definitions: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const base = {
      systemPrompt: { section: () => () => {} },
      agents: { requireInitiator: () => ({ id: 'agent-tools' }) },
      tools: { register: (tool: { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }) => { definitions.push(tool); return () => {} } },
      rpMedia: {
        list: () => [{ id: 'svg-card', title: 'SVG Scene Card', kinds: ['image'] as const }],
        generate: async () => ({ id: 'svg-test', kind: 'image' as const, mimeType: 'image/svg+xml', uri: 'data:image/svg+xml;base64,PHN2Zy8+', metadata: { provider: 'svg-card' } }),
      },
      on: () => () => {},
      effect: (factory: () => unknown) => factory(),
    }
    applyAgent(base, { mode: 'agent' })
    expect(definitions.map(tool => tool.name)).toEqual([
      'rp_commit_turn', 'rp_update_state', 'rp_propose_choices', 'rp_schedule_cast', 'rp_next_speaker', 'rp_select_speaker', 'rp_roll',
      'rp_list_media_providers', 'rp_generate_media', 'rp_read_state',
    ])
    const tools = new Map(definitions.map(tool => [tool.name, tool]))
    const execution = { agent: { id: 'agent-tools', session: { events: [
      { type: 'tool/call', seq: 5, data: { turn: 1, step: 1, callId: 'call-1' } },
    ] } }, callId: 'call-1', signal: new AbortController().signal }
    await tools.get('rp_commit_turn')!.execute({
      updates: [{ kind: 'scene', title: '场景变化', summary: '进入港口', data: { key: 'active-scene', location: '港口' } }],
      choicesTitle: '下一步', choices: [{ id: 'ask', label: '询问', prompt: '我询问守卫。' }],
    }, execution)
    expect(await tools.get('rp_schedule_cast')!.execute({ characterIds: ['qin', 'lin-yao'] }, { ...execution, callId: 'call-schedule' }))
      .toMatchObject({ scheduled: true, round: 1, queue: [{ id: 'qin', name: '秦雾' }, { id: 'lin-yao', name: '林遥' }] })
    expect(await tools.get('rp_next_speaker')!.execute({}, { ...execution, callId: 'call-next' }))
      .toMatchObject({ selected: true, characterId: 'qin', characterName: '秦雾', remaining: [{ id: 'lin-yao' }] })
    const read = await tools.get('rp_read_state')!.execute({}, { ...execution, callId: 'call-read' }) as { state: unknown[]; choices: unknown[] }
    expect(read).toMatchObject({ state: [{ kind: 'scene', title: '场景变化' }], choices: [{ id: 'ask' }], castRound: 1, lastSpeakerId: 'qin', castQueue: [{ id: 'lin-yao', name: '林遥' }] })
    expect(await tools.get('rp_select_speaker')!.execute({ characterId: 'lin-yao' }, { ...execution, callId: 'call-speaker' }))
      .toMatchObject({ selected: true, characterId: 'lin-yao', characterName: '林遥' })
    await expect(tools.get('rp_select_speaker')!.execute({ characterId: 'not-in-cast' }, { ...execution, callId: 'call-bad-speaker' }))
      .rejects.toThrow(/character cast/u)
    const roll = await tools.get('rp_roll')!.execute({ notation: '2d6+3', reason: '潜行检定' }, { ...execution, callId: 'call-roll' }) as { rolls: number[]; total: number }
    expect(roll.rolls).toHaveLength(2)
    expect(roll.total).toBeGreaterThanOrEqual(5)
    expect(roll.total).toBeLessThanOrEqual(15)
    expect(await tools.get('rp_list_media_providers')!.execute({}, { ...execution, callId: 'call-media-list' }))
      .toMatchObject([{ id: 'svg-card', kinds: ['image'] }])
    expect(await tools.get('rp_generate_media')!.execute({ kind: 'image', prompt: '港口', title: '场景卡' }, { ...execution, callId: 'call-media' }))
      .toMatchObject({ generated: true, artifact: { id: 'svg-test', kind: 'image' } })
    await tools.get('rp_update_state')!.execute({ kind: 'memory', title: '守卫口供', summary: '旧船昨夜靠港', data: { key: 'guard-testimony' } }, { ...execution, callId: 'call-2' })
    expect(store.snapshot().runtimes['agent-tools']).toMatchObject({
      effects: [
        { kind: 'scene', title: '场景变化', turn: 1, step: 1, sourceSeq: 5 },
        { kind: 'media', title: '场景卡', data: { artifact: { id: 'svg-test' } } },
        { kind: 'memory', title: '守卫口供' },
      ], choicesTitle: '下一步', choices: [{ id: 'ask' }],
    })
    expect(renderRuntimeContext(store.snapshot(), 'agent-tools')).not.toContain('data:image')
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
      agentPresets: { composedPreset: (agentCtx: object) => 'preset' in agentCtx ? String((agentCtx as { preset: unknown }).preset) : 'standard', recompose: async (_ctx: object, id: string) => ({ id }) },
      on: (event: string, listener: (...args: never[]) => void) => {
        if (event === 'session/event') sessionListeners.push(listener as unknown as (session: TestSession, event: TestEvent) => void)
        return () => {}
      },
      effect: (factory: () => unknown) => factory(),
    }
    await applyProduct(context)
    const bind = commands.get('rp-studio-bind')!
    const edit = commands.get('rp-studio-edit')!
    const chatImport = commands.get('rp-studio-chat-import')!
    const forkAdopt = commands.get('rp-studio-fork-adopt')!
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
    const importInput = Buffer.from(JSON.stringify({ sessionId: 'session-bind', messages: [
      { role: 'assistant', speakerName: '林遥', content: '导入的角色历史' },
      { role: 'user', speakerName: '远行者', content: '导入的用户历史' },
    ] })).toString('base64url')
    expect((await chatImport({ agent: { id: 'session-bind', status: 'idle', ctx: {}, session }, rawInput: importInput })).kind).toBe('success')
    expect(events.slice(-2)).toMatchObject([
      { type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'plugin', form: 'recall' } } },
      { type: 'user/message', surfaceOp: 'append', data: { role: 'user', source: { kind: 'plugin', form: 'notice' } } },
    ])
    expect(readProductStateSync().transcripts['session-bind']?.messages.slice(-2)).toMatchObject([
      { role: 'assistant', speakerName: '林遥', editedContent: '导入的角色历史' },
      { role: 'user', speakerName: '远行者', editedContent: '导入的用户历史' },
    ])
    const childEvents = events.map(event => ({ ...event }))
    const childSession: TestSession = {
      id: 'session-child', events: childEvents, header: { parentSession: 'session-bind', seedLength: childEvents.length },
      append: (type: string, data: unknown, options?: Record<string, unknown>) => {
        const event = { type, seq: childEvents.length, time: Date.now(), data, ...options }
        childEvents.push(event)
        return event
      },
    }
    const forkInput = Buffer.from(JSON.stringify({ sourceSessionId: 'session-bind', maxTurn: 1 })).toString('base64url')
    expect((await forkAdopt({ agent: { id: 'session-child', status: 'idle', ctx: { preset: 'rp-tavern' }, session: childSession }, rawInput: forkInput })).kind).toBe('success')
    expect(readProductStateSync().bindings['session-child']).toMatchObject({ sessionId: 'session-child', mode: 'tavern', primaryCharacterId: 'lin-yao' })
    expect(readProductStateSync().transcripts['session-child']?.messages).toHaveLength(3)
  })
})

interface RequestConfig { readonly provider: string; readonly model: string; readonly reasoningEffort?: string; readonly temperature?: number; readonly maxTokens?: number }
interface KeeperAgent { readonly id: string; readonly steer: (message: unknown) => void }
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
  readonly header?: { readonly parentSession?: string; readonly seedLength?: number }
  readonly append: (type: string, data: unknown, options?: Record<string, unknown>) => TestEvent
}
