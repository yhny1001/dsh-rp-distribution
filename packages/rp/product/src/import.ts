/** Product-facing batch import over the inert SillyTavern compatibility adapters. */

import { createHash } from 'node:crypto'
import {
  importCharacterCard,
  importCharacterCardCharx,
  importCharacterCardPng,
  importPersona,
  importPreset,
  importWorldInfo,
} from '@dsh-rp/compat-sillytavern'
import { normalizeEntity } from './model.ts'
import type {
  CharacterAvatar,
  CharacterProfile,
  ImportedProductEntities,
  ImportSource,
  JsonObject,
  PersonaProfile,
  PromptPreset,
  WorldProfile,
} from './model.ts'

export interface ProductImportFile {
  readonly name: string
  readonly bytes: Uint8Array
}

export interface ProductImportReport {
  readonly fileName: string
  readonly kind: 'character' | 'persona' | 'world' | 'preset' | 'error'
  readonly ids: readonly string[]
  readonly names: readonly string[]
  readonly warnings: readonly string[]
  readonly error?: string
}

export interface ProductImportBatch {
  readonly entities: ImportedProductEntities
  readonly assets: readonly ProductImportAsset[]
  readonly reports: readonly ProductImportReport[]
}

export interface ProductImportAsset {
  readonly id: string
  readonly mediaType: 'image/png'
  readonly bytes: Uint8Array
}

/** Parse independent import files, retaining successful files when a sibling is invalid. */
export function importProductFiles(files: readonly ProductImportFile[], now = Date.now()): ProductImportBatch {
  const characters: CharacterProfile[] = []
  const personas: PersonaProfile[] = []
  const worlds: WorldProfile[] = []
  const presets: PromptPreset[] = []
  const assets: ProductImportAsset[] = []
  const reports: ProductImportReport[] = []
  for (const file of files) {
    try {
      const imported = normalizeImport(importFile(file, now), now)
      characters.push(...imported.characters)
      personas.push(...imported.personas)
      worlds.push(...imported.worlds)
      presets.push(...imported.presets)
      assets.push(...imported.assets)
      reports.push(imported.report)
    } catch (error: unknown) {
      reports.push(Object.freeze({
        fileName: file.name,
        kind: 'error',
        ids: Object.freeze([]),
        names: Object.freeze([]),
        warnings: Object.freeze([]),
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }
  return Object.freeze({
    entities: Object.freeze({
      characters: Object.freeze(dedupeById(characters)), personas: Object.freeze(dedupeById(personas)),
      worlds: Object.freeze(dedupeById(worlds)), presets: Object.freeze(dedupeById(presets)),
    }),
    assets: Object.freeze(dedupeById(assets)),
    reports: Object.freeze(reports),
  })
}

interface OneImport extends ImportedProductEntities {
  readonly assets: readonly ProductImportAsset[]
  readonly report: ProductImportReport
}

function normalizeImport(imported: OneImport, now: number): OneImport {
  return Object.freeze({
    characters: Object.freeze(imported.characters.map(character => normalizeEntity('characters', character, now) as CharacterProfile)),
    personas: Object.freeze(imported.personas.map(persona => normalizeEntity('personas', persona, now) as PersonaProfile)),
    worlds: Object.freeze(imported.worlds.map(world => normalizeEntity('worlds', world, now) as WorldProfile)),
    presets: Object.freeze(imported.presets.map(preset => normalizeEntity('presets', preset, now) as PromptPreset)),
    assets: imported.assets,
    report: imported.report,
  })
}

function importFile(file: ProductImportFile, now: number): OneImport {
  const extension = file.name.toLocaleLowerCase().split('.').pop() ?? ''
  const options = { sourceId: file.name, importedAt: now }
  if (extension === 'png') {
    const avatar = pngAvatar(file.bytes)
    return characterImport(importCharacterCardPng(file.bytes, options), file.name, now, avatar)
  }
  if (extension === 'charx') return characterImport(importCharacterCardCharx(file.bytes, options), file.name, now)
  if (extension !== 'json') throw new Error('仅支持 Character Card JSON、PNG、CHARX、World Info、Persona 与 Chat Completion Preset JSON')
  const source = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)
  const root = parseObject(source)
  if (Array.isArray(root.prompts) && Array.isArray(root.prompt_order)) {
    const preset = presetProfile(importPreset(source, options), file.name, now)
    return one('preset', file.name, [], [], [], [preset], [preset.name], preset.source?.warnings ?? [])
  }
  if (typeof root.spec === 'string' || typeof root.first_mes === 'string' || isRecord(root.data) && typeof root.data.first_mes === 'string') {
    return characterImport(importCharacterCard(source, options), file.name, now)
  }
  if (root.entries !== undefined) {
    const world = worldProfile(importWorldInfo(source, options), file.name, now)
    return one('world', file.name, [], [], [world], [], [world.name], world.source?.warnings ?? [])
  }
  if (typeof root.name === 'string' && (typeof root.description === 'string' || typeof root.prompt === 'string' || isRecord(root.data))) {
    const persona = personaProfile(importPersona(source, options), file.name, now)
    return one('persona', file.name, [], [persona], [], [], [persona.name], persona.source?.warnings ?? [])
  }
  throw new Error('无法识别此 JSON；缺少角色卡、世界书、Persona 或预设标记')
}

function characterImport(
  imported: ReturnType<typeof importCharacterCard> | ReturnType<typeof importCharacterCardPng> | ReturnType<typeof importCharacterCardCharx>,
  fileName: string,
  now: number,
  avatar?: { readonly ref: CharacterAvatar; readonly asset: ProductImportAsset },
): OneImport {
  const character = characterProfile(imported.character, fileName, now, avatar?.ref)
  const worlds = imported.lore === undefined ? [] : [worldProfile(imported.lore, fileName, now)]
  const names = [character.name, ...worlds.map(world => world.name)]
  const warnings = [...character.source?.warnings ?? [], ...worlds.flatMap(world => world.source?.warnings ?? [])]
  return one('character', fileName, [character], [], worlds, [], names, warnings, avatar === undefined ? [] : [avatar.asset])
}

function characterProfile(
  character: ReturnType<typeof importCharacterCard>['character'],
  fileName: string,
  now: number,
  avatar?: CharacterAvatar,
): CharacterProfile {
  const first = character.firstMessages[0] ?? ''
  return Object.freeze({
    id: safeId(character.id, 'character', character.name, fileName),
    name: character.name,
    summary: character.description?.trim() || `从 ${fileName} 导入的角色卡`,
    personality: character.personality ?? '',
    speechStyle: '',
    appearance: '',
    goals: '',
    scenario: character.scenario ?? '',
    openingMessage: first,
    alternateGreetings: Object.freeze(character.firstMessages.slice(1)),
    examples: Object.freeze(character.examples ?? []),
    tags: Object.freeze(character.tags ?? []),
    accent: colorFor(character.name),
    ...(avatar === undefined ? {} : { avatar }),
    source: importSource(character.compatibility, fileName),
    updatedAt: now,
  })
}

function personaProfile(persona: ReturnType<typeof importPersona>, fileName: string, now: number): PersonaProfile {
  return Object.freeze({
    id: safeId(persona.id, 'persona', persona.name, fileName),
    name: persona.name,
    description: persona.description,
    traits: '',
    relationship: '',
    addressAs: '',
    source: importSource(persona.compatibility, fileName),
    updatedAt: now,
  })
}

function worldProfile(world: ReturnType<typeof importWorldInfo>, fileName: string, now: number): WorldProfile {
  const active = world.entries.filter(entry => entry.enabled)
  const lore = active.map(entry => {
    const keys = entry.keys.length === 0 ? '' : ` [关键词：${entry.keys.join('、')}]`
    return `- ${entry.id}${keys}\n${entry.content}`
  }).join('\n\n')
  return Object.freeze({
    id: safeId(world.id, 'world', world.name, fileName),
    name: world.name,
    overview: `从 ${fileName} 导入的世界书，共 ${String(world.entries.length)} 条，启用 ${String(active.length)} 条。`,
    rules: '',
    locations: '',
    lore,
    entries: Object.freeze(world.entries.map(entry => Object.freeze({
      id: entry.id,
      name: entry.id,
      content: entry.content,
      keys: Object.freeze(entry.keys),
      secondaryKeys: Object.freeze(entry.secondaryKeys ?? []),
      enabled: entry.enabled,
      constant: entry.constant === true,
      priority: entry.priority,
    }))),
    accent: colorFor(world.name),
    source: importSource(world.compatibility, fileName),
    updatedAt: now,
  })
}

function presetProfile(preset: ReturnType<typeof importPreset>, fileName: string, now: number): PromptPreset {
  const generation = preset.generation
  const temperature = numberValue(generation.temperature)
  const maxTokens = integerValue(generation.openai_max_tokens)
  const sourceReasoningEffort = typeof generation.reasoning_effort === 'string' ? generation.reasoning_effort : undefined
  const reasoningEffort = dshReasoningEffort(sourceReasoningEffort)
  const retained = Object.fromEntries(Object.entries(generation).flatMap(([key, value]) => {
    if (key === 'temperature' || key === 'openai_max_tokens' || key === 'reasoning_effort') return []
    return value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' ? [[key, value]] : []
  }))
  if (sourceReasoningEffort !== undefined && sourceReasoningEffort !== reasoningEffort) retained.source_reasoning_effort = sourceReasoningEffort
  return Object.freeze({
    id: safeId(preset.id, 'preset', preset.name, fileName),
    name: preset.name,
    mode: 'sillytavern',
    promptDefinitions: Object.freeze(preset.promptDefinitions.map(definition => Object.freeze({
      id: definition.id,
      name: definition.name,
      role: definition.role,
      content: definition.content,
      marker: definition.marker,
      systemPrompt: definition.systemPrompt,
      forbidOverrides: definition.forbidOverrides,
      ...(definition.injectionPosition === undefined ? {} : { injectionPosition: definition.injectionPosition }),
      ...(definition.injectionDepth === undefined ? {} : { injectionDepth: definition.injectionDepth }),
      ...(definition.injectionOrder === undefined ? {} : { injectionOrder: definition.injectionOrder }),
      ...(definition.injectionTrigger === undefined ? {} : { injectionTrigger: definition.injectionTrigger }),
    }))),
    promptOrders: Object.freeze(preset.promptOrders.map(order => Object.freeze({
      id: order.id,
      entries: Object.freeze(order.entries.map(entry => Object.freeze({ identifier: entry.identifier, enabled: entry.enabled }))),
    }))),
    selectedPromptOrderId: preset.selectedPromptOrderId,
    generation: Object.freeze({
      ...(temperature === undefined ? {} : { temperature }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      retained: Object.freeze(retained),
    }),
    source: importSource(preset.compatibility, fileName),
    updatedAt: now,
  })
}

function one(
  kind: Exclude<ProductImportReport['kind'], 'error'>,
  fileName: string,
  characters: readonly CharacterProfile[],
  personas: readonly PersonaProfile[],
  worlds: readonly WorldProfile[],
  presets: readonly PromptPreset[],
  names: readonly string[],
  warnings: readonly string[],
  assets: readonly ProductImportAsset[] = [],
): OneImport {
  return Object.freeze({
    characters: Object.freeze(characters), personas: Object.freeze(personas), worlds: Object.freeze(worlds), presets: Object.freeze(presets),
    assets: Object.freeze(assets),
    report: Object.freeze({
      fileName,
      kind,
      ids: Object.freeze([...characters, ...personas, ...worlds, ...presets].map(entity => entity.id)),
      names: Object.freeze(names),
      warnings: Object.freeze([...new Set(warnings)]),
    }),
  })
}

interface CompatibilityLike {
  readonly source: { readonly format: string }
  readonly unknownFields: JsonObject
  readonly warnings?: readonly string[]
  readonly lossReport?: { readonly items: readonly { readonly disposition: string; readonly reason: string }[] }
}

function importSource(compatibility: CompatibilityLike | undefined, fileName: string): ImportSource {
  const loss = compatibility?.lossReport?.items
    .filter(item => item.disposition === 'disabled' || item.disposition === 'omitted')
    .map(item => item.reason) ?? []
  return Object.freeze({
    format: compatibility?.source.format ?? 'sillytavern',
    sourceId: fileName,
    warnings: Object.freeze([...new Set([...(compatibility?.warnings ?? []), ...loss])]),
    ...(compatibility === undefined ? {} : { document: compatibility.unknownFields }),
  })
}

function parseObject(source: string): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(source) as unknown } catch { throw new Error('JSON 不是有效的 UTF-8 JSON 文档') }
  if (!isRecord(value)) throw new Error('JSON 顶层必须是对象')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeId(input: string, kind: string, name: string, fileName: string): string {
  const normalized = input.normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^[^a-z0-9]+|[-.]+$/gu, '')
  if (/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(normalized)) return normalized
  return `${kind}-${createHash('sha256').update(`${name}\0${fileName}`).digest('hex').slice(0, 20)}`
}

function colorFor(value: string): string {
  const digest = createHash('sha256').update(value).digest()
  const channels = [96 + digest[0]! % 128, 96 + digest[1]! % 128, 96 + digest[2]! % 128]
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function integerValue(value: unknown): number | undefined { return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined }

function dshReasoningEffort(value: string | undefined): string | undefined {
  if (value === undefined || value === 'auto') return undefined
  if (value === 'min') return 'minimal'
  if (value === 'none' || value === 'disabled') return 'off'
  return value
}

function pngAvatar(bytes: Uint8Array): { readonly ref: CharacterAvatar; readonly asset: ProductImportAsset } {
  if (bytes.byteLength < 24) throw new Error('PNG avatar is truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const id = `avatar-${createHash('sha256').update(bytes).digest('hex')}`
  return Object.freeze({
    ref: Object.freeze({ id, mediaType: 'image/png', byteLength: bytes.byteLength, width, height }),
    asset: Object.freeze({ id, mediaType: 'image/png', bytes }),
  })
}

function dedupeById<T extends { readonly id: string }>(items: readonly T[]): T[] {
  const byId = new Map<string, T>()
  for (const item of items) byId.set(item.id, item)
  return [...byId.values()]
}
