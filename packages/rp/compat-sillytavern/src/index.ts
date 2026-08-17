/** Inert-by-default SillyTavern adapters producing versioned RP IR. @module @dsh-rp/compat-sillytavern */

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { unzipSync, type UnzipFileInfo } from 'fflate'
import extractPngChunks from 'png-chunks-extract'
import { decode as decodePngText } from 'png-chunk-text'
import type { Context } from '@deepseek-ai/cordis'
import {
  RpCapabilityId, RpComponentId, RpPackageId,
} from '@dsh-rp/contracts'
import type {
  CharacterIR, CompatibilityEnvelope, CompatibilityLossItem, JsonObject, JsonValue, LoreEntryIR, LoreIR, PersonaIR,
  PromptSectionIR, SourceProvenance,
} from '@dsh-rp/contracts'
import type { RpCapabilityContribution } from '@dsh-rp/capability-catalog'
import type { RpComponentDefinition } from '@dsh-rp/component-runtime'

export const name = 'rp-compat-sillytavern'
export const inject = ['rpComponents', 'rpCapabilities']

const PACKAGE = RpPackageId('dsh-rp.compat-sillytavern')
const MAX_JSON_BYTES = 32 * 1024 * 1024
const MAX_CARD_JSON_BYTES = 2 * 1024 * 1024
const MAX_CHARX_BYTES = 64 * 1024 * 1024
const MAX_CHARX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
const MAX_CHARX_ENTRIES = 512
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Explicit provenance supplied by an importer boundary. */
export interface SillyTavernImportOptions {
  readonly sourceId?: string
  readonly importedAt?: number
}

/** Character card conversion plus embedded lore. */
export interface CharacterCardImport {
  readonly character: CharacterIR
  readonly lore?: LoreIR
}

/** Inert embedded media metadata retained from a CHARX archive. */
export interface CharacterArchiveAsset {
  readonly path: string
  readonly type: string
  readonly name: string
  readonly mediaType: string
  readonly byteLength: number
  readonly contentHash: string
}

/** Character import plus validated binary transport metadata. */
export interface BinaryCharacterCardImport extends CharacterCardImport {
  readonly transport: 'png-chara' | 'png-ccv3' | 'charx'
  readonly assets: readonly CharacterArchiveAsset[]
  readonly compatibility: CompatibilityEnvelope
}

/** One losslessly retained SillyTavern chat row. */
export interface SillyTavernChatMessageIR {
  readonly line: number
  readonly role: 'user' | 'assistant' | 'system' | 'narrator'
  readonly name?: string
  readonly content: string
  readonly swipes: readonly string[]
  readonly activeSwipe?: number
  readonly raw: JsonObject
}

/** Imported chat with inert header metadata and source rows. */
export interface SillyTavernChatIR {
  readonly schemaVersion: 1
  readonly userName?: string
  readonly characterName?: string
  readonly messages: readonly SillyTavernChatMessageIR[]
  readonly compatibility: CompatibilityEnvelope
}

/** Prompt-manager preset projected to ordered prompt sections. */
export interface SillyTavernPresetIR {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  /** Every source prompt definition, including disabled and marker entries. */
  readonly promptDefinitions: readonly SillyTavernPresetPromptDefinition[]
  /** Every source ordering profile in source order. */
  readonly promptOrders: readonly SillyTavernPresetPromptOrder[]
  /** Ordering profile used to derive `prompts`. */
  readonly selectedPromptOrderId: string
  /** Enabled prompts from the selected ordering profile. */
  readonly prompts: readonly PromptSectionIR[]
  readonly generation: JsonObject
  readonly compatibility: CompatibilityEnvelope
}

/** One normalized SillyTavern Prompt Manager definition. */
export interface SillyTavernPresetPromptDefinition {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
  readonly marker: boolean
}

/** One enabled/disabled reference inside a Prompt Manager ordering profile. */
export interface SillyTavernPresetPromptOrderEntry {
  readonly identifier: string
  readonly enabled: boolean
}

/** One complete Prompt Manager ordering profile. */
export interface SillyTavernPresetPromptOrder {
  readonly id: string
  readonly entries: readonly SillyTavernPresetPromptOrderEntry[]
}

/** Register four import capabilities and their independently selectable components. */
export function apply(ctx: Context): void {
  ctx.effect(function* () {
    for (const component of components()) yield ctx.rpComponents.register(component)
    for (const contribution of capabilities()) yield ctx.rpCapabilities.register(contribution)
  }, 'rp-compat-sillytavern registrations')
}

/**
 * Parse Character Card V1/V2/V3 JSON without executing extensions.
 * @param source - UTF-8 JSON text.
 * @param options - Explicit source provenance.
 * @returns Character IR and optional embedded lore.
 */
export function importCharacterCard(source: string, options: SillyTavernImportOptions = {}): CharacterCardImport {
  const root = parseJsonObject(source, 'Character Card')
  const version = root.spec === undefined ? 1 : root.spec === 'chara_card_v2' ? 2 : root.spec === 'chara_card_v3' ? 3 : 0
  if (version === 0) throw new Error(`Unsupported Character Card spec ${JSON.stringify(root.spec)}`)
  const data = version === 1 ? root : object(root.data, 'Character Card data')
  const name = requiredString(data.name, 'Character Card name')
  const warnings = extensionWarnings(data)
  const envelope = compatibility(`sillytavern-character-card-v${version}`, root, source, options, warnings)
  const first = requiredString(data.first_mes, 'Character Card first_mes')
  const alternates = stringArray(data.alternate_greetings, 'Character Card alternate_greetings')
  const character: CharacterIR = {
    schemaVersion: 1,
    id: stableId('character', name, source),
    name,
    ...optionalText(data.description, 'description'),
    ...optionalText(data.personality, 'personality'),
    ...optionalText(data.scenario, 'scenario'),
    firstMessages: [first, ...alternates],
    ...(typeof data.mes_example === 'string' && data.mes_example !== '' ? { examples: [data.mes_example] } : {}),
    ...(data.tags === undefined ? {} : { tags: stringArray(data.tags, 'Character Card tags') }),
    ...(isObject(data.extensions) ? { extensions: data.extensions } : {}),
    compatibility: envelope,
  }
  const lore = data.character_book === undefined
    ? undefined
    : loreFromBook(object(data.character_book, 'Character Card character_book'), `${name} lore`, source, options)
  return { character, ...(lore === undefined ? {} : { lore }) }
}

/**
 * Parse a SillyTavern Persona JSON document without executing extensions.
 * The adapter accepts a direct object or a `{ data }` export wrapper.
 * @param source - UTF-8 JSON text.
 * @param options - Explicit source provenance.
 * @returns Normalized Persona IR with inert unknown fields retained.
 */
export function importPersona(source: string, options: SillyTavernImportOptions = {}): PersonaIR {
  const root = parseJsonObject(source, 'Persona')
  const data = isObject(root.data) ? root.data : root
  const name = requiredString(data.name, 'Persona name')
  const description = typeof data.description === 'string'
    ? data.description
    : requiredString(data.prompt, 'Persona description')
  return {
    schemaVersion: 1,
    id: stableId('persona', name, source),
    name,
    description,
    ...(isObject(data.extensions) ? { extensions: data.extensions } : {}),
    compatibility: compatibility('sillytavern-persona', root, source, options, extensionWarnings(data)),
  }
}

/**
 * Decode a Character Card PNG tEXt payload, preferring CCv3 metadata.
 * @param data - Complete PNG byte stream.
 * @param options - Import provenance controls.
 * @returns Inert normalized character data and transport metadata.
 */
export function importCharacterCardPng(data: Uint8Array, options: SillyTavernImportOptions = {}): BinaryCharacterCardImport {
  const bytes = Buffer.from(data)
  if (bytes.byteLength < PNG_SIGNATURE.byteLength || !bytes.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
    throw new Error('Character Card attachment is not a PNG')
  }
  preflightPng(bytes)
  let chunks: ReturnType<typeof extractPngChunks>
  try { chunks = extractPngChunks(bytes) } catch (error: unknown) { throw new Error('Character Card PNG is malformed', { cause: error }) }
  const payloads = new Map<string, string>()
  for (const chunk of chunks) {
    if (chunk.name !== 'tEXt') continue
    let decoded: ReturnType<typeof decodePngText>
    try { decoded = decodePngText(chunk.data) } catch (error: unknown) { throw new Error('Character Card PNG contains malformed text metadata', { cause: error }) }
    const keyword = decoded.keyword.toLocaleLowerCase()
    if ((keyword === 'ccv3' || keyword === 'chara') && !payloads.has(keyword)) payloads.set(keyword, decoded.text)
  }
  for (const keyword of ['ccv3', 'chara'] as const) {
    const encoded = payloads.get(keyword)
    if (encoded === undefined) continue
    const source = decodeCanonicalBase64(encoded, `PNG ${keyword}`)
    return {
      ...importCharacterCard(source, options),
      transport: keyword === 'ccv3' ? 'png-ccv3' : 'png-chara',
      assets: [],
      compatibility: binaryCompatibility('sillytavern-character-card-png', bytes, options, [{
        path: '$', feature: 'png-container', disposition: 'omitted',
        reason: 'PNG container and image bytes are not retained in normalized IR.',
      }]),
    }
  }
  throw new Error('PNG does not contain ccv3 or chara Character Card metadata')
}

/**
 * Decode a bounded Character Card V3 CHARX archive without executing assets.
 * @param data - Complete CHARX ZIP byte stream.
 * @param options - Import provenance controls.
 * @returns Inert normalized character data and embedded asset metadata.
 */
export function importCharacterCardCharx(data: Uint8Array, options: SillyTavernImportOptions = {}): BinaryCharacterCardImport {
  if (data.byteLength > MAX_CHARX_BYTES) throw new Error(`CHARX exceeds ${MAX_CHARX_BYTES} bytes`)
  const seen = new Set<string>()
  const totals = { entries: 0, bytes: 0 }
  let extracted: Record<string, Uint8Array>
  try {
    extracted = unzipSync(data, { filter: charxFilter(seen, totals) })
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('CHARX ')) throw error
    throw new Error('CHARX is not a supported ZIP archive', { cause: error })
  }
  const entries = new Map<string, Uint8Array>()
  for (const [path, bytes] of Object.entries(extracted)) entries.set(normalizeCharxPath(path), bytes)
  const cardBytes = entries.get('card.json')
  if (cardBytes === undefined) throw new Error('CHARX must contain card.json at the archive root')
  const source = decodeUtf8(cardBytes, 'CHARX card.json')
  const imported = importCharacterCard(source, options)
  if (imported.character.compatibility?.source.format !== 'sillytavern-character-card-v3') {
    throw new Error('CHARX card.json must contain Character Card V3')
  }
  const assets = Object.freeze(charxAssets(imported, entries))
  return {
    ...imported, transport: 'charx', assets,
    compatibility: binaryCompatibility('sillytavern-character-card-charx', data, options, [
      {
        path: '$', feature: 'charx-container', disposition: 'omitted',
        reason: 'CHARX ZIP container bytes are not retained in normalized IR.',
      },
      ...[...entries.keys()].filter(path => path !== 'card.json').map((path): CompatibilityLossItem => ({
        path, feature: 'charx-entry-bytes', disposition: 'omitted',
        reason: `CHARX entry ${JSON.stringify(path)} retains metadata and content hash when declared, but not raw bytes.`,
      })),
    ]),
  }
}

/**
 * Parse standalone SillyTavern World Info as literal-key lore.
 * @param source - UTF-8 JSON text.
 * @param options - Explicit source provenance.
 * @returns Versioned lore IR.
 */
export function importWorldInfo(source: string, options: SillyTavernImportOptions = {}): LoreIR {
  const root = parseJsonObject(source, 'World Info')
  const name = typeof root.name === 'string' && root.name.trim() !== '' ? root.name : 'World Info'
  const entries = entriesFromUnknown(root.entries, 'World Info entries')
  return {
    schemaVersion: 1,
    id: stableId('lore', name, source),
    name,
    entries: entries.map(([sourceId, value], index) => loreEntry(value, sourceId, index)),
    compatibility: compatibility('sillytavern-world-info', root, source, options, advancedLoreWarnings(entries)),
  }
}

/**
 * Parse a Chat Completion preset while keeping scripts inert.
 * @param source - UTF-8 JSON text.
 * @param options - Explicit source provenance.
 * @returns Ordered prompt and generation IR.
 */
export function importPreset(source: string, options: SillyTavernImportOptions = {}): SillyTavernPresetIR {
  const root = parseJsonObject(source, 'SillyTavern preset')
  if (!Array.isArray(root.prompts) || !Array.isArray(root.prompt_order)) {
    throw new Error('SillyTavern preset must contain prompts and prompt_order arrays')
  }
  const prompts = new Map<string, JsonObject>()
  const promptDefinitions: SillyTavernPresetPromptDefinition[] = []
  for (const [index, value] of root.prompts.entries()) {
    const prompt = object(value, `prompts[${index}]`)
    const id = requiredString(prompt.identifier, `prompts[${index}].identifier`)
    if (prompts.has(id)) throw new Error(`Preset repeats prompt identifier ${JSON.stringify(id)}`)
    prompts.set(id, prompt)
    promptDefinitions.push(Object.freeze({
      schemaVersion: 1,
      id,
      name: typeof prompt.name === 'string' ? prompt.name : id,
      role: prompt.role === 'user' || prompt.role === 'assistant' ? prompt.role : 'system',
      content: typeof prompt.content === 'string' ? prompt.content : '',
      marker: prompt.marker === true,
    }))
  }
  const promptOrders: SillyTavernPresetPromptOrder[] = []
  const orderIds = new Set<string>()
  for (const [orderIndex, orderValue] of root.prompt_order.entries()) {
    const orderRoot = object(orderValue, `prompt_order[${orderIndex}]`)
    if (!Array.isArray(orderRoot.order)) throw new Error(`prompt_order[${orderIndex}].order must be an array`)
    const id = promptOrderId(orderRoot.character_id, orderIndex)
    if (orderIds.has(id)) throw new Error(`Preset repeats prompt_order character_id ${JSON.stringify(id)}`)
    orderIds.add(id)
    const entries: SillyTavernPresetPromptOrderEntry[] = []
    const identifiers = new Set<string>()
    for (const [entryIndex, entryValue] of orderRoot.order.entries()) {
      const row = object(entryValue, `prompt_order[${orderIndex}].order[${entryIndex}]`)
      const identifier = requiredString(row.identifier, `prompt_order[${orderIndex}].order[${entryIndex}].identifier`)
      if (identifiers.has(identifier)) {
        throw new Error(`prompt_order[${orderIndex}] repeats prompt identifier ${JSON.stringify(identifier)}`)
      }
      if (!prompts.has(identifier)) throw new Error(`prompt_order references missing prompt ${JSON.stringify(identifier)}`)
      if (typeof row.enabled !== 'boolean') {
        throw new Error(`prompt_order[${orderIndex}].order[${entryIndex}].enabled must be a boolean`)
      }
      identifiers.add(identifier)
      entries.push(Object.freeze({ identifier, enabled: row.enabled }))
    }
    promptOrders.push(Object.freeze({ id, entries: Object.freeze(entries) }))
  }
  const selectedOrder = promptOrders.find(order => order.id === '100001') ?? promptOrders[0]
  if (selectedOrder === undefined) throw new Error('SillyTavern preset prompt_order must contain at least one profile')
  const sections: PromptSectionIR[] = []
  for (const [index, entry] of selectedOrder.entries.entries()) {
    if (!entry.enabled) continue
    const prompt = prompts.get(entry.identifier)
    if (prompt === undefined) {
      throw new Error(`prompt_order references missing prompt ${JSON.stringify(entry.identifier)}`)
    }
    const role = prompt.role === 'user' || prompt.role === 'assistant' ? prompt.role : 'system'
    sections.push({
      schemaVersion: 1,
      id: entry.identifier,
      role,
      content: typeof prompt.content === 'string' ? prompt.content : '',
      priority: index,
    })
  }
  const generationKeys = ['temperature', 'openai_max_tokens', 'top_p', 'top_k', 'top_a', 'min_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'reasoning_effort']
  const generation: JsonObject = {}
  for (const key of generationKeys) if (isJsonValue(root[key])) generation[key] = root[key]
  const nameValue = typeof root.name === 'string' && root.name.trim() !== '' ? root.name : options.sourceId ?? 'SillyTavern preset'
  return {
    schemaVersion: 1,
    id: stableId('preset', nameValue, source),
    name: nameValue,
    promptDefinitions: Object.freeze(promptDefinitions),
    promptOrders: Object.freeze(promptOrders),
    selectedPromptOrderId: selectedOrder.id,
    prompts: Object.freeze(sections),
    generation,
    compatibility: compatibility('sillytavern-chat-completion-preset', root, source, options, extensionWarnings(root)),
  }
}

function promptOrderId(value: JsonValue | undefined, index: number): string {
  if (value === undefined) return `legacy:${index}`
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  throw new Error(`prompt_order[${index}].character_id must be a non-empty string or safe integer`)
}

/**
 * Parse SillyTavern JSONL while preserving swipes and inert rows.
 * @param source - UTF-8 JSONL text.
 * @param options - Explicit source provenance.
 * @returns Versioned chat IR.
 */
export function importChat(source: string, options: SillyTavernImportOptions = {}): SillyTavernChatIR {
  if (Buffer.byteLength(source, 'utf8') > MAX_JSON_BYTES) throw new Error(`SillyTavern chat exceeds ${MAX_JSON_BYTES} bytes`)
  const lines = source.replace(/^\uFEFF/u, '').split(/\r?\n/u)
    .map((text, index) => ({ text, line: index + 1 })).filter(row => row.text.trim() !== '')
  const headerLine = lines[0]
  if (headerLine === undefined) throw new Error('SillyTavern chat is empty')
  const header = parseJsonObject(headerLine.text, `SillyTavern chat line ${headerLine.line}`)
  if (!isObject(header.chat_metadata)) throw new Error('SillyTavern chat first row must contain chat_metadata')
  const messages = lines.slice(1).map(({ text, line }): SillyTavernChatMessageIR => {
    const raw = parseJsonObject(text, `SillyTavern chat line ${line}`)
    const content = requiredString(raw.mes, `SillyTavern chat line ${line}.mes`)
    const isUser = raw.is_user === true
    const isSystem = raw.is_system === true
    if (isUser && isSystem) throw new Error(`SillyTavern chat line ${line} cannot be both user and system`)
    const narrator = isObject(raw.extra) && raw.extra.type === 'narrator'
    const role = narrator ? 'narrator' : isUser ? 'user' : isSystem ? 'system' : 'assistant'
    const swipes = stringArray(raw.swipes, `SillyTavern chat line ${line}.swipes`)
    const activeSwipe = raw.swipe_id === undefined ? undefined : nonNegativeInteger(raw.swipe_id, `SillyTavern chat line ${line}.swipe_id`)
    if (activeSwipe !== undefined && activeSwipe >= swipes.length) throw new Error(`SillyTavern chat line ${line} swipe_id is out of range`)
    return {
      line, role, content, swipes, raw,
      ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
      ...(activeSwipe === undefined ? {} : { activeSwipe }),
    }
  })
  return {
    schemaVersion: 1,
    ...(typeof header.user_name === 'string' ? { userName: header.user_name } : {}),
    ...(typeof header.character_name === 'string' ? { characterName: header.character_name } : {}),
    messages,
    compatibility: compatibility('sillytavern-chat-jsonl', header, source, options, []),
  }
}

function preflightPng(data: Uint8Array): void {
  let offset = PNG_SIGNATURE.byteLength
  let ended = false
  while (offset < data.byteLength) {
    if (data.byteLength - offset < 12) throw new Error('Character Card PNG has a truncated chunk')
    const length = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0)
    const end = offset + 12 + length
    if (!Number.isSafeInteger(end) || end > data.byteLength) throw new Error('Character Card PNG has an invalid chunk length')
    const chunkName = Buffer.from(data.subarray(offset + 4, offset + 8)).toString('ascii')
    offset = end
    if (chunkName === 'IEND') { ended = true; break }
  }
  if (!ended) throw new Error('Character Card PNG has no IEND chunk')
}

function decodeCanonicalBase64(value: string, label: string): string {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new Error(`${label} metadata is not canonical base64`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.byteLength > MAX_CARD_JSON_BYTES) throw new Error(`${label} card exceeds ${MAX_CARD_JSON_BYTES} bytes`)
  if (bytes.toString('base64') !== value) throw new Error(`${label} metadata is not canonical base64`)
  return decodeUtf8(bytes, `${label} metadata`)
}

function decodeUtf8(data: Uint8Array, label: string): string {
  if (data.byteLength > MAX_CARD_JSON_BYTES) throw new Error(`${label} exceeds ${MAX_CARD_JSON_BYTES} bytes`)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/u, '') } catch (error: unknown) {
    throw new Error(`${label} is not valid UTF-8`, { cause: error })
  }
}

function charxFilter(seen: Set<string>, totals: { entries: number; bytes: number }): (file: UnzipFileInfo) => boolean {
  return (file) => {
    const path = normalizeCharxPath(file.name)
    totals.entries += 1
    totals.bytes += file.originalSize
    if (totals.entries > MAX_CHARX_ENTRIES) throw new Error(`CHARX contains more than ${MAX_CHARX_ENTRIES} entries`)
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 || totals.bytes > MAX_CHARX_UNCOMPRESSED_BYTES) {
      throw new Error(`CHARX expands beyond ${MAX_CHARX_UNCOMPRESSED_BYTES} bytes`)
    }
    if (seen.has(path)) throw new Error(`CHARX contains duplicate path ${JSON.stringify(path)}`)
    seen.add(path)
    return true
  }
}

function normalizeCharxPath(value: string): string {
  const normalized = value.replace(/\\/gu, '/')
  if (normalized.startsWith('/') || /^[a-z]:/iu.test(normalized)) throw new Error('CHARX contains an invalid archive path')
  const path = normalized.replace(/\/+$/gu, '')
  if (path === '' || path.includes('\0')) throw new Error('CHARX contains an invalid archive path')
  if (path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('CHARX contains an unsafe archive path')
  }
  return path
}

function charxAssets(imported: CharacterCardImport, entries: ReadonlyMap<string, Uint8Array>): CharacterArchiveAsset[] {
  const root = imported.character.compatibility?.unknownFields
  const data = isObject(root?.data) ? root.data : undefined
  if (!Array.isArray(data?.assets)) return []
  return data.assets.flatMap((value): CharacterArchiveAsset[] => {
    if (!isObject(value) || typeof value.uri !== 'string' || typeof value.type !== 'string'
      || typeof value.name !== 'string' || typeof value.ext !== 'string') return []
    const path = embeddedCharxPath(value.uri)
    const bytes = path === undefined ? undefined : entries.get(path)
    const mediaType = imageMediaType(value.ext)
    if (path === undefined || bytes === undefined || mediaType === undefined) return []
    return [{ path, type: value.type, name: value.name, mediaType, byteLength: bytes.byteLength, contentHash: sha256Bytes(bytes) }]
  })
}

function embeddedCharxPath(uri: string): string | undefined {
  const value = uri.trim()
  const prefix = ['embeded://', 'embedded://', '__asset:'].find(candidate => value.toLocaleLowerCase().startsWith(candidate))
  return prefix === undefined ? undefined : normalizeCharxPath(value.slice(prefix.length))
}

function imageMediaType(extension: string): string | undefined {
  const types: Readonly<Record<string, string>> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  }
  return types[extension.trim().toLocaleLowerCase().replace(/^\./u, '')]
}

function components(): readonly RpComponentDefinition[] {
  return ['character-card', 'character-card-png', 'character-card-charx', 'persona', 'world-info', 'preset', 'chat'].map(id => ({
    id: RpComponentId(`rp.compat.sillytavern.${id}`), packageId: PACKAGE, version: '1.0.0', trust: 'L0',
    scopes: ['deployment', 'experience', 'profile', 'conversation'], provides: [`import:sillytavern:${id}`],
  }))
}

function capabilities(): readonly RpCapabilityContribution[] {
  const capability = (
    id: string,
    title: string,
    invoke: (source: string, options: SillyTavernImportOptions) => JsonValue,
  ): RpCapabilityContribution => ({
    descriptor: {
      id: RpCapabilityId(`rp.import.sillytavern.${id}`), kind: id === 'world-info' ? 'lore' : 'tool', version: '1.0.0',
      title, description: `${title}; unknown fields are retained but never executed.`, trust: 'L0',
      scopes: ['deployment', 'experience', 'profile', 'conversation'], tags: ['rp', 'import', 'sillytavern', 'inert'],
    },
    invoke: (request) => {
      const input = object(request.input, `${title} input`)
      const source = requiredString(input.source, `${title} input.source`)
      const options: SillyTavernImportOptions = {
        ...(typeof input.sourceId === 'string' ? { sourceId: input.sourceId } : {}),
        ...(typeof input.importedAt === 'number' ? { importedAt: input.importedAt } : {}),
      }
      return Promise.resolve(invoke(source, options))
    },
  })
  const binaryCapability = (
    id: string,
    title: string,
    invoke: (data: Uint8Array, options: SillyTavernImportOptions) => JsonValue,
  ): RpCapabilityContribution => ({
    descriptor: {
      id: RpCapabilityId(`rp.import.sillytavern.${id}`), kind: 'tool', version: '1.0.0', title,
      description: `${title}; archive content stays inert and bounded.`, trust: 'L0',
      scopes: ['deployment', 'experience', 'profile', 'conversation'],
      tags: ['rp', 'import', 'sillytavern', 'binary', 'inert'],
    },
    invoke: (request) => {
      const input = object(request.input, `${title} input`)
      const bytes = canonicalInputBytes(requiredString(input.base64, `${title} input.base64`), title)
      const options: SillyTavernImportOptions = {
        ...(typeof input.sourceId === 'string' ? { sourceId: input.sourceId } : {}),
        ...(typeof input.importedAt === 'number' ? { importedAt: input.importedAt } : {}),
      }
      return Promise.resolve(invoke(bytes, options))
    },
  })
  return [
    capability('character-card', 'Import Character Card', (source, options) => importCharacterCard(source, options) as unknown as JsonValue),
    capability('persona', 'Import Persona', (source, options) => importPersona(source, options) as unknown as JsonValue),
    capability('world-info', 'Import World Info', (source, options) => importWorldInfo(source, options) as unknown as JsonValue),
    capability('preset', 'Import Preset', (source, options) => importPreset(source, options) as unknown as JsonValue),
    capability('chat', 'Import Chat JSONL', (source, options) => importChat(source, options) as unknown as JsonValue),
    binaryCapability('character-card-png', 'Import Character Card PNG', (data, options) => importCharacterCardPng(data, options) as unknown as JsonValue),
    binaryCapability('character-card-charx', 'Import Character Card CHARX', (data, options) => importCharacterCardCharx(data, options) as unknown as JsonValue),
  ]
}

function loreFromBook(book: JsonObject, fallbackName: string, source: string, options: SillyTavernImportOptions): LoreIR {
  const entries = entriesFromUnknown(book.entries, 'character_book.entries')
  const name = typeof book.name === 'string' && book.name.trim() !== '' ? book.name : fallbackName
  return {
    schemaVersion: 1, id: stableId('lore', name, source), name,
    entries: entries.map(([sourceId, value], index) => loreEntry(value, sourceId, index)),
    compatibility: compatibility('character-card-lorebook', book, source, options, advancedLoreWarnings(entries)),
  }
}

function loreEntry(value: JsonValue, sourceId: string, index: number): LoreEntryIR {
  const entry = object(value, `lore entry ${sourceId}`)
  let idValue = sourceId
  if (entry.id !== undefined && entry.id !== null) {
    if (typeof entry.id !== 'string' && typeof entry.id !== 'number') {
      throw new Error(`lore entry ${sourceId}.id must be a string or number`)
    }
    idValue = String(entry.id)
  }
  return {
    id: idValue,
    content: requiredString(entry.content, `lore entry ${sourceId}.content`),
    keys: stringArray(entry.keys ?? entry.key, `lore entry ${sourceId}.keys`),
    ...(entry.secondary_keys === undefined && entry.keysecondary === undefined ? {} : {
      secondaryKeys: stringArray(entry.secondary_keys ?? entry.keysecondary, `lore entry ${sourceId}.secondaryKeys`),
    }),
    ...(typeof entry.constant === 'boolean' ? { constant: entry.constant } : {}),
    enabled: entry.enabled !== false && entry.disable !== true,
    priority: finiteNumber(entry.priority ?? entry.insertion_order ?? entry.order ?? index, `lore entry ${sourceId}.priority`),
    extensions: entry,
  }
}

function entriesFromUnknown(value: JsonValue | undefined, path: string): readonly (readonly [string, JsonValue])[] {
  if (Array.isArray(value)) return value.map((entry, index) => [String(index), entry] as const)
  if (isObject(value)) return Object.entries(value)
  throw new Error(`${path} must be an object or array`)
}

function advancedLoreWarnings(entries: readonly (readonly [string, JsonValue])[]): CompatibilityLossItem[] {
  const items = new Map<string, CompatibilityLossItem>()
  for (const [sourceId, value] of entries) {
    if (!isObject(value)) continue
    const path = `entries.${sourceId}`
    if (value.use_regex === true || value.regex === true) addLoss(items, {
      path, feature: 'regex-lore-matching', disposition: 'disabled',
      reason: 'Regex lore matching was preserved but not enabled.',
    })
    if (value.vectorized === true) addLoss(items, {
      path, feature: 'vector-lore-matching', disposition: 'disabled',
      reason: 'Vector matching was preserved but not enabled.',
    })
    if (value.probability !== undefined && value.probability !== 100) addLoss(items, {
      path, feature: 'probabilistic-lore-activation', disposition: 'disabled',
      reason: 'Probabilistic activation was preserved but not enabled.',
    })
    if (value.sticky !== undefined || value.cooldown !== undefined || value.delay !== undefined) addLoss(items, {
      path, feature: 'timed-lore-effects', disposition: 'disabled',
      reason: 'Timed lore effects were preserved but not enabled.',
    })
  }
  return [...items.values()]
}

function extensionWarnings(value: JsonObject): CompatibilityLossItem[] {
  const items: CompatibilityLossItem[] = []
  const extensions = isObject(value.extensions) ? value.extensions : undefined
  if (extensions?.regex_scripts !== undefined) items.push({
    path: 'extensions.regex_scripts', feature: 'display-regex', disposition: 'disabled',
    reason: 'Regex scripts were preserved but not executed.',
  })
  if (extensions?.tavern_helper !== undefined) items.push({
    path: 'extensions.tavern_helper', feature: 'tavern-helper', disposition: 'disabled',
    reason: 'TavernHelper scripts were preserved but not executed.',
  })
  if (value.assets !== undefined) items.push({
    path: 'assets', feature: 'remote-assets', disposition: 'preserved-inert',
    reason: 'Asset declarations were preserved but not fetched.',
  })
  return items
}

function compatibility(
  format: string,
  raw: JsonObject,
  source: string,
  options: SillyTavernImportOptions,
  losses: readonly CompatibilityLossItem[],
): CompatibilityEnvelope {
  const provenance: SourceProvenance = {
    format,
    ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }),
    importedAt: options.importedAt ?? Date.now(),
    contentHash: sha256(source),
  }
  const warnings = [...new Set(losses.map(item => item.reason))]
  return {
    source: provenance,
    unknownFields: raw,
    ...(warnings.length === 0 ? {} : { warnings }),
    lossReport: {
      schemaVersion: 1,
      losslessData: true,
      executableBehaviorDisabled: losses.some(item => item.disposition === 'disabled'),
      items: losses.map(item => ({ ...item })),
    },
  }
}

function binaryCompatibility(
  format: string,
  source: Uint8Array,
  options: SillyTavernImportOptions,
  losses: readonly CompatibilityLossItem[],
): CompatibilityEnvelope {
  return {
    source: {
      format,
      ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }),
      importedAt: options.importedAt ?? Date.now(),
      contentHash: sha256Bytes(source),
    },
    unknownFields: {},
    warnings: [...new Set(losses.map(item => item.reason))],
    lossReport: {
      schemaVersion: 1,
      losslessData: losses.every(item => item.disposition !== 'omitted'),
      executableBehaviorDisabled: losses.some(item => item.disposition === 'disabled'),
      items: losses.map(item => ({ ...item })),
    },
  }
}

function addLoss(target: Map<string, CompatibilityLossItem>, item: CompatibilityLossItem): void {
  target.set(`${item.path}\0${item.feature}`, item)
}

function parseJsonObject(source: string, label: string): JsonObject {
  if (Buffer.byteLength(source, 'utf8') > MAX_JSON_BYTES) throw new Error(`${label} exceeds ${MAX_JSON_BYTES} bytes`)
  let value: unknown
  try { value = JSON.parse(source.replace(/^\uFEFF/u, '')) } catch (error: unknown) { throw new Error(`${label} is not valid JSON`, { cause: error }) }
  if (!isJsonValue(value) || !isObject(value)) throw new Error(`${label} must be a finite JSON object`)
  return value
}

function object(value: unknown, path: string): JsonObject {
  if (!isJsonValue(value) || !isObject(value)) throw new Error(`${path} must be a JSON object`)
  return value
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isObject(value) && Object.values(value).every(isJsonValue)
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}

function optionalText(value: unknown, key: 'description' | 'personality' | 'scenario'): Partial<Record<typeof key, string>> {
  return typeof value === 'string' && value !== '' ? { [key]: value } : {}
}

function stringArray(value: unknown, path: string): string[] {
  if (value === undefined) return []
  if (typeof value === 'string') return value === '' ? [] : value.split(',').map(item => item.trim()).filter(Boolean)
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${path} must be an array of strings`)
  return value.filter((item): item is string => typeof item === 'string')
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
  return value
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${path} must be a non-negative integer`)
  return value
}

function stableId(kind: string, nameValue: string, source: string): string {
  const slug = nameValue.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48) || kind
  return `${kind}:${slug}:${sha256(source).slice(0, 12)}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalInputBytes(value: string, label: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new Error(`${label} input.base64 must be canonical base64`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new Error(`${label} input.base64 must be canonical base64`)
  return bytes
}
