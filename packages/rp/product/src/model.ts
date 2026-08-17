/** Versioned product data for the local-first RP workspace. */

export type ProductEntityKind = 'systems' | 'characters' | 'personas' | 'worlds' | 'presets'
export type PromptRole = 'system' | 'user' | 'assistant'
export type TranscriptRole = 'user' | 'assistant'
export type PresetMode = 'sillytavern' | 'harness'
export type ProductSessionMode = 'tavern' | 'agent'
export type JsonValue = boolean | number | string | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
/** Fixed registration capacity for one mutable Prompt Manager order. */
export const PRODUCT_PROMPT_SEAT_COUNT = 256
/** Definitions may outnumber one order because ST presets retain unassigned alternatives. */
export const PRODUCT_PROMPT_DEFINITION_LIMIT = 1024

export interface ImportSource {
  readonly format: string
  readonly sourceId: string
  readonly warnings: readonly string[]
  readonly document?: JsonObject
}

export interface SystemProfile {
  readonly id: string
  readonly name: string
  readonly directive: string
  readonly tone: string
  readonly boundaries: string
  readonly updatedAt: number
}

export interface CharacterProfile {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly personality: string
  readonly speechStyle: string
  readonly appearance: string
  readonly goals: string
  readonly scenario: string
  readonly openingMessage: string
  readonly alternateGreetings: readonly string[]
  readonly examples: readonly string[]
  readonly tags: readonly string[]
  readonly accent: string
  readonly avatar?: CharacterAvatar
  readonly source?: ImportSource
  readonly updatedAt: number
}

export interface CharacterAvatar {
  readonly id: string
  readonly mediaType: 'image/png'
  readonly byteLength: number
  readonly width: number
  readonly height: number
}

export interface PersonaProfile {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly traits: string
  readonly relationship: string
  readonly addressAs: string
  readonly source?: ImportSource
  readonly updatedAt: number
}

export interface WorldProfile {
  readonly id: string
  readonly name: string
  readonly overview: string
  readonly rules: string
  readonly locations: string
  readonly lore: string
  readonly entries: readonly WorldEntry[]
  readonly accent: string
  readonly source?: ImportSource
  readonly updatedAt: number
}

export interface WorldEntry {
  readonly id: string
  readonly name: string
  readonly content: string
  readonly keys: readonly string[]
  readonly secondaryKeys: readonly string[]
  readonly enabled: boolean
  readonly constant: boolean
  readonly priority: number
}

export interface PromptDefinition {
  readonly id: string
  readonly name: string
  readonly role: PromptRole
  readonly content: string
  readonly marker: boolean
  readonly systemPrompt?: boolean
  readonly forbidOverrides?: boolean
  readonly injectionPosition?: number
  readonly injectionDepth?: number
  readonly injectionOrder?: number
  readonly injectionTrigger?: readonly string[]
}

export interface PromptOrderEntry {
  readonly identifier: string
  readonly enabled: boolean
}

export interface PromptOrder {
  readonly id: string
  readonly entries: readonly PromptOrderEntry[]
}

export interface GenerationSettings {
  readonly temperature?: number
  readonly maxTokens?: number
  readonly reasoningEffort?: string
  readonly retained: Readonly<Record<string, boolean | number | string | null>>
}

export interface PromptPreset {
  readonly id: string
  readonly name: string
  readonly mode: PresetMode
  readonly promptDefinitions: readonly PromptDefinition[]
  readonly promptOrders: readonly PromptOrder[]
  readonly selectedPromptOrderId: string
  readonly generation: GenerationSettings
  readonly adaptation?: PresetAdaptation
  readonly source?: ImportSource
  readonly updatedAt: number
}

export interface PresetAdaptation {
  readonly sourcePresetId: string
  readonly convertedAt: number
  readonly removedInjectionMetadata: number
  readonly inertExtensionWarnings: number
  readonly notes: readonly string[]
}

export interface SessionComposition {
  readonly sessionId: string
  readonly mode: ProductSessionMode
  readonly experienceId: string
  readonly presetId: string
  readonly systemId: string
  readonly characterIds: readonly string[]
  readonly primaryCharacterId: string
  readonly personaId: string
  readonly worldId: string
  readonly scene: string
  readonly updatedAt: number
}

export type CompositionRecommendation = Omit<SessionComposition, 'sessionId' | 'updatedAt'>

export interface TranscriptMessage {
  readonly sourceSeq: number
  readonly currentSurfaceSeq: number
  readonly role: TranscriptRole
  readonly speakerId: string
  readonly speakerName: string
  readonly synthetic: boolean
  readonly editedContent?: string
  readonly editRevision: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SessionTranscript {
  readonly sessionId: string
  readonly messages: readonly TranscriptMessage[]
}

export type RuntimeEffectKind = 'world' | 'time' | 'scene' | 'character' | 'persona' | 'relationship' | 'memory' | 'npc' | 'objective' | 'inventory' | 'media'

export interface RuntimeEffect {
  readonly id: string
  readonly callId: string
  readonly kind: RuntimeEffectKind
  readonly title: string
  readonly summary: string
  readonly data: JsonObject
  readonly createdAt: number
  readonly turn?: number
  readonly step?: number
  readonly sourceSeq?: number
}

export interface RuntimeLocation {
  readonly turn: number
  readonly step: number
  readonly sourceSeq: number
}

export interface RuntimeChoice {
  readonly id: string
  readonly label: string
  readonly prompt: string
}

export interface SessionRuntimeState {
  readonly sessionId: string
  readonly revision: number
  readonly effects: readonly RuntimeEffect[]
  readonly choicesTitle: string
  readonly choices: readonly RuntimeChoice[]
  readonly selectedChoiceId: string
  readonly choicesTurn?: number
  readonly choicesStep?: number
  readonly choicesSourceSeq?: number
  readonly lastCommitTurn?: number
  readonly lastCommitStep?: number
  readonly lastCommitSourceSeq?: number
  readonly castQueue: readonly string[]
  readonly castRound: number
  readonly lastSpeakerId: string
  readonly castQueueTurn?: number
  readonly castQueueStep?: number
  readonly castQueueSourceSeq?: number
}

export interface ProductState {
  readonly schemaVersion: 2
  readonly revision: number
  readonly systems: readonly SystemProfile[]
  readonly characters: readonly CharacterProfile[]
  readonly personas: readonly PersonaProfile[]
  readonly worlds: readonly WorldProfile[]
  readonly presets: readonly PromptPreset[]
  readonly bindings: Readonly<Record<string, SessionComposition>>
  readonly transcripts: Readonly<Record<string, SessionTranscript>>
  readonly runtimes: Readonly<Record<string, SessionRuntimeState>>
}

export type ProductEntity = SystemProfile | CharacterProfile | PersonaProfile | WorldProfile | PromptPreset
export type PromptLayerKind = 'system' | 'world' | 'character' | 'persona' | 'scene' | 'examples' | 'history' | 'custom'

export interface PromptLayer {
  readonly id: string
  readonly kind: PromptLayerKind
  readonly role: PromptRole
  readonly title: string
  readonly subtitle: string
  readonly content: string
  readonly accent: string
  readonly marker: boolean
  readonly empty: boolean
}

export interface ImportedProductEntities {
  readonly characters: readonly CharacterProfile[]
  readonly personas: readonly PersonaProfile[]
  readonly worlds: readonly WorldProfile[]
  readonly presets: readonly PromptPreset[]
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/iu

/** Default content shown on first use without writing user storage. */
export function defaultProductState(): ProductState {
  return Object.freeze({
    schemaVersion: 2,
    revision: 0,
    systems: Object.freeze([Object.freeze({
      id: 'immersive-story', name: '沉浸叙事',
      directive: '你是角色扮演叙事引擎。始终保持角色身份与世界内部视角，不替用户决定行动，不把设定说明当作用户台词。',
      tone: '细腻、克制、重视动作和感官细节；推进情节时给用户保留明确选择空间。',
      boundaries: '系统规则高于角色欲望；角色设定只定义角色，用户人设只定义用户，世界观只定义环境事实。', updatedAt: 0,
    })]),
    characters: Object.freeze([Object.freeze({
      id: 'lin-yao', name: '林遥', summary: '雾港观星塔的年轻记录官，负责追踪会改变航线的夜潮。',
      personality: '冷静敏锐，面对陌生人谨慎，谈到星图时会流露真诚热情。',
      speechStyle: '句子简洁，偶尔使用航海和星象比喻；紧张时会先描述观察结果再表达感受。',
      appearance: '黑色短发，深蓝长外套，随身携带一枚黄铜星盘。', goals: '查清失踪灯塔守望者留下的异常星图，同时保护雾港居民。',
      scenario: '旧灯塔连续三夜熄灭，林遥在异常星图上发现了本不该存在的第七码头。',
      openingMessage: '潮雾贴着窗沿漫进来。林遥合上星图，抬眼看向门口：“你比约定早到了七分钟。”',
      alternateGreetings: Object.freeze([]), examples: Object.freeze([]), tags: Object.freeze(['原创', '悬疑', '雾港']),
      accent: '#f47f6b', updatedAt: 0,
    })]),
    personas: Object.freeze([Object.freeze({
      id: 'traveler', name: '远行者', description: '刚抵达雾港的外乡调查者，对当地夜潮与失踪事件知之甚少。',
      traits: '善于倾听，谨慎求证，不轻易透露自己的真实来历。', relationship: '与林遥初次见面，双方只有一封匿名委托信作为联系。',
      addressAs: '你', updatedAt: 0,
    })]),
    worlds: Object.freeze([Object.freeze({
      id: 'mist-harbor', name: '雾港', overview: '一座建在黑色礁群上的港城。夜潮会携带发光雾粒，城市依靠灯塔和观星塔共同校准航线。',
      rules: '夜潮期间罗盘失效；记录在星图上的名字会被海雾记住；灯塔熄灭后不得直视海面倒影。',
      locations: '观星塔、旧灯塔、潮痕市场、北防波堤、沉船档案馆。',
      lore: '三十年前的“大偏航”让整支舰队消失。官方档案称其遭遇风暴，民间则认为舰队进入了被抹去的第七码头。',
      entries: Object.freeze([]),
      accent: '#42b883', updatedAt: 0,
    })]),
    presets: Object.freeze([defaultPromptPreset()]), bindings: Object.freeze({}), transcripts: Object.freeze({}), runtimes: Object.freeze({}),
  })
}

/** Recommend a complete import-first composition that can start without manual field-by-field setup. */
export function recommendComposition(state: ProductState, mode: ProductSessionMode): CompositionRecommendation {
  const importedPresets = state.presets.filter(preset => preset.source !== undefined)
  const importedHarnessPresets = importedPresets.filter(preset => preset.mode === 'harness')
  const harnessPresets = state.presets.filter(preset => preset.mode === 'harness')
  const preset = newest(importedHarnessPresets.length > 0 ? importedHarnessPresets
    : importedPresets.length > 0 ? importedPresets : harnessPresets.length > 0 ? harnessPresets : state.presets)
  const character = newest(importedOrAll(state.characters))
  const persona = newest(importedOrAll(state.personas))
  const world = newest(importedOrAll(state.worlds))
  const system = newest(state.systems)
  if (preset === undefined || system === undefined) throw new Error('RP recommendation requires a Prompt preset and system profile')
  const primaryCharacterId = character?.id ?? ''
  return Object.freeze({
    mode,
    experienceId: 'rp-adaptive',
    presetId: preset.id,
    systemId: system.id,
    characterIds: Object.freeze(primaryCharacterId === '' ? [] : [primaryCharacterId]),
    primaryCharacterId,
    personaId: persona?.id ?? '',
    worldId: world?.id ?? '',
    scene: character?.scenario.trim() || world?.overview.trim() || '',
  })
}

/** Parse durable or API state into a complete immutable document. */
export function normalizeProductState(value: unknown): ProductState {
  if (value === undefined) return defaultProductState()
  const root = record(value, 'product state')
  if (root.schemaVersion !== 2) throw new Error('product state schemaVersion must be 2')
  const state: ProductState = {
    schemaVersion: 2,
    revision: integer(root.revision, 'revision', 0, Number.MAX_SAFE_INTEGER),
    systems: Object.freeze(array(root.systems, 'systems').map(normalizeSystem)),
    characters: Object.freeze(array(root.characters, 'characters').map(normalizeCharacter)),
    personas: Object.freeze(array(root.personas, 'personas').map(normalizePersona)),
    worlds: Object.freeze(array(root.worlds, 'worlds').map(normalizeWorld)),
    presets: Object.freeze(array(root.presets, 'presets').map(normalizePreset)),
    bindings: Object.freeze(Object.fromEntries(Object.entries(record(root.bindings, 'bindings')).map(([id, item]) => [id, normalizeComposition(item, id)]))),
    transcripts: Object.freeze(Object.fromEntries(Object.entries(record(root.transcripts, 'transcripts')).map(([id, item]) => [id, normalizeTranscript(item, id)]))),
    runtimes: Object.freeze(Object.fromEntries(Object.entries(record(root.runtimes ?? {}, 'runtimes')).map(([id, item]) => [id, normalizeRuntime(item, id)]))),
  }
  for (const [items, label] of [[state.systems, 'system'], [state.characters, 'character'], [state.personas, 'persona'], [state.worlds, 'world'], [state.presets, 'preset']] as const) validateUnique(items, label)
  if (state.systems.length === 0 || state.presets.length === 0) throw new Error('product state requires a system profile and prompt preset')
  for (const binding of Object.values(state.bindings)) validateCompositionReferences(state, binding)
  return Object.freeze(state)
}

/** Normalize one entity from an untrusted mutation request. */
export function normalizeEntity(kind: ProductEntityKind, value: unknown, now = Date.now()): ProductEntity {
  const source = { ...record(value, kind), updatedAt: now }
  switch (kind) {
    case 'systems': return normalizeSystem(source)
    case 'characters': return normalizeCharacter(source)
    case 'personas': return normalizePersona(source)
    case 'worlds': return normalizeWorld(source)
    case 'presets': return normalizePreset(source)
  }
}

/** Replace or append one entity and advance the document revision. */
export function upsertEntity(state: ProductState, kind: ProductEntityKind, entity: ProductEntity, baseRevision: number): ProductState {
  requireRevision(state, baseRevision)
  const current = state[kind] as readonly ProductEntity[]
  const index = current.findIndex(item => item.id === entity.id)
  const next = index < 0 ? [...current, entity] : current.map((item, itemIndex) => itemIndex === index ? entity : item)
  return normalizeProductState({ ...state, revision: state.revision + 1, [kind]: next })
}

/** Merge one validated multi-file import as a single optimistic mutation. */
export function mergeImportedEntities(state: ProductState, imported: ImportedProductEntities, baseRevision: number): ProductState {
  requireRevision(state, baseRevision)
  return normalizeProductState({
    ...state, revision: state.revision + 1,
    characters: mergeById(state.characters, imported.characters), personas: mergeById(state.personas, imported.personas),
    worlds: mergeById(state.worlds, imported.worlds), presets: mergeById(state.presets, imported.presets),
  })
}

/** Create or refresh a non-destructive Harness-native copy of one ST preset. */
export function adaptPresetToHarness(
  state: ProductState,
  presetId: string,
  baseRevision: number,
  now = Date.now(),
): { readonly state: ProductState; readonly presetId: string } {
  requireRevision(state, baseRevision)
  const source = state.presets.find(preset => preset.id === normalizedId(presetId, 'preset id'))
  if (source === undefined) throw new Error(`preset ${JSON.stringify(presetId)} does not exist`)
  if (source.mode !== 'sillytavern') throw new Error('only a SillyTavern compatibility preset can be adapted')
  const id = normalizedId(`${source.id}-harness`.slice(0, 128), 'adapted preset id')
  const removedInjectionMetadata = source.promptDefinitions.filter(definition => definition.systemPrompt !== undefined
    || definition.forbidOverrides !== undefined || definition.injectionPosition !== undefined
    || definition.injectionDepth !== undefined || definition.injectionOrder !== undefined
    || definition.injectionTrigger !== undefined).length
  const promptDefinitions = source.promptDefinitions.map(definition => Object.freeze({
    id: definition.id,
    name: definition.name,
    role: definition.systemPrompt === true ? 'system' as const : definition.role,
    content: definition.content,
    marker: definition.marker,
  }))
  const adapted = normalizePreset({
    id,
    name: `${source.name} · Harness`,
    mode: 'harness',
    promptDefinitions,
    promptOrders: source.promptOrders,
    selectedPromptOrderId: source.selectedPromptOrderId,
    generation: source.generation,
    adaptation: {
      sourcePresetId: source.id,
      convertedAt: now,
      removedInjectionMetadata,
      inertExtensionWarnings: source.source?.warnings.length ?? 0,
      notes: [
        'Prompt order, enabled state, roles, markers, content, safe variables, and generation settings were retained.',
        'ST injection metadata was normalized to Harness sequential Prompt seats.',
        'Executable Regex and TavernHelper extensions remain inert.',
      ],
    },
    ...(source.source === undefined ? {} : { source: source.source }),
    updatedAt: now,
  })
  const existingIndex = state.presets.findIndex(preset => preset.id === id)
  const presets = existingIndex < 0 ? [...state.presets, adapted] : state.presets.map((preset, index) => index === existingIndex ? adapted : preset)
  return Object.freeze({ state: normalizeProductState({ ...state, revision: state.revision + 1, presets }), presetId: id })
}

/** Remove one entity while keeping every Session binding referentially valid. */
export function removeEntity(state: ProductState, kind: ProductEntityKind, id: string, baseRevision: number): ProductState {
  requireRevision(state, baseRevision)
  const targetId = normalizedId(id, `${kind} id`)
  const current = state[kind] as readonly ProductEntity[]
  if ((kind === 'systems' || kind === 'presets') && current.length === 1 && current[0]?.id === targetId) throw new Error(`the last ${kind} entry cannot be removed`)
  if (!current.some(item => item.id === targetId)) throw new Error(`${kind} ${JSON.stringify(targetId)} does not exist`)
  const nextCollection = current.filter(item => item.id !== targetId)
  const bindings = Object.fromEntries(Object.entries(state.bindings).map(([sessionId, binding]) => {
    const characterIds = kind === 'characters' ? binding.characterIds.filter(characterId => characterId !== targetId) : [...binding.characterIds]
    return [sessionId, {
      ...binding,
      ...(kind === 'systems' && binding.systemId === targetId ? { systemId: nextCollection[0]?.id } : {}),
      ...(kind === 'presets' && binding.presetId === targetId ? { presetId: nextCollection[0]?.id } : {}),
      ...(kind === 'characters' ? { characterIds, primaryCharacterId: binding.primaryCharacterId === targetId ? characterIds[0] ?? '' : binding.primaryCharacterId } : {}),
      ...(kind === 'personas' && binding.personaId === targetId ? { personaId: '' } : {}),
      ...(kind === 'worlds' && binding.worldId === targetId ? { worldId: '' } : {}),
    }]
  }))
  const runtimes = kind !== 'characters' ? state.runtimes : Object.fromEntries(Object.entries(state.runtimes).map(([sessionId, runtime]) => [sessionId, {
    ...runtime,
    castQueue: runtime.castQueue.filter(characterId => characterId !== targetId),
    lastSpeakerId: runtime.lastSpeakerId === targetId ? '' : runtime.lastSpeakerId,
  }]))
  return normalizeProductState({ ...state, revision: state.revision + 1, [kind]: nextCollection, bindings, runtimes })
}

/** Bind an exact preset and layered composition to one DSH Session. */
export function bindSession(state: ProductState, value: unknown, baseRevision: number, now = Date.now()): ProductState {
  requireRevision(state, baseRevision)
  const binding = normalizeComposition({ ...record(value, 'binding'), updatedAt: now })
  validateCompositionReferences(state, binding)
  return normalizeProductState({ ...state, revision: state.revision + 1, bindings: { ...state.bindings, [binding.sessionId]: binding } })
}

/** Select the speaker for the next Agent RP reply from the Session's configured cast. */
export function selectPrimaryCharacter(state: ProductState, sessionId: string, characterId: string, now = Date.now()): ProductState {
  const binding = state.bindings[sessionId]
  if (binding?.mode !== 'agent') throw new Error('speaker selection requires Agent RP mode')
  const id = normalizedId(characterId, 'speaker characterId')
  if (!binding.characterIds.includes(id)) throw new Error('speaker must belong to the Session character cast')
  if (!state.characters.some(character => character.id === id)) throw new Error('speaker character does not exist')
  return normalizeProductState({
    ...state,
    revision: state.revision + 1,
    bindings: { ...state.bindings, [sessionId]: { ...binding, primaryCharacterId: id, updatedAt: now } },
  })
}

/** Schedule one explicit ordered speaker queue from the Session's configured cast. */
export function scheduleCast(
  state: ProductState,
  sessionId: string,
  value: unknown,
  location?: RuntimeLocation,
): ProductState {
  const binding = state.bindings[sessionId]
  if (binding?.mode !== 'agent') throw new Error('cast scheduling requires Agent RP mode')
  const ids = array(value, 'cast queue').map((item, index) => normalizedId(item, `cast queue[${index}]`))
  if (ids.length === 0 || ids.length > 16) throw new Error('cast queue must contain 1-16 character ids')
  if (new Set(ids).size !== ids.length) throw new Error('cast queue repeats a character id')
  for (const id of ids) if (!binding.characterIds.includes(id)) throw new Error('cast queue characters must belong to the Session cast')
  const runtime = state.runtimes[sessionId] ?? emptyRuntime(sessionId)
  return normalizeProductState({
    ...state,
    revision: state.revision + 1,
    runtimes: { ...state.runtimes, [sessionId]: {
      ...runtime,
      revision: runtime.revision + 1,
      castQueue: ids,
      castRound: runtime.castRound + 1,
      ...(location === undefined ? {} : {
        castQueueTurn: location.turn,
        castQueueStep: location.step,
        castQueueSourceSeq: location.sourceSeq,
        lastCommitTurn: location.turn,
        lastCommitStep: location.step,
        lastCommitSourceSeq: location.sourceSeq,
      }),
    } },
  })
}

/** Consume the queue head and make it the primary speaker for the next final reply. */
export function advanceCastSpeaker(state: ProductState, sessionId: string, location?: RuntimeLocation, now = Date.now()): ProductState {
  const binding = state.bindings[sessionId]
  if (binding?.mode !== 'agent') throw new Error('speaker queue requires Agent RP mode')
  const runtime = state.runtimes[sessionId] ?? emptyRuntime(sessionId)
  const speakerId = runtime.castQueue[0]
  if (speakerId === undefined) throw new Error('speaker queue is empty; schedule the cast first')
  if (!binding.characterIds.includes(speakerId)) throw new Error('queued speaker no longer belongs to the Session cast')
  return normalizeProductState({
    ...state,
    revision: state.revision + 1,
    bindings: { ...state.bindings, [sessionId]: { ...binding, primaryCharacterId: speakerId, updatedAt: now } },
    runtimes: { ...state.runtimes, [sessionId]: {
      ...runtime,
      revision: runtime.revision + 1,
      castQueue: runtime.castQueue.slice(1),
      lastSpeakerId: speakerId,
      ...(location === undefined ? {} : {
        castQueueTurn: location.turn,
        castQueueStep: location.step,
        castQueueSourceSeq: location.sourceSeq,
        lastCommitTurn: location.turn,
        lastCommitStep: location.step,
        lastCommitSourceSeq: location.sourceSeq,
      }),
    } },
  })
}

/** Clone RP-owned projections into a native fork, clipped to the child's seeded event prefix. */
export function forkSessionProjection(
  state: ProductState,
  sourceSessionId: string,
  childSessionIdValue: string,
  childEventCount: number,
  maxTurn: number,
  now = Date.now(),
): ProductState {
  const sourceBinding = state.bindings[sourceSessionId]
  if (sourceBinding === undefined) throw new Error('fork source has no RP composition')
  const childSessionId = text(childSessionIdValue, 'fork child sessionId', 512)
  const cut = integer(childEventCount, 'fork childEventCount', 0, Number.MAX_SAFE_INTEGER)
  const turn = integer(maxTurn, 'fork maxTurn', 1, Number.MAX_SAFE_INTEGER)
  const binding: SessionComposition = Object.freeze({ ...sourceBinding, sessionId: childSessionId, updatedAt: now })
  const sourceTranscript = state.transcripts[sourceSessionId]
  const messages = sourceTranscript?.messages.filter(message => message.sourceSeq < cut && message.currentSurfaceSeq < cut) ?? []
  const sourceRuntime = state.runtimes[sourceSessionId]
  const effects = sourceRuntime?.effects.filter(effect => effect.sourceSeq !== undefined && effect.sourceSeq < cut && (effect.turn ?? turn) <= turn) ?? []
  const keepChoices = sourceRuntime?.choicesSourceSeq !== undefined && sourceRuntime.choicesSourceSeq < cut && (sourceRuntime.choicesTurn ?? turn) <= turn
  const keepCastQueue = sourceRuntime?.castQueueSourceSeq !== undefined && sourceRuntime.castQueueSourceSeq < cut && (sourceRuntime.castQueueTurn ?? turn) <= turn
  const last = effects.at(-1)
  const runtime = sourceRuntime === undefined ? undefined : Object.freeze({
    sessionId: childSessionId,
    revision: new Set(effects.map(effect => effect.callId)).size,
    effects: Object.freeze(effects),
    choicesTitle: keepChoices ? sourceRuntime.choicesTitle : '',
    choices: Object.freeze(keepChoices ? sourceRuntime.choices : []),
    selectedChoiceId: keepChoices ? sourceRuntime.selectedChoiceId : '',
    ...(keepChoices && sourceRuntime.choicesTurn !== undefined ? { choicesTurn: sourceRuntime.choicesTurn } : {}),
    ...(keepChoices && sourceRuntime.choicesStep !== undefined ? { choicesStep: sourceRuntime.choicesStep } : {}),
    ...(keepChoices && sourceRuntime.choicesSourceSeq !== undefined ? { choicesSourceSeq: sourceRuntime.choicesSourceSeq } : {}),
    ...(last?.turn === undefined ? {} : { lastCommitTurn: last.turn }),
    ...(last?.step === undefined ? {} : { lastCommitStep: last.step }),
    ...(last?.sourceSeq === undefined ? {} : { lastCommitSourceSeq: last.sourceSeq }),
    castQueue: Object.freeze(keepCastQueue ? sourceRuntime.castQueue : []),
    castRound: keepCastQueue ? sourceRuntime.castRound : 0,
    lastSpeakerId: keepCastQueue ? sourceRuntime.lastSpeakerId : '',
    ...(keepCastQueue && sourceRuntime.castQueueTurn !== undefined ? { castQueueTurn: sourceRuntime.castQueueTurn } : {}),
    ...(keepCastQueue && sourceRuntime.castQueueStep !== undefined ? { castQueueStep: sourceRuntime.castQueueStep } : {}),
    ...(keepCastQueue && sourceRuntime.castQueueSourceSeq !== undefined ? { castQueueSourceSeq: sourceRuntime.castQueueSourceSeq } : {}),
  })
  return normalizeProductState({
    ...state,
    revision: state.revision + 1,
    bindings: { ...state.bindings, [childSessionId]: binding },
    transcripts: sourceTranscript === undefined ? state.transcripts : {
      ...state.transcripts,
      [childSessionId]: { sessionId: childSessionId, messages },
    },
    runtimes: runtime === undefined ? state.runtimes : { ...state.runtimes, [childSessionId]: runtime },
  })
}

/** Record the selected speaker for one append-origin message. */
export function recordTranscriptMessage(state: ProductState, sessionId: string, sourceSeq: number, role: TranscriptRole, createdAt: number): ProductState {
  const binding = state.bindings[sessionId]
  if (binding === undefined) return state
  const transcript = state.transcripts[sessionId] ?? { sessionId, messages: [] }
  if (transcript.messages.some(message => message.sourceSeq === sourceSeq)) return state
  const speaker = role === 'assistant'
    ? state.characters.find(character => character.id === binding.primaryCharacterId)
    : state.personas.find(persona => persona.id === binding.personaId)
  const message: TranscriptMessage = {
    sourceSeq, currentSurfaceSeq: sourceSeq, role, speakerId: speaker?.id ?? '',
    speakerName: speaker?.name ?? (role === 'assistant' ? '角色' : '你'), synthetic: false,
    editRevision: 0, createdAt, updatedAt: createdAt,
  }
  return normalizeProductState({
    ...state, revision: state.revision + 1,
    transcripts: { ...state.transcripts, [sessionId]: { sessionId, messages: [...transcript.messages, message] } },
  })
}

/** Add a product-authored character opening to the transcript projection. */
export function recordOpeningMessage(state: ProductState, sessionId: string, sourceSeq: number, content: string, now = Date.now()): ProductState {
  const binding = state.bindings[sessionId]
  if (binding === undefined) throw new Error('RP Session has no composition')
  const character = state.characters.find(item => item.id === binding.primaryCharacterId)
  if (character === undefined) throw new Error('RP Session has no primary character')
  const transcript = state.transcripts[sessionId] ?? { sessionId, messages: [] }
  const message: TranscriptMessage = {
    sourceSeq, currentSurfaceSeq: sourceSeq, role: 'assistant', speakerId: character.id, speakerName: character.name,
    synthetic: true, editedContent: text(content, 'opening message', 32_000), editRevision: 0, createdAt: now, updatedAt: now,
  }
  return normalizeProductState({
    ...state, revision: state.revision + 1,
    transcripts: { ...state.transcripts, [sessionId]: { sessionId, messages: [...transcript.messages, message] } },
  })
}

/** Import validated Tavern history as synthetic transcript rows backed by append-only plugin messages. */
export function importTranscriptHistory(
  state: ProductState,
  sessionId: string,
  startSeq: number,
  value: unknown,
  now = Date.now(),
): ProductState {
  const binding = state.bindings[sessionId]
  if (binding === undefined) throw new Error('RP Session has no composition')
  const entries = array(value, 'chat messages')
  if (entries.length === 0 || entries.length > 500) throw new Error('chat history must contain 1-500 messages')
  let total = 0
  const imported = entries.map((value, index): TranscriptMessage => {
    const item = record(value, `chat messages[${index}]`)
    const role = transcriptRole(item.role)
    const speakerName = text(item.speakerName, `chat messages[${index}].speakerName`, 120)
    const content = text(item.content, `chat messages[${index}].content`, 32_000)
    total += content.length
    const speakerId = role === 'assistant'
      ? state.characters.find(character => character.name === speakerName)?.id ?? binding.primaryCharacterId
      : state.personas.find(persona => persona.name === speakerName)?.id ?? binding.personaId
    return Object.freeze({
      sourceSeq: startSeq + index,
      currentSurfaceSeq: startSeq + index,
      role,
      speakerId,
      speakerName,
      synthetic: true,
      editedContent: content,
      editRevision: 0,
      createdAt: now + index,
      updatedAt: now + index,
    })
  })
  if (total > 1_000_000) throw new Error('chat history exceeds 1,000,000 characters')
  const transcript = state.transcripts[sessionId] ?? { sessionId, messages: [] }
  return normalizeProductState({
    ...state,
    revision: state.revision + 1,
    transcripts: { ...state.transcripts, [sessionId]: { sessionId, messages: [...transcript.messages, ...imported] } },
  })
}

/** Commit one body edit and point its row at the replacement surface node. */
export function editTranscriptMessage(
  state: ProductState, sessionId: string, sourceSeq: number, expectedEditRevision: number,
  editedContent: string, replacementSeq: number, now = Date.now(),
): ProductState {
  const transcript = state.transcripts[sessionId]
  if (transcript === undefined) throw new Error('RP transcript is unavailable')
  const current = transcript.messages.find(message => message.sourceSeq === sourceSeq)
  if (current === undefined) throw new Error(`RP transcript message ${String(sourceSeq)} does not exist`)
  if (current.editRevision !== expectedEditRevision) throw new Error(`message edit revision conflict: expected ${String(expectedEditRevision)}, current ${String(current.editRevision)}`)
  const content = text(editedContent, 'edited message', 32_000)
  const messages = transcript.messages.map(message => message.sourceSeq === sourceSeq ? {
    ...message, currentSurfaceSeq: replacementSeq, editedContent: content,
    editRevision: message.editRevision + 1, updatedAt: now,
  } : message)
  return normalizeProductState({
    ...state, revision: state.revision + 1,
    transcripts: { ...state.transcripts, [sessionId]: { sessionId, messages } },
  })
}

/** Commit one Agent RP domain effect as a revisioned projection. */
export function applyRuntimeEffect(
  state: ProductState,
  sessionId: string,
  callId: string,
  value: unknown,
  now = Date.now(),
  location?: RuntimeLocation,
): ProductState {
  return commitRuntimeTurn(state, sessionId, callId, { updates: [value] }, now, location)
}

/** Atomically commit one turn's N→N+1 world ledger and optional user choices. */
export function commitRuntimeTurn(
  state: ProductState,
  sessionId: string,
  callIdValue: string,
  value: unknown,
  now = Date.now(),
  location?: RuntimeLocation,
): ProductState {
  const binding = state.bindings[sessionId]
  if (binding?.mode !== 'agent') throw new Error('RP domain effects require Agent RP mode')
  const item = record(value, 'runtime turn')
  const updates = array(item.updates ?? [], 'runtime turn updates')
  if (updates.length > 32) throw new Error('runtime turn accepts at most 32 state updates')
  const hasChoices = item.choices !== undefined
  const callId = text(callIdValue, 'turn callId', 512)
  const runtime = state.runtimes[sessionId] ?? emptyRuntime(sessionId)
  const committed = updates.map((value, index): RuntimeEffect => {
    const update = record(value, `runtime turn updates[${index}]`)
    return Object.freeze({
      id: promptId(`effect-${callId.slice(0, 218)}-${String(index)}`, 'effect id'),
      callId,
      kind: runtimeEffectKind(update.kind),
      title: text(update.title, `runtime turn updates[${index}].title`, 240),
      summary: text(update.summary, `runtime turn updates[${index}].summary`, 8_000),
      data: jsonObject(update.data ?? {}, `runtime turn updates[${index}].data`),
      createdAt: now,
      ...(location === undefined ? {} : location),
    })
  })
  const effects = [...runtime.effects.filter(existing => existing.callId !== callId), ...committed].slice(-500)
  const choices = hasChoices ? runtimeChoices(item.choices, true) : runtime.choices
  return normalizeProductState({
    ...state,
    revision: state.revision + 1,
    runtimes: { ...state.runtimes, [sessionId]: {
      ...runtime,
      revision: runtime.revision + 1,
      effects,
      ...(location === undefined ? {} : {
        lastCommitTurn: location.turn,
        lastCommitStep: location.step,
        lastCommitSourceSeq: location.sourceSeq,
      }),
      ...(hasChoices ? {
        choicesTitle: choices.length === 0 ? '' : text(item.choicesTitle ?? '接下来做什么？', 'choices title', 240),
        choices,
        selectedChoiceId: '',
        ...(location === undefined ? {} : {
          choicesTurn: location.turn,
          choicesStep: location.step,
          choicesSourceSeq: location.sourceSeq,
        }),
      } : {}),
    } },
  })
}

/** Replace the active structured options proposed for one Agent RP Session. */
export function replaceRuntimeChoices(
  state: ProductState,
  sessionId: string,
  callId: string,
  titleValue: unknown,
  choicesValue: unknown,
  location?: RuntimeLocation,
): ProductState {
  const binding = state.bindings[sessionId]
  if (binding?.mode !== 'agent') throw new Error('RP choices require Agent RP mode')
  const choices = runtimeChoices(choicesValue, false)
  const runtime = state.runtimes[sessionId] ?? emptyRuntime(sessionId)
  return normalizeProductState({
    ...state,
    revision: state.revision + 1,
    runtimes: { ...state.runtimes, [sessionId]: {
      ...runtime,
      revision: runtime.revision + 1,
      choicesTitle: text(titleValue, 'choices title', 240),
      choices,
      selectedChoiceId: '',
      effects: runtime.effects,
      ...(location === undefined ? {} : {
        choicesTurn: location.turn,
        choicesStep: location.step,
        choicesSourceSeq: location.sourceSeq,
        lastCommitTurn: location.turn,
        lastCommitStep: location.step,
        lastCommitSourceSeq: location.sourceSeq,
      }),
      lastChoiceCallId: callId,
    } },
  })
}

/** Project the last committed value for each stable state key. */
export function currentRuntimeEffects(runtime: SessionRuntimeState): readonly RuntimeEffect[] {
  const current = new Map<string, RuntimeEffect>()
  for (const effect of runtime.effects) {
    const keyValue = effect.data.key ?? effect.data.target ?? effect.data.id ?? effect.data.name
    const key = `${effect.kind}:${typeof keyValue === 'string' && keyValue.trim() !== '' ? keyValue : effect.title}`
    current.delete(key)
    current.set(key, effect)
  }
  return Object.freeze([...current.values()])
}

/** Mark one proposed option selected before its prompt enters the native Session. */
export function selectRuntimeChoice(state: ProductState, sessionId: string, choiceId: string): ProductState {
  const runtime = state.runtimes[sessionId]
  if (runtime === undefined || !runtime.choices.some(choice => choice.id === choiceId)) throw new Error('RP choice does not exist')
  return normalizeProductState({
    ...state,
    revision: state.revision + 1,
    runtimes: { ...state.runtimes, [sessionId]: { ...runtime, revision: runtime.revision + 1, selectedChoiceId: choiceId } },
  })
}

/** Render committed Agent RP facts for the next request header. */
export function renderRuntimeContext(state: ProductState, sessionId: string): string {
  const runtime = state.runtimes[sessionId]
  if (runtime === undefined || runtime.effects.length === 0) return ''
  return `<rp-dynamic-state revision="${String(runtime.revision)}">\n${currentRuntimeEffects(runtime).slice(-80).map(effect =>
    `[${effect.kind}] ${effect.title}: ${effect.summary}\n${JSON.stringify(runtimeContextData(effect))}`).join('\n')}\n</rp-dynamic-state>`
}

function runtimeContextData(effect: RuntimeEffect): JsonObject {
  if (effect.kind !== 'media') return effect.data
  const artifact = effect.data.artifact
  if (typeof artifact !== 'object' || artifact === null || Array.isArray(artifact)) return {}
  return Object.fromEntries(Object.entries(artifact).filter(([key, value]) => key !== 'uri' && key !== 'metadata'
    && (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'))) as JsonObject
}

/** Resolve the ordered, enabled Prompt Manager stack for one Session. */
export function resolvePromptLayers(state: ProductState, sessionId: string, currentUserMessage = ''): readonly PromptLayer[] {
  const binding = state.bindings[sessionId]
  const preset = binding === undefined ? undefined : state.presets.find(item => item.id === binding.presetId)
  const order = preset?.promptOrders.find(item => item.id === preset.selectedPromptOrderId)
  if (binding === undefined || preset === undefined || order === undefined) return Object.freeze([])
  const definitions = new Map(preset.promptDefinitions.map(item => [item.id, item]))
  const material = promptMaterial(state, binding, currentUserMessage)
  const variables = new Map<string, string>()
  let worldEmitted = false
  const layers: PromptLayer[] = []
  for (const entry of order.entries) {
    if (!entry.enabled) continue
    const definition = definitions.get(entry.identifier)
    if (definition === undefined) continue
    const resolved = definition.marker
      ? markerMaterial(definition.id, material, worldEmitted)
      : promptDefinitionMaterial(definition, material, variables)
    if (resolved.kind === 'world' && resolved.content !== '') worldEmitted = true
    layers.push(Object.freeze({ id: definition.id, role: definition.role, marker: definition.marker, ...resolved, empty: resolved.content.trim() === '' }))
  }
  return Object.freeze(layers)
}

/** Resolve supported DSH request fields from the active Tavern preset. */
export function resolveGenerationSettings(state: ProductState, sessionId: string): GenerationSettings | undefined {
  const binding = state.bindings[sessionId]
  return binding === undefined ? undefined : state.presets.find(preset => preset.id === binding.presetId)?.generation
}

/** Render one prompt layer with explicit semantic and imported-role tags. */
export function renderPromptLayer(layer: PromptLayer): string {
  if (layer.empty || layer.kind === 'history') return ''
  if (layer.role === 'assistant' && isPrivatePlanningPrefill(layer.content)) {
    return `<st-assistant-prefill id="${escapeAttribute(layer.id)}" semantic="${layer.kind}" visibility="private-reasoning">
The imported Assistant Prefill below is a private planning seed. Apply it in the provider reasoning channel. Never quote, continue, close, summarize, or expose its markup or planning content in the visible Assistant response.
<st-prefill-source>${escapePromptText(layer.content)}</st-prefill-source>
</st-assistant-prefill>`
  }
  if (layer.role === 'assistant') return `<st-assistant-prefill id="${escapeAttribute(layer.id)}" semantic="${layer.kind}">\n${layer.content}\n</st-assistant-prefill>`
  if (layer.role === 'user') return `<st-user-message id="${escapeAttribute(layer.id)}" semantic="${layer.kind}">\n${layer.content}\n</st-user-message>`
  return `<rp-${layer.kind} id="${escapeAttribute(layer.id)}" role="${layer.role}">\n${layer.content}\n</rp-${layer.kind}>`
}

/** Return the selected primary character for one Session. */
export function primaryCharacter(state: ProductState, sessionId: string): CharacterProfile | undefined {
  const binding = state.bindings[sessionId]
  return binding === undefined ? undefined : state.characters.find(character => character.id === binding.primaryCharacterId)
}

/** Expand safe character-card identity macros for one Session. */
export function resolveCharacterText(state: ProductState, sessionId: string, content: string): string {
  const binding = state.bindings[sessionId]
  if (binding === undefined) return content
  const characterName = state.characters.find(character => character.id === binding.primaryCharacterId)?.name ?? '角色'
  const personaName = state.personas.find(persona => persona.id === binding.personaId)?.name ?? '用户'
  return expandResourceMacros(content, characterName, personaName)
}

function defaultPromptPreset(): PromptPreset {
  const definitions: PromptDefinition[] = [
    { id: 'main', name: '系统主提示', role: 'system', content: '{{system}}', marker: false },
    { id: 'worldInfoBefore', name: '世界书（前）', role: 'system', content: '', marker: true },
    { id: 'personaDescription', name: '用户人设', role: 'system', content: '', marker: true },
    { id: 'charDescription', name: '角色描述', role: 'system', content: '', marker: true },
    { id: 'charPersonality', name: '角色性格', role: 'system', content: '', marker: true },
    { id: 'scenario', name: '场景', role: 'system', content: '', marker: true },
    { id: 'dialogueExamples', name: '对话示例', role: 'system', content: '', marker: true },
    { id: 'chatHistory', name: '聊天记录', role: 'system', content: '', marker: true },
    { id: 'worldInfoAfter', name: '世界书（后）', role: 'system', content: '', marker: true },
    { id: 'responseRules', name: '回复约束', role: 'system', content: '下一条回复继续扮演 {{char}}；不得把 {{user}} 的人设写成角色自身设定。', marker: false },
  ]
  return Object.freeze({
    id: 'tavern-immersive', name: '酒馆沉浸预设', mode: 'harness',
    promptDefinitions: Object.freeze(definitions.map(item => Object.freeze(item))),
    promptOrders: Object.freeze([Object.freeze({
      id: 'global', entries: Object.freeze(definitions.map(item => Object.freeze({ identifier: item.id, enabled: item.id !== 'worldInfoAfter' }))),
    })]),
    selectedPromptOrderId: 'global',
    generation: Object.freeze({ temperature: 0.9, maxTokens: 8192, retained: Object.freeze({}) }), updatedAt: 0,
  })
}

interface PromptMaterial {
  readonly system: string
  readonly world: string
  readonly characterDescription: string
  readonly characterPersonality: string
  readonly persona: string
  readonly scenario: string
  readonly examples: string
  readonly characterName: string
  readonly personaName: string
  readonly lastUserMessage: string
}

function promptMaterial(state: ProductState, binding: SessionComposition, currentUserMessage: string): PromptMaterial {
  const system = state.systems.find(item => item.id === binding.systemId)
  const world = state.worlds.find(item => item.id === binding.worldId)
  const persona = state.personas.find(item => item.id === binding.personaId)
  const characters = binding.characterIds.map(id => state.characters.find(item => item.id === id)).filter((item): item is CharacterProfile => item !== undefined)
  const primary = characters.find(item => item.id === binding.primaryCharacterId) ?? characters[0]
  const supporting = characters.filter(item => item.id !== primary?.id)
  const characterName = primary?.name ?? '角色'
  const personaName = persona?.name ?? '用户'
  const expand = (value: string): string => expandResourceMacros(value, characterName, personaName)
  return {
    system: system === undefined ? '' : [expand(system.directive), `叙事语调：${expand(system.tone)}`, `边界：${expand(system.boundaries)}`].join('\n'),
    world: world === undefined ? '' : [
      `世界：${world.name}`, `概览：${expand(world.overview)}`, `规则：${expand(world.rules)}`, `地点：${expand(world.locations)}`, `背景知识：${expand(world.lore)}`,
      ...world.entries.filter(entry => entry.enabled).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
        .map(entry => `世界书条目「${entry.name || entry.id}」${entry.keys.length === 0 ? '' : `（关键词：${entry.keys.join('、')}）`}：${expand(entry.content)}`),
      '世界观只定义环境、历史与客观规则，不自动决定任何角色的意志。',
    ].join('\n'),
    characterDescription: primary === undefined ? '' : [
      `当前主要角色：${primary.name}`, `角色摘要：${expand(primary.summary)}`, `外观：${expand(primary.appearance)}`, `目标：${expand(primary.goals)}`,
      ...(supporting.length === 0 ? [] : ['', '配角阵容：', ...supporting.map(item => `- ${item.name}：${expand(item.summary)}`)]),
      '角色设定描述的是你要扮演的人物，不得用它覆盖用户人设或世界事实。',
    ].join('\n'),
    characterPersonality: primary === undefined ? '' : [`性格：${expand(primary.personality)}`, `说话方式：${expand(primary.speechStyle)}`].join('\n'),
    persona: persona === undefined ? '' : [
      `用户身份：${expand(persona.description)}`, `用户特征：${expand(persona.traits)}`, `关系背景：${expand(persona.relationship)}`, `称呼用户：${expand(persona.addressAs)}`,
      '用户人设描述的是对话中的用户，不是你要扮演的角色。不得替用户决定言语、动作或内心。',
    ].join('\n'),
    scenario: [expand(primary?.scenario ?? ''), expand(binding.scene)].filter(value => value.trim() !== '').join('\n\n'),
    examples: primary?.examples.map(expand).join('\n\n') ?? '', characterName, personaName,
    lastUserMessage: currentUserMessage,
  }
}

function markerMaterial(id: string, material: PromptMaterial, worldEmitted: boolean): Omit<PromptLayer, 'id' | 'role' | 'marker' | 'empty'> {
  const key = id.toLocaleLowerCase().replace(/[^a-z]/gu, '')
  if (key.includes('chat') && key.includes('history')) return { kind: 'history', title: '聊天记录', subtitle: 'DSH 原生历史位置', content: '', accent: '#718096' }
  if (key.includes('world') || key.includes('lore')) return { kind: 'world', title: '世界观', subtitle: worldEmitted ? '已在更早 Marker 注入' : '世界书 Marker', content: worldEmitted ? '' : material.world, accent: '#42b883' }
  if (key.includes('personality')) return { kind: 'character', title: '角色性格', subtitle: material.characterName, content: material.characterPersonality, accent: '#f47f6b' }
  if (key.includes('persona') || key.includes('userdescription')) return { kind: 'persona', title: '用户人设', subtitle: material.personaName, content: material.persona, accent: '#36b8d4' }
  if (key.includes('character') || key.includes('chardescription')) return { kind: 'character', title: '角色描述', subtitle: material.characterName, content: material.characterDescription, accent: '#f47f6b' }
  if (key.includes('scenario') || key.includes('scene')) return { kind: 'scene', title: '当前场景', subtitle: '会话场景', content: material.scenario, accent: '#e7a84f' }
  if (key.includes('example')) return { kind: 'examples', title: '对话示例', subtitle: material.characterName, content: material.examples, accent: '#c084fc' }
  if (key === 'main' || key.includes('system')) return { kind: 'system', title: '系统规则', subtitle: '系统 Marker', content: material.system, accent: '#8b7cf6' }
  return { kind: 'custom', title: id, subtitle: '未映射 Marker', content: '', accent: '#718096' }
}

function expandMacros(content: string, material: PromptMaterial, variables: Map<string, string>): string {
  const assigned = content.replace(/\{\{setvar::([^:{}]+)::([\s\S]*?)\}\}/gu, (_match, name: string, value: string) => {
    variables.set(name, value)
    return ''
  })
  return assigned.replace(/\{\{getvar::([^:{}]+)\}\}/gu, (_match, name: string) => variables.get(name) ?? '')
    .replace(/\{\{\/\/[^{}]*\}\}/gu, '')
    .replaceAll('{{lastUserMessage}}', material.lastUserMessage || '[当前没有可用的用户消息]')
    .replaceAll('{{system}}', material.system).replaceAll('{{char}}', material.characterName)
    .replaceAll('{{user}}', material.personaName).replaceAll('{{persona}}', material.persona)
    .replaceAll('{{world}}', material.world).replaceAll('{{scenario}}', material.scenario)
}

function promptDefinitionMaterial(
  definition: PromptDefinition,
  material: PromptMaterial,
  variables: Map<string, string>,
): Omit<PromptLayer, 'id' | 'role' | 'marker' | 'empty'> {
  if (definition.content.trim() === '{{system}}') {
    return { kind: 'system', title: definition.name, subtitle: '系统规则', content: material.system, accent: '#8b7cf6' }
  }
  return {
    kind: 'custom', title: definition.name, subtitle: definition.role.toUpperCase(),
    content: expandMacros(definition.content, material, variables), accent: roleAccent(definition.role),
  }
}

function expandResourceMacros(content: string, characterName: string, personaName: string): string {
  return content.replaceAll('{{char}}', characterName).replaceAll('{{user}}', personaName)
}

function isPrivatePlanningPrefill(content: string): boolean {
  return /<[^>]*(?:planning|thinking|reasoning)[^>]*>/iu.test(content)
}

function escapePromptText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function normalizeSystem(value: unknown): SystemProfile {
  const item = record(value, 'system profile')
  return Object.freeze({
    id: normalizedId(item.id, 'system id'), name: text(item.name, 'system name', 120), directive: text(item.directive, 'system directive', 16_000),
    tone: optionalText(item.tone, 'system tone', 4_000), boundaries: optionalText(item.boundaries, 'system boundaries', 8_000), updatedAt: timestamp(item.updatedAt),
  })
}

function normalizeCharacter(value: unknown): CharacterProfile {
  const item = record(value, 'character profile')
  return Object.freeze({
    id: normalizedId(item.id, 'character id'), name: text(item.name, 'character name', 120), summary: text(item.summary, 'character summary', 16_000),
    personality: optionalText(item.personality, 'character personality', 16_000), speechStyle: optionalText(item.speechStyle, 'character speech style', 8_000),
    appearance: optionalText(item.appearance, 'character appearance', 8_000), goals: optionalText(item.goals, 'character goals', 8_000),
    scenario: optionalText(item.scenario, 'character scenario', 16_000), openingMessage: optionalText(item.openingMessage, 'opening message', 32_000),
    alternateGreetings: Object.freeze(stringList(item.alternateGreetings, 'alternateGreetings', 32, 32_000)),
    examples: Object.freeze(stringList(item.examples, 'examples', 64, 64_000)), tags: Object.freeze(stringList(item.tags, 'tags', 128, 256)),
    accent: accent(item.accent, '#f47f6b'), ...optionalAvatar(item.avatar), ...optionalSource(item.source), updatedAt: timestamp(item.updatedAt),
  })
}

function normalizePersona(value: unknown): PersonaProfile {
  const item = record(value, 'persona profile')
  return Object.freeze({
    id: normalizedId(item.id, 'persona id'), name: text(item.name, 'persona name', 120), description: text(item.description, 'persona description', 16_000),
    traits: optionalText(item.traits, 'persona traits', 8_000), relationship: optionalText(item.relationship, 'persona relationship', 8_000),
    addressAs: optionalText(item.addressAs, 'persona address', 120), ...optionalSource(item.source), updatedAt: timestamp(item.updatedAt),
  })
}

function normalizeWorld(value: unknown): WorldProfile {
  const item = record(value, 'world profile')
  return Object.freeze({
    id: normalizedId(item.id, 'world id'), name: text(item.name, 'world name', 120), overview: text(item.overview, 'world overview', 16_000),
    rules: optionalText(item.rules, 'world rules', 16_000), locations: optionalText(item.locations, 'world locations', 16_000),
    lore: optionalText(item.lore, 'world lore', 128_000),
    entries: Object.freeze((item.entries === undefined ? [] : array(item.entries, 'world entries')).map(normalizeWorldEntry)),
    accent: accent(item.accent, '#42b883'), ...optionalSource(item.source), updatedAt: timestamp(item.updatedAt),
  })
}

function normalizeWorldEntry(value: unknown, index: number): WorldEntry {
  const item = record(value, `world entries[${index}]`)
  return Object.freeze({
    id: promptId(item.id, `world entries[${index}].id`),
    name: optionalText(item.name, `world entries[${index}].name`, 240),
    content: text(item.content, `world entries[${index}].content`, 64_000),
    keys: Object.freeze(stringList(item.keys, `world entries[${index}].keys`, 128, 512)),
    secondaryKeys: Object.freeze(stringList(item.secondaryKeys, `world entries[${index}].secondaryKeys`, 128, 512)),
    enabled: bool(item.enabled, `world entries[${index}].enabled`),
    constant: bool(item.constant, `world entries[${index}].constant`),
    priority: integer(item.priority, `world entries[${index}].priority`, -1_000_000, 1_000_000),
  })
}

function normalizePreset(value: unknown): PromptPreset {
  const item = record(value, 'prompt preset')
  const definitions = array(item.promptDefinitions, 'promptDefinitions').map((value, index) => {
    const definition = record(value, `promptDefinitions[${index}]`)
    return Object.freeze({
      id: promptId(definition.id, `promptDefinitions[${index}].id`), name: text(definition.name, `promptDefinitions[${index}].name`, 240),
      role: promptRole(definition.role, `promptDefinitions[${index}].role`), content: optionalText(definition.content, `promptDefinitions[${index}].content`, 128_000),
      marker: bool(definition.marker, `promptDefinitions[${index}].marker`),
      ...(definition.systemPrompt === undefined ? {} : { systemPrompt: bool(definition.systemPrompt, `promptDefinitions[${index}].systemPrompt`) }),
      ...(definition.forbidOverrides === undefined ? {} : { forbidOverrides: bool(definition.forbidOverrides, `promptDefinitions[${index}].forbidOverrides`) }),
      ...(definition.injectionPosition === undefined ? {} : { injectionPosition: finiteNumber(definition.injectionPosition, `promptDefinitions[${index}].injectionPosition`) }),
      ...(definition.injectionDepth === undefined ? {} : { injectionDepth: integer(definition.injectionDepth, `promptDefinitions[${index}].injectionDepth`, 0, Number.MAX_SAFE_INTEGER) }),
      ...(definition.injectionOrder === undefined ? {} : { injectionOrder: integer(definition.injectionOrder, `promptDefinitions[${index}].injectionOrder`, 0, Number.MAX_SAFE_INTEGER) }),
      ...(definition.injectionTrigger === undefined ? {} : { injectionTrigger: Object.freeze(stringList(definition.injectionTrigger, `promptDefinitions[${index}].injectionTrigger`, 128, 512)) }),
    })
  })
  if (definitions.length > PRODUCT_PROMPT_DEFINITION_LIMIT) {
    throw new Error(`prompt preset exceeds ${String(PRODUCT_PROMPT_DEFINITION_LIMIT)} definitions`)
  }
  validateUnique(definitions, 'prompt definition')
  const definitionIds = new Set(definitions.map(definition => definition.id))
  const promptOrders = array(item.promptOrders, 'promptOrders').map((value, orderIndex) => {
    const order = record(value, `promptOrders[${orderIndex}]`)
    const entries = array(order.entries, `promptOrders[${orderIndex}].entries`).map((value, entryIndex) => {
      const entry = record(value, `promptOrders[${orderIndex}].entries[${entryIndex}]`)
      const identifier = promptId(entry.identifier, `promptOrders[${orderIndex}].entries[${entryIndex}].identifier`)
      if (!definitionIds.has(identifier)) throw new Error(`prompt order references missing definition ${JSON.stringify(identifier)}`)
      return Object.freeze({ identifier, enabled: bool(entry.enabled, 'prompt order enabled') })
    })
    if (entries.length > PRODUCT_PROMPT_SEAT_COUNT) throw new Error(`prompt order exceeds ${String(PRODUCT_PROMPT_SEAT_COUNT)} entries`)
    if (new Set(entries.map(entry => entry.identifier)).size !== entries.length) throw new Error('prompt order repeats an identifier')
    return Object.freeze({ id: promptId(order.id, `promptOrders[${orderIndex}].id`), entries: Object.freeze(entries) })
  })
  validateUnique(promptOrders, 'prompt order')
  if (definitions.length === 0 || promptOrders.length === 0) throw new Error('prompt preset requires definitions and an order')
  const selectedPromptOrderId = promptId(item.selectedPromptOrderId, 'selectedPromptOrderId')
  if (!promptOrders.some(order => order.id === selectedPromptOrderId)) throw new Error('selectedPromptOrderId does not exist')
  return Object.freeze({
    id: normalizedId(item.id, 'preset id'), name: text(item.name, 'preset name', 240), mode: presetMode(item.mode, item.source), promptDefinitions: Object.freeze(definitions),
    promptOrders: Object.freeze(promptOrders), selectedPromptOrderId, generation: normalizeGeneration(item.generation),
    ...optionalAdaptation(item.adaptation), ...optionalSource(item.source), updatedAt: timestamp(item.updatedAt),
  })
}

function normalizeComposition(value: unknown, fallbackSessionId?: string): SessionComposition {
  const item = record(value, 'session composition')
  const characterIds = array(item.characterIds, 'characterIds').map((id, index) => normalizedId(id, `characterIds[${index}]`))
  const uniqueCharacters = [...new Set(characterIds)]
  const primaryCharacterId = optionalId(item.primaryCharacterId, 'primaryCharacterId') || uniqueCharacters[0] || ''
  const experienceId = optionalText(item.experienceId, 'experienceId', 128) || 'rp-adaptive'
  if (!['rp-adaptive', 'rp-world-sim', 'rp-multi-character', 'rp-trpg', 'rp-companion'].includes(experienceId)) throw new Error('experienceId is not a supported RP Experience')
  if (experienceId === 'rp-multi-character' && uniqueCharacters.length < 2) throw new Error('Multi-character requires at least two configured characters')
  if (primaryCharacterId !== '' && !uniqueCharacters.includes(primaryCharacterId)) throw new Error('primaryCharacterId must appear in characterIds')
  return Object.freeze({
    sessionId: text(item.sessionId ?? fallbackSessionId, 'session id', 512), presetId: normalizedId(item.presetId, 'presetId'),
    mode: productSessionMode(item.mode),
    experienceId,
    systemId: normalizedId(item.systemId, 'systemId'), characterIds: Object.freeze(uniqueCharacters), primaryCharacterId,
    personaId: optionalId(item.personaId, 'personaId'), worldId: optionalId(item.worldId, 'worldId'),
    scene: optionalText(item.scene, 'scene', 16_000), updatedAt: timestamp(item.updatedAt),
  })
}

function normalizeTranscript(value: unknown, fallbackSessionId: string): SessionTranscript {
  const item = record(value, 'session transcript')
  const messages = array(item.messages, 'transcript messages').map((value, index) => {
    const message = record(value, `transcript messages[${index}]`)
    return Object.freeze({
      sourceSeq: integer(message.sourceSeq, 'sourceSeq', 0, Number.MAX_SAFE_INTEGER),
      currentSurfaceSeq: integer(message.currentSurfaceSeq, 'currentSurfaceSeq', 0, Number.MAX_SAFE_INTEGER),
      role: transcriptRole(message.role), speakerId: optionalId(message.speakerId, 'speakerId'), speakerName: text(message.speakerName, 'speakerName', 120),
      synthetic: bool(message.synthetic, 'synthetic'),
      ...(message.editedContent === undefined ? {} : { editedContent: text(message.editedContent, 'editedContent', 32_000) }),
      editRevision: integer(message.editRevision, 'editRevision', 0, Number.MAX_SAFE_INTEGER),
      createdAt: integer(message.createdAt, 'createdAt', 0, Number.MAX_SAFE_INTEGER), updatedAt: integer(message.updatedAt, 'updatedAt', 0, Number.MAX_SAFE_INTEGER),
    })
  })
  if (new Set(messages.map(message => message.sourceSeq)).size !== messages.length) throw new Error('transcript repeats sourceSeq')
  return Object.freeze({ sessionId: text(item.sessionId ?? fallbackSessionId, 'transcript sessionId', 512), messages: Object.freeze(messages) })
}

function normalizeRuntime(value: unknown, fallbackSessionId: string): SessionRuntimeState {
  const item = record(value, 'session runtime')
  const effects = array(item.effects, 'runtime effects').map((value, index) => {
    const effect = record(value, `runtime effects[${index}]`)
    return Object.freeze({
      id: promptId(effect.id, 'effect id'), callId: text(effect.callId, 'effect callId', 512),
      kind: runtimeEffectKind(effect.kind), title: text(effect.title, 'effect title', 240),
      summary: text(effect.summary, 'effect summary', 8_000), data: jsonObject(effect.data ?? {}, 'effect data'),
      createdAt: integer(effect.createdAt, 'effect createdAt', 0, Number.MAX_SAFE_INTEGER),
      ...(effect.turn === undefined ? {} : { turn: integer(effect.turn, 'effect turn', 1, Number.MAX_SAFE_INTEGER) }),
      ...(effect.step === undefined ? {} : { step: integer(effect.step, 'effect step', 1, Number.MAX_SAFE_INTEGER) }),
      ...(effect.sourceSeq === undefined ? {} : { sourceSeq: integer(effect.sourceSeq, 'effect sourceSeq', 0, Number.MAX_SAFE_INTEGER) }),
    })
  })
  const choices = (item.choices === undefined ? [] : array(item.choices, 'runtime choices')).map((value, index) => {
    const choice = record(value, `runtime choices[${index}]`)
    return Object.freeze({ id: promptId(choice.id, 'choice id'), label: text(choice.label, 'choice label', 240), prompt: text(choice.prompt, 'choice prompt', 4_000) })
  })
  return Object.freeze({
    sessionId: text(item.sessionId ?? fallbackSessionId, 'runtime sessionId', 512),
    revision: integer(item.revision, 'runtime revision', 0, Number.MAX_SAFE_INTEGER),
    effects: Object.freeze(effects.slice(-500)),
    choicesTitle: optionalText(item.choicesTitle, 'choicesTitle', 240),
    choices: Object.freeze(choices),
    selectedChoiceId: optionalText(item.selectedChoiceId, 'selectedChoiceId', 240),
    ...(item.choicesTurn === undefined ? {} : { choicesTurn: integer(item.choicesTurn, 'choicesTurn', 1, Number.MAX_SAFE_INTEGER) }),
    ...(item.choicesStep === undefined ? {} : { choicesStep: integer(item.choicesStep, 'choicesStep', 1, Number.MAX_SAFE_INTEGER) }),
    ...(item.choicesSourceSeq === undefined ? {} : { choicesSourceSeq: integer(item.choicesSourceSeq, 'choicesSourceSeq', 0, Number.MAX_SAFE_INTEGER) }),
    ...(item.lastCommitTurn === undefined ? {} : { lastCommitTurn: integer(item.lastCommitTurn, 'lastCommitTurn', 1, Number.MAX_SAFE_INTEGER) }),
    ...(item.lastCommitStep === undefined ? {} : { lastCommitStep: integer(item.lastCommitStep, 'lastCommitStep', 1, Number.MAX_SAFE_INTEGER) }),
    ...(item.lastCommitSourceSeq === undefined ? {} : { lastCommitSourceSeq: integer(item.lastCommitSourceSeq, 'lastCommitSourceSeq', 0, Number.MAX_SAFE_INTEGER) }),
    castQueue: Object.freeze(stringList(item.castQueue, 'castQueue', 16, 128).map((id, index) => normalizedId(id, `castQueue[${index}]`))),
    castRound: integer(item.castRound ?? 0, 'castRound', 0, Number.MAX_SAFE_INTEGER),
    lastSpeakerId: optionalId(item.lastSpeakerId, 'lastSpeakerId'),
    ...(item.castQueueTurn === undefined ? {} : { castQueueTurn: integer(item.castQueueTurn, 'castQueueTurn', 1, Number.MAX_SAFE_INTEGER) }),
    ...(item.castQueueStep === undefined ? {} : { castQueueStep: integer(item.castQueueStep, 'castQueueStep', 1, Number.MAX_SAFE_INTEGER) }),
    ...(item.castQueueSourceSeq === undefined ? {} : { castQueueSourceSeq: integer(item.castQueueSourceSeq, 'castQueueSourceSeq', 0, Number.MAX_SAFE_INTEGER) }),
  })
}

function emptyRuntime(sessionId: string): SessionRuntimeState {
  return Object.freeze({
    sessionId, revision: 0, effects: Object.freeze([]), choicesTitle: '', choices: Object.freeze([]), selectedChoiceId: '',
    castQueue: Object.freeze([]), castRound: 0, lastSpeakerId: '',
  })
}

function runtimeEffectKind(value: unknown): RuntimeEffectKind {
  if (value === 'world' || value === 'time' || value === 'scene' || value === 'character'
    || value === 'persona' || value === 'relationship' || value === 'memory' || value === 'npc'
    || value === 'objective' || value === 'inventory' || value === 'media') return value
  throw new Error('runtime effect kind is invalid')
}

function runtimeChoices(value: unknown, allowEmpty: boolean): readonly RuntimeChoice[] {
  const choices = array(value, 'choices').map((value, index) => {
    const item = record(value, `choices[${index}]`)
    return Object.freeze({
      id: promptId(item.id, `choices[${index}].id`),
      label: text(item.label, `choices[${index}].label`, 240),
      prompt: text(item.prompt, `choices[${index}].prompt`, 4_000),
    })
  })
  if (choices.length > 8 || !allowEmpty && choices.length === 0) throw new Error(`choices must contain ${allowEmpty ? '0-8' : '1-8'} options`)
  if (new Set(choices.map(choice => choice.id)).size !== choices.length) throw new Error('choices repeat an id')
  return Object.freeze(choices)
}

function normalizeGeneration(value: unknown): GenerationSettings {
  const item = record(value, 'generation settings')
  const temperature = optionalNumber(item.temperature, 'temperature', 0, 2)
  const maxTokens = item.maxTokens === undefined ? undefined : integer(item.maxTokens, 'maxTokens', 1, 1_000_000)
  const reasoningEffort = item.reasoningEffort === undefined || item.reasoningEffort === '' ? undefined : text(item.reasoningEffort, 'reasoningEffort', 64)
  const retained = Object.fromEntries(Object.entries(record(item.retained ?? {}, 'generation retained')).map(([key, entry]) => {
    if (entry !== null && typeof entry !== 'boolean' && typeof entry !== 'number' && typeof entry !== 'string') throw new Error(`generation retained ${JSON.stringify(key)} must be a JSON scalar`)
    if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error(`generation retained ${JSON.stringify(key)} must be finite`)
    return [key, entry]
  }))
  return Object.freeze({
    ...(temperature === undefined ? {} : { temperature }), ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }), retained: Object.freeze(retained),
  })
}

function validateCompositionReferences(state: ProductState, binding: SessionComposition): void {
  if (!state.presets.some(item => item.id === binding.presetId)) throw new Error(`unknown preset ${JSON.stringify(binding.presetId)}`)
  if (!state.systems.some(item => item.id === binding.systemId)) throw new Error(`unknown system ${JSON.stringify(binding.systemId)}`)
  for (const id of binding.characterIds) if (!state.characters.some(item => item.id === id)) throw new Error(`unknown character ${JSON.stringify(id)}`)
  if (binding.personaId !== '' && !state.personas.some(item => item.id === binding.personaId)) throw new Error(`unknown persona ${JSON.stringify(binding.personaId)}`)
  if (binding.worldId !== '' && !state.worlds.some(item => item.id === binding.worldId)) throw new Error(`unknown world ${JSON.stringify(binding.worldId)}`)
}

function optionalSource(value: unknown): { readonly source?: ImportSource } {
  if (value === undefined) return {}
  const item = record(value, 'import source')
  return { source: Object.freeze({
    format: text(item.format, 'source format', 240), sourceId: text(item.sourceId, 'sourceId', 1024),
    warnings: Object.freeze(stringList(item.warnings, 'source warnings', 256, 2_000)),
    ...(item.document === undefined ? {} : { document: jsonObject(item.document, 'source document') }),
  }) }
}

function optionalAdaptation(value: unknown): { readonly adaptation?: PresetAdaptation } {
  if (value === undefined) return {}
  const item = record(value, 'preset adaptation')
  return { adaptation: Object.freeze({
    sourcePresetId: normalizedId(item.sourcePresetId, 'adaptation sourcePresetId'),
    convertedAt: integer(item.convertedAt, 'adaptation convertedAt', 0, Number.MAX_SAFE_INTEGER),
    removedInjectionMetadata: integer(item.removedInjectionMetadata, 'removedInjectionMetadata', 0, PRODUCT_PROMPT_DEFINITION_LIMIT),
    inertExtensionWarnings: integer(item.inertExtensionWarnings, 'inertExtensionWarnings', 0, 256),
    notes: Object.freeze(stringList(item.notes, 'adaptation notes', 32, 2_000)),
  }) }
}

function optionalAvatar(value: unknown): { readonly avatar?: CharacterAvatar } {
  if (value === undefined) return {}
  const item = record(value, 'character avatar')
  if (item.mediaType !== 'image/png') throw new Error('character avatar mediaType must be image/png')
  return { avatar: Object.freeze({
    id: normalizedId(item.id, 'avatar id'),
    mediaType: 'image/png',
    byteLength: integer(item.byteLength, 'avatar byteLength', 1, 32 * 1024 * 1024),
    width: integer(item.width, 'avatar width', 1, 32_768),
    height: integer(item.height, 'avatar height', 1, 32_768),
  }) }
}

function importedOrAll<T extends { readonly source?: ImportSource }>(items: readonly T[]): readonly T[] {
  const imported = items.filter(item => item.source !== undefined)
  return imported.length > 0 ? imported : items
}

function newest<T extends { readonly updatedAt: number }>(items: readonly T[]): T | undefined {
  return items.reduce<T | undefined>((selected, item) => selected === undefined || item.updatedAt >= selected.updatedAt ? item : selected, undefined)
}

function mergeById<T extends { readonly id: string }>(current: readonly T[], added: readonly T[]): readonly T[] {
  const replacements = new Map(added.map(item => [item.id, item]))
  const existing = new Set(current.map(item => item.id))
  return Object.freeze([...current.map(item => replacements.get(item.id) ?? item), ...added.filter(item => !existing.has(item.id))])
}

function validateUnique(items: readonly { readonly id: string }[], label: string): void {
  const ids = new Set<string>()
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`duplicate ${label} id ${JSON.stringify(item.id)}`)
    ids.add(item.id)
  }
}

function requireRevision(state: ProductState, baseRevision: number): void {
  if (baseRevision !== state.revision) throw new Error(`state revision conflict: expected ${String(baseRevision)}, current ${String(state.revision)}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new Error(`${label} must be a non-empty string of at most ${String(max)} characters`)
  return value.trim()
}

function optionalText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be at most ${String(max)} characters`)
  return value.trim()
}

function stringList(value: unknown, label: string, maxItems: number, maxItemLength: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must contain at most ${String(maxItems)} strings`)
  return value.map((item, index) => optionalText(item, `${label}[${index}]`, maxItemLength)).filter(item => item !== '')
}

function normalizedId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`${label} must match ${String(ID_PATTERN)}`)
  return value
}

function promptId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 240) throw new Error(`${label} must be a non-empty string of at most 240 characters`)
  return value.trim()
}

function optionalId(value: unknown, label: string): string { return value === undefined || value === null || value === '' ? '' : normalizedId(value, label) }

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`${label} must be an integer between ${String(minimum)} and ${String(maximum)}`)
  return value as number
}

function optionalNumber(value: unknown, label: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} must be between ${String(minimum)} and ${String(maximum)}`)
  return value
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

function timestamp(value: unknown): number { return integer(value ?? 0, 'updatedAt', 0, Number.MAX_SAFE_INTEGER) }
function accent(value: unknown, fallback: string): string { return typeof value === 'string' && ACCENT_PATTERN.test(value) ? value.toLowerCase() : fallback }

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function promptRole(value: unknown, label: string): PromptRole {
  if (value === 'system' || value === 'user' || value === 'assistant') return value
  throw new Error(`${label} must be system, user, or assistant`)
}

function presetMode(value: unknown, source: unknown): PresetMode {
  if (value === 'sillytavern' || value === 'harness') return value
  if (value !== undefined) throw new Error('preset mode must be sillytavern or harness')
  if (source !== undefined) {
    const format = record(source, 'preset source').format
    if (typeof format === 'string' && format.startsWith('sillytavern-')) return 'sillytavern'
  }
  return 'harness'
}

function productSessionMode(value: unknown): ProductSessionMode {
  if (value === undefined || value === 'tavern') return 'tavern'
  if (value === 'agent') return value
  throw new Error('session mode must be tavern or agent')
}

function jsonObject(value: unknown, label: string): JsonObject {
  const normalized = jsonValue(value, label, 0)
  if (typeof normalized !== 'object' || normalized === null || Array.isArray(normalized)) throw new Error(`${label} must be an object`)
  return normalized
}

function jsonValue(value: unknown, label: string, depth: number): JsonValue {
  if (depth > 64) throw new Error(`${label} exceeds 64 nested levels`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error(`${label} contains an invalid number`)
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${label}[${index}]`, depth + 1))
  const item = record(value, label)
  return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, jsonValue(entry, `${label}.${key}`, depth + 1)]))
}

function transcriptRole(value: unknown): TranscriptRole {
  if (value === 'user' || value === 'assistant') return value
  throw new Error('transcript role must be user or assistant')
}

function roleAccent(role: PromptRole): string { return role === 'system' ? '#8b7cf6' : role === 'assistant' ? '#f47f6b' : '#36b8d4' }
function escapeAttribute(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') }
