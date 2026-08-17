/** Versioned product data for the local-first RP workspace. */

export type ProductEntityKind = 'systems' | 'characters' | 'personas' | 'worlds'

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
  readonly openingMessage: string
  readonly accent: string
  readonly updatedAt: number
}

export interface PersonaProfile {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly traits: string
  readonly relationship: string
  readonly addressAs: string
  readonly updatedAt: number
}

export interface WorldProfile {
  readonly id: string
  readonly name: string
  readonly overview: string
  readonly rules: string
  readonly locations: string
  readonly lore: string
  readonly accent: string
  readonly updatedAt: number
}

export interface SessionComposition {
  readonly sessionId: string
  readonly systemId: string
  readonly characterIds: readonly string[]
  readonly primaryCharacterId: string
  readonly personaId: string
  readonly worldId: string
  readonly scene: string
  readonly updatedAt: number
}

export interface ProductState {
  readonly schemaVersion: 1
  readonly revision: number
  readonly systems: readonly SystemProfile[]
  readonly characters: readonly CharacterProfile[]
  readonly personas: readonly PersonaProfile[]
  readonly worlds: readonly WorldProfile[]
  readonly bindings: Readonly<Record<string, SessionComposition>>
}

export type ProductEntity = SystemProfile | CharacterProfile | PersonaProfile | WorldProfile
export type PromptLayerKind = 'system' | 'world' | 'character' | 'persona' | 'scene'

export interface PromptLayer {
  readonly kind: PromptLayerKind
  readonly title: string
  readonly subtitle: string
  readonly content: string
  readonly accent: string
  readonly empty: boolean
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/iu

/** Default content shown on first use without writing user storage. */
export function defaultProductState(): ProductState {
  return Object.freeze({
    schemaVersion: 1,
    revision: 0,
    systems: Object.freeze([Object.freeze({
      id: 'immersive-story',
      name: '沉浸叙事',
      directive: '你是角色扮演叙事引擎。始终保持角色身份与世界内部视角，不替用户决定行动，不把设定说明当作用户台词。',
      tone: '细腻、克制、重视动作和感官细节；推进情节时给用户保留明确选择空间。',
      boundaries: '系统规则高于角色欲望；角色设定只定义角色，用户人设只定义用户，世界观只定义环境事实。',
      updatedAt: 0,
    })]),
    characters: Object.freeze([Object.freeze({
      id: 'lin-yao',
      name: '林遥',
      summary: '雾港观星塔的年轻记录官，负责追踪会改变航线的夜潮。',
      personality: '冷静敏锐，面对陌生人谨慎，谈到星图时会流露真诚热情。',
      speechStyle: '句子简洁，偶尔使用航海和星象比喻；紧张时会先描述观察结果再表达感受。',
      appearance: '黑色短发，深蓝长外套，随身携带一枚黄铜星盘。',
      goals: '查清失踪灯塔守望者留下的异常星图，同时保护雾港居民。',
      openingMessage: '潮雾贴着窗沿漫进来。林遥合上星图，抬眼看向门口：“你比约定早到了七分钟。”',
      accent: '#f47f6b',
      updatedAt: 0,
    })]),
    personas: Object.freeze([Object.freeze({
      id: 'traveler',
      name: '远行者',
      description: '刚抵达雾港的外乡调查者，对当地夜潮与失踪事件知之甚少。',
      traits: '善于倾听，谨慎求证，不轻易透露自己的真实来历。',
      relationship: '与林遥初次见面，双方只有一封匿名委托信作为联系。',
      addressAs: '你',
      updatedAt: 0,
    })]),
    worlds: Object.freeze([Object.freeze({
      id: 'mist-harbor',
      name: '雾港',
      overview: '一座建在黑色礁群上的港城。夜潮会携带发光雾粒，城市依靠灯塔和观星塔共同校准航线。',
      rules: '夜潮期间罗盘失效；记录在星图上的名字会被海雾记住；灯塔熄灭后不得直视海面倒影。',
      locations: '观星塔、旧灯塔、潮痕市场、北防波堤、沉船档案馆。',
      lore: '三十年前的“大偏航”让整支舰队消失。官方档案称其遭遇风暴，民间则认为舰队进入了被抹去的第七码头。',
      accent: '#42b883',
      updatedAt: 0,
    })]),
    bindings: Object.freeze({}),
  })
}

/** Parse durable or API state into a complete immutable document. */
export function normalizeProductState(value: unknown): ProductState {
  if (value === undefined) return defaultProductState()
  const root = record(value, 'product state')
  if (root.schemaVersion !== 1) throw new Error('product state schemaVersion must be 1')
  const state: ProductState = {
    schemaVersion: 1,
    revision: integer(root.revision, 'revision', 0, Number.MAX_SAFE_INTEGER),
    systems: Object.freeze(array(root.systems, 'systems').map(normalizeSystem)),
    characters: Object.freeze(array(root.characters, 'characters').map(normalizeCharacter)),
    personas: Object.freeze(array(root.personas, 'personas').map(normalizePersona)),
    worlds: Object.freeze(array(root.worlds, 'worlds').map(normalizeWorld)),
    bindings: Object.freeze(Object.fromEntries(Object.entries(record(root.bindings, 'bindings'))
      .map(([id, binding]) => [id, normalizeComposition(binding, id)]))),
  }
  validateUnique(state.systems, 'system')
  validateUnique(state.characters, 'character')
  validateUnique(state.personas, 'persona')
  validateUnique(state.worlds, 'world')
  if (state.systems.length === 0) throw new Error('product state requires at least one system profile')
  for (const binding of Object.values(state.bindings)) validateCompositionReferences(state, binding)
  return Object.freeze(state)
}

/** Normalize one entity from an untrusted mutation request. */
export function normalizeEntity(kind: ProductEntityKind, value: unknown, now = Date.now()): ProductEntity {
  const source = record(value, kind)
  switch (kind) {
    case 'systems': return normalizeSystem({ ...source, updatedAt: now })
    case 'characters': return normalizeCharacter({ ...source, updatedAt: now })
    case 'personas': return normalizePersona({ ...source, updatedAt: now })
    case 'worlds': return normalizeWorld({ ...source, updatedAt: now })
  }
}

/** Replace or append one entity and advance the document revision. */
export function upsertEntity(
  state: ProductState,
  kind: ProductEntityKind,
  entity: ProductEntity,
  baseRevision: number,
): ProductState {
  requireRevision(state, baseRevision)
  const current = state[kind] as readonly ProductEntity[]
  const index = current.findIndex(item => item.id === entity.id)
  const next = index < 0 ? [...current, entity] : current.map((item, itemIndex) => itemIndex === index ? entity : item)
  return normalizeProductState({ ...state, revision: state.revision + 1, [kind]: next })
}

/** Remove one entity while keeping every Session binding referentially valid. */
export function removeEntity(
  state: ProductState,
  kind: ProductEntityKind,
  id: string,
  baseRevision: number,
): ProductState {
  requireRevision(state, baseRevision)
  const targetId = normalizedId(id, `${kind} id`)
  if (kind === 'systems' && state.systems.length === 1 && state.systems[0]?.id === targetId) {
    throw new Error('the last system profile cannot be removed')
  }
  const current = state[kind] as readonly ProductEntity[]
  if (!current.some(item => item.id === targetId)) throw new Error(`${kind} ${JSON.stringify(targetId)} does not exist`)
  const nextCollection = current.filter(item => item.id !== targetId)
  const fallbackSystem = kind === 'systems' ? nextCollection[0]?.id : undefined
  const bindings = Object.fromEntries(Object.entries(state.bindings).map(([sessionId, binding]) => {
    const characterIds = kind === 'characters'
      ? binding.characterIds.filter(characterId => characterId !== targetId)
      : [...binding.characterIds]
    return [sessionId, {
      ...binding,
      ...(kind === 'systems' && binding.systemId === targetId ? { systemId: fallbackSystem } : {}),
      ...(kind === 'characters' ? {
        characterIds,
        primaryCharacterId: binding.primaryCharacterId === targetId ? characterIds[0] ?? '' : binding.primaryCharacterId,
      } : {}),
      ...(kind === 'personas' && binding.personaId === targetId ? { personaId: '' } : {}),
      ...(kind === 'worlds' && binding.worldId === targetId ? { worldId: '' } : {}),
    }]
  }))
  return normalizeProductState({ ...state, revision: state.revision + 1, [kind]: nextCollection, bindings })
}

/** Bind an exact layered composition to one DSH Session. */
export function bindSession(
  state: ProductState,
  value: unknown,
  baseRevision: number,
  now = Date.now(),
): ProductState {
  requireRevision(state, baseRevision)
  const binding = normalizeComposition({ ...record(value, 'binding'), updatedAt: now })
  validateCompositionReferences(state, binding)
  return normalizeProductState({
    ...state,
    revision: state.revision + 1,
    bindings: { ...state.bindings, [binding.sessionId]: binding },
  })
}

/** Resolve the five separately labelled prompt layers for one Session. */
export function resolvePromptLayers(state: ProductState, sessionId: string): readonly PromptLayer[] {
  const binding = state.bindings[sessionId]
  if (binding === undefined) {
    return Object.freeze([
      layer('system', '系统规则', '未绑定会话', '', '#8b7cf6'),
      layer('world', '世界观', '未绑定会话', '', '#42b883'),
      layer('character', '角色阵容', '未绑定会话', '', '#f47f6b'),
      layer('persona', '用户人设', '未绑定会话', '', '#36b8d4'),
      layer('scene', '当前场景', '未绑定会话', '', '#e7a84f'),
    ])
  }
  const system = state.systems.find(item => item.id === binding?.systemId) ?? state.systems[0]
  const world = state.worlds.find(item => item.id === binding?.worldId)
  const persona = state.personas.find(item => item.id === binding?.personaId)
  const characters = (binding?.characterIds ?? [])
    .map(id => state.characters.find(item => item.id === id))
    .filter((item): item is CharacterProfile => item !== undefined)
  const primary = characters.find(item => item.id === binding?.primaryCharacterId) ?? characters[0]
  const supporting = characters.filter(item => item.id !== primary?.id)
  const characterContent = primary === undefined ? '' : [
    `当前主要角色：${primary.name}`,
    `角色摘要：${primary.summary}`,
    `性格：${primary.personality}`,
    `说话方式：${primary.speechStyle}`,
    `外观：${primary.appearance}`,
    `目标：${primary.goals}`,
    ...(supporting.length === 0 ? [] : [
      '',
      '配角阵容：',
      ...supporting.map(item => `- ${item.name}：${item.summary}；性格：${item.personality}；说话方式：${item.speechStyle}`),
    ]),
    '',
    '角色设定描述的是你要扮演的人物，不得用它覆盖用户人设或世界事实。',
  ].join('\n')
  return Object.freeze([
    layer('system', '系统规则', system?.name ?? '未设置', system === undefined ? '' : [
      system.directive,
      `叙事语调：${system.tone}`,
      `边界：${system.boundaries}`,
    ].join('\n'), '#8b7cf6'),
    layer('world', '世界观', world?.name ?? '未设置', world === undefined ? '' : [
      `世界概览：${world.overview}`,
      `世界规则：${world.rules}`,
      `重要地点：${world.locations}`,
      `背景知识：${world.lore}`,
      '世界观只定义环境、历史与客观规则，不自动决定任何角色的意志。',
    ].join('\n'), world?.accent ?? '#42b883'),
    layer('character', '角色阵容', primary?.name ?? '未设置', characterContent, primary?.accent ?? '#f47f6b'),
    layer('persona', '用户人设', persona?.name ?? '未设置', persona === undefined ? '' : [
      `用户身份：${persona.description}`,
      `用户特征：${persona.traits}`,
      `关系背景：${persona.relationship}`,
      `称呼用户：${persona.addressAs}`,
      '用户人设描述的是对话中的用户，不是你要扮演的角色。不得替用户决定言语、动作或内心。',
    ].join('\n'), '#36b8d4'),
    layer('scene', '当前场景', binding?.scene === '' || binding === undefined ? '未设置' : '会话场景', binding?.scene ?? '', '#e7a84f'),
  ])
}

/** Render prompt layers with explicit tags that preserve their semantic distinction. */
export function renderPromptLayer(layer: PromptLayer): string {
  if (layer.empty) return ''
  return `<rp-${layer.kind} label="${escapeAttribute(layer.title)}">\n${layer.content}\n</rp-${layer.kind}>`
}

function normalizeSystem(value: unknown): SystemProfile {
  const item = record(value, 'system profile')
  return Object.freeze({
    id: normalizedId(item.id, 'system id'), name: text(item.name, 'system name', 120),
    directive: text(item.directive, 'system directive', 16_000), tone: optionalText(item.tone, 'system tone', 4_000),
    boundaries: optionalText(item.boundaries, 'system boundaries', 8_000), updatedAt: timestamp(item.updatedAt),
  })
}

function normalizeCharacter(value: unknown): CharacterProfile {
  const item = record(value, 'character profile')
  return Object.freeze({
    id: normalizedId(item.id, 'character id'), name: text(item.name, 'character name', 120),
    summary: text(item.summary, 'character summary', 8_000), personality: optionalText(item.personality, 'character personality', 8_000),
    speechStyle: optionalText(item.speechStyle, 'character speech style', 4_000), appearance: optionalText(item.appearance, 'character appearance', 4_000),
    goals: optionalText(item.goals, 'character goals', 4_000), openingMessage: optionalText(item.openingMessage, 'opening message', 8_000),
    accent: accent(item.accent, '#f47f6b'), updatedAt: timestamp(item.updatedAt),
  })
}

function normalizePersona(value: unknown): PersonaProfile {
  const item = record(value, 'persona profile')
  return Object.freeze({
    id: normalizedId(item.id, 'persona id'), name: text(item.name, 'persona name', 120),
    description: text(item.description, 'persona description', 8_000), traits: optionalText(item.traits, 'persona traits', 4_000),
    relationship: optionalText(item.relationship, 'persona relationship', 4_000), addressAs: optionalText(item.addressAs, 'persona address', 120),
    updatedAt: timestamp(item.updatedAt),
  })
}

function normalizeWorld(value: unknown): WorldProfile {
  const item = record(value, 'world profile')
  return Object.freeze({
    id: normalizedId(item.id, 'world id'), name: text(item.name, 'world name', 120),
    overview: text(item.overview, 'world overview', 12_000), rules: optionalText(item.rules, 'world rules', 12_000),
    locations: optionalText(item.locations, 'world locations', 12_000), lore: optionalText(item.lore, 'world lore', 32_000),
    accent: accent(item.accent, '#42b883'), updatedAt: timestamp(item.updatedAt),
  })
}

function normalizeComposition(value: unknown, fallbackSessionId?: string): SessionComposition {
  const item = record(value, 'session composition')
  const sessionId = text(item.sessionId ?? fallbackSessionId, 'session id', 512)
  const characterIds = array(item.characterIds, 'characterIds').map((id, index) => normalizedId(id, `characterIds[${index}]`))
  const uniqueCharacters = [...new Set(characterIds)]
  const primaryCharacterId = optionalId(item.primaryCharacterId, 'primaryCharacterId') || uniqueCharacters[0] || ''
  if (primaryCharacterId !== '' && !uniqueCharacters.includes(primaryCharacterId)) {
    throw new Error('primaryCharacterId must appear in characterIds')
  }
  return Object.freeze({
    sessionId,
    systemId: normalizedId(item.systemId, 'systemId'),
    characterIds: Object.freeze(uniqueCharacters),
    primaryCharacterId,
    personaId: optionalId(item.personaId, 'personaId'),
    worldId: optionalId(item.worldId, 'worldId'),
    scene: optionalText(item.scene, 'scene', 12_000),
    updatedAt: timestamp(item.updatedAt),
  })
}

function validateCompositionReferences(state: ProductState, binding: SessionComposition): void {
  if (!state.systems.some(item => item.id === binding.systemId)) throw new Error(`unknown system ${JSON.stringify(binding.systemId)}`)
  for (const id of binding.characterIds) {
    if (!state.characters.some(item => item.id === id)) throw new Error(`unknown character ${JSON.stringify(id)}`)
  }
  if (binding.personaId !== '' && !state.personas.some(item => item.id === binding.personaId)) {
    throw new Error(`unknown persona ${JSON.stringify(binding.personaId)}`)
  }
  if (binding.worldId !== '' && !state.worlds.some(item => item.id === binding.worldId)) {
    throw new Error(`unknown world ${JSON.stringify(binding.worldId)}`)
  }
}

function layer(kind: PromptLayerKind, title: string, subtitle: string, content: string, accentValue: string): PromptLayer {
  return Object.freeze({ kind, title, subtitle, content, accent: accentValue, empty: content.trim() === '' })
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
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${String(max)} characters`)
  }
  return value.trim()
}

function optionalText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be at most ${String(max)} characters`)
  return value.trim()
}

function normalizedId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`${label} must match ${String(ID_PATTERN)}`)
  return value
}

function optionalId(value: unknown, label: string): string {
  return value === undefined || value === null || value === '' ? '' : normalizedId(value, label)
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer between ${String(minimum)} and ${String(maximum)}`)
  }
  return value as number
}

function timestamp(value: unknown): number {
  return integer(value ?? 0, 'updatedAt', 0, Number.MAX_SAFE_INTEGER)
}

function accent(value: unknown, fallback: string): string {
  return typeof value === 'string' && ACCENT_PATTERN.test(value) ? value.toLowerCase() : fallback
}

function escapeAttribute(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;')
}
