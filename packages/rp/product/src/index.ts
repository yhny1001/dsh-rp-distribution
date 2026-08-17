/** Local-first RP product plugin for the installed DSH Host. */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { importProductFiles, type ProductImportReport } from './import.ts'
import {
  primaryCharacter,
  resolveCharacterText,
  resolvePromptLayers,
  type ProductEntityKind,
  type ProductState,
  type SessionComposition,
  type TranscriptRole,
} from './model.ts'
import { ProductStore, productAssetPath, productDataRoot } from './store.ts'

export const name = 'dsh-rp-product'
export const inject = ['webServer', 'commands', 'agentPresets']

const API = '/api/dsh-rp/product'
const TAVERN_PRESET_ID = 'rp-tavern'
const AGENT_PRESET_ID = 'rp-agent'
const MAX_BODY_BYTES = 64 * 1024 * 1024
const MAX_IMPORT_FILES = 32
const MAX_IMPORT_FILE_BYTES = 32 * 1024 * 1024
const MAX_COMMAND_PAYLOAD_CHARS = 2_000_000

interface SurfaceEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  readonly surfaceOp?: 'append' | { readonly op: 'replace'; readonly start: number; readonly end: number }
  readonly sourceEventSeqs?: readonly number[]
}

interface ProductSession {
  readonly id?: string
  readonly events: readonly SurfaceEvent[]
  readonly header?: { readonly parentSession?: string; readonly seedLength?: number }
  append(type: 'agent-preset/selected', data: { readonly agentPreset: string }): unknown
  append(type: 'user/message', data: UserMessage, options: {
    readonly surfaceOp: 'append' | { readonly op: 'replace'; readonly start: number; readonly end: number }
    readonly sourceEventSeqs?: readonly number[]
  }): { readonly seq: number }
}

interface UserMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly source: {
    readonly kind: 'plugin'
    readonly plugin: '@dsh-rp/product'
    readonly form: 'notice' | 'recall'
    readonly summary?: string
  }
}

interface ProductAgent {
  readonly id: string
  readonly status?: 'idle' | 'running'
  readonly ctx: object
  readonly session: ProductSession
}

interface CommandResult { readonly kind: 'success' | 'error'; readonly text: string }
interface CommandInput { readonly agent: ProductAgent; readonly rawInput: string }

interface ProductContext {
  readonly webServer: {
    register(options: {
      readonly kind: 'prefix'
      readonly path: string
      readonly handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }): () => void
  }
  readonly commands: {
    register(definition: {
      readonly name: string
      readonly description: string
      readonly input: { readonly hint: string }
      readonly handler: (input: CommandInput) => Promise<CommandResult>
    }): () => void
  }
  readonly agentPresets: {
    composedPreset(agentContext: object): string | undefined
    recompose(agentContext: object, id: string): Promise<{ readonly id: string }>
  }
  on(event: 'session/event', listener: (session: ProductSession, event: SurfaceEvent) => void): () => void
  on(event: 'agent/created', listener: (payload: { readonly agent: ProductAgent }) => void): () => void
  effect(factory: () => (() => void) | void, label?: string): unknown
  readonly logger?: { warn(message: string): void; error(error: unknown): void }
}

/** Install the local API, RP commands, transcript projection, and owned Agent preset. */
export async function apply(ctx: ProductContext): Promise<void> {
  await installAgentPreset()
  const store = await ProductStore.open()

  registerCommand(ctx, {
    name: 'rp-studio-bind',
    description: 'bind the current Session to one Tavern-style RP composition',
    handler: async ({ agent, rawInput }) => {
      try {
        const request = decodeBind(rawInput)
        if (request.sessionId !== agent.id) throw new Error('composition Session must match the receiving Agent')
        const currentPreset = ctx.agentPresets.composedPreset(agent.ctx)
        const targetPreset = request.mode === 'agent' ? AGENT_PRESET_ID : TAVERN_PRESET_ID
        const rpPresets = new Set([TAVERN_PRESET_ID, AGENT_PRESET_ID])
        if (currentPreset !== targetPreset && agent.session.events.some(event => event.type === 'turn/start')) {
          throw new Error('Tavern Chat / Agent RP mode can only change on a blank Session; create a new Session to switch runtime mode')
        }
        const next = await store.bindWithEffect(request, request.baseRevision, async () => {
          if (currentPreset !== targetPreset) {
            if (currentPreset !== undefined && !rpPresets.has(currentPreset) && agent.session.events.some(event => event.type === 'turn/start')) {
              throw new Error('RP runtime cannot replace another Agent preset after the Session started')
            }
            const preset = await ctx.agentPresets.recompose(agent.ctx, targetPreset)
            agent.session.append('agent-preset/selected', { agentPreset: preset.id })
          }
        })
        const binding = next.bindings[agent.id]
        return { kind: 'success', text: binding === undefined ? 'RP composition unavailable' : compositionSummary(next, binding) }
      } catch (error: unknown) { return { kind: 'error', text: publicError(error) } }
    },
  })

  registerCommand(ctx, {
    name: 'rp-studio-edit',
    description: 'replace one RP transcript message on the model-visible Session surface',
    handler: async ({ agent, rawInput }) => {
      try {
        requireIdle(agent)
        const request = decodeEdit(rawInput)
        if (request.sessionId !== agent.id) throw new Error('edit Session must match the receiving Agent')
        const state = store.snapshot()
        const record = state.transcripts[agent.id]?.messages.find(message => message.sourceSeq === request.sourceSeq)
        if (record === undefined) throw new Error('RP transcript message is unavailable')
        if (record.editRevision !== request.editRevision) throw new Error('message edit revision conflict; refresh the RP view')
        const target = agent.session.events[record.currentSurfaceSeq]
        if (target === undefined || target.seq !== record.currentSurfaceSeq) throw new Error('message surface node is unavailable')
        const replacementSeq = agent.session.events.length
        const messageId = originalMessageId(agent.session.events[record.sourceSeq])
        const modelText = record.role === 'assistant'
          ? assistantHistory(record.speakerName, request.content)
          : request.content
        const sources = [...new Set([target.seq, ...(target.sourceEventSeqs ?? [])])].sort((left, right) => left - right)
        await store.editWithEffect(agent.id, record.sourceSeq, record.editRevision, request.content, replacementSeq, () => {
          agent.session.append('user/message', pluginMessage(messageId, modelText, record.role, record.speakerName), {
            surfaceOp: { op: 'replace', start: target.seq, end: target.seq },
            sourceEventSeqs: sources,
          })
        })
        return { kind: 'success', text: `已更新${record.speakerName}的正文；后续模型上下文使用新版本` }
      } catch (error: unknown) { return { kind: 'error', text: publicError(error) } }
    },
  })

  registerCommand(ctx, {
    name: 'rp-studio-fork-adopt',
    description: 'adopt one native Session fork with RP projections clipped to its seeded prefix',
    handler: async ({ agent, rawInput }) => {
      try {
        requireIdle(agent)
        const request = decodeForkAdopt(rawInput)
        if (agent.session.header?.parentSession !== request.sourceSessionId) throw new Error('RP fork source does not match native Session lineage')
        const source = store.snapshot().bindings[request.sourceSessionId]
        if (source === undefined) throw new Error('RP fork source composition is unavailable')
        const expectedPreset = source.mode === 'agent' ? AGENT_PRESET_ID : TAVERN_PRESET_ID
        if (ctx.agentPresets.composedPreset(agent.ctx) !== expectedPreset) throw new Error('native Session fork did not inherit the RP Agent preset')
        const seedLength = agent.session.header.seedLength ?? agent.session.events.length
        await store.forkProjection(request.sourceSessionId, agent.id, seedLength, request.maxTurn)
        return { kind: 'success', text: `已从 Turn ${String(request.maxTurn)} 的结束状态建立 RP 分支` }
      } catch (error: unknown) { return { kind: 'error', text: publicError(error) } }
    },
  })

  registerCommand(ctx, {
    name: 'rp-studio-opening',
    description: 'append one selected Character Card greeting to the RP transcript',
    handler: async ({ agent, rawInput }) => {
      try {
        requireIdle(agent)
        const request = decodeOpening(rawInput)
        if (request.sessionId !== agent.id) throw new Error('opening Session must match the receiving Agent')
        const state = store.snapshot()
        const character = primaryCharacter(state, agent.id)
        if (character === undefined) throw new Error('RP Session has no primary character')
        const greetings = [character.openingMessage, ...character.alternateGreetings].filter(value => value.trim() !== '')
        const sourceContent = greetings[request.greetingIndex]
        if (sourceContent === undefined) throw new Error('selected Character Card greeting does not exist')
        const content = resolveCharacterText(state, agent.id, sourceContent)
        const sourceSeq = agent.session.events.length
        await store.openingWithEffect(agent.id, sourceSeq, content, () => {
          agent.session.append('user/message', pluginMessage(randomUUID(), assistantHistory(character.name, content), 'assistant', character.name), {
            surfaceOp: 'append',
          })
        })
        return { kind: 'success', text: `已把${character.name}的开场白加入会话` }
      } catch (error: unknown) { return { kind: 'error', text: publicError(error) } }
    },
  })

  registerCommand(ctx, {
    name: 'rp-studio-chat-import',
    description: 'append a validated SillyTavern chat history as explicitly sourced RP transcript messages',
    handler: async ({ agent, rawInput }) => {
      try {
        requireIdle(agent)
        const request = decodeChatImport(rawInput)
        if (request.sessionId !== agent.id) throw new Error('chat import Session must match the receiving Agent')
        const startSeq = agent.session.events.length
        await store.historyWithEffect(agent.id, startSeq, request.messages, () => {
          for (const message of request.messages) {
            const content = message.role === 'assistant' ? assistantHistory(message.speakerName, message.content) : message.content
            agent.session.append('user/message', pluginMessage(randomUUID(), content, message.role, message.speakerName), { surfaceOp: 'append' })
          }
        })
        return { kind: 'success', text: `已导入 ${String(request.messages.length)} 条酒馆历史；角色与 Persona 署名保持独立` }
      } catch (error: unknown) { return { kind: 'error', text: publicError(error) } }
    },
  })

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    const role = observedTranscriptRole(event)
    if (role === undefined || session.id === undefined) return
    void store.observeMessage(session.id, event.seq, role, event.time).catch(error => ctx.logger?.error(error))
  }), 'dsh-rp-product: transcript speaker projection')

  ctx.effect(() => ctx.on('agent/created', ({ agent }) => {
    for (const event of agent.session.events) {
      const role = observedTranscriptRole(event)
      if (role !== undefined) void store.observeMessage(agent.id, event.seq, role, event.time).catch(error => ctx.logger?.error(error))
    }
  }), 'dsh-rp-product: resumed transcript speaker adoption')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API,
    handler: async (req, res) => {
      try {
        assertSameOrigin(req)
        await handleApi(store, req, res)
      } catch (error: unknown) {
        if (!res.writableEnded) json(res, statusFor(error), { ok: false, error: publicError(error) })
      }
    },
  }), 'dsh-rp-product: local API')
}

function registerCommand(ctx: ProductContext, definition: {
  readonly name: string
  readonly description: string
  readonly handler: (input: CommandInput) => Promise<CommandResult>
}): void {
  ctx.effect(() => ctx.commands.register({ ...definition, input: { hint: '<base64url-payload>' } }), `dsh-rp-product: ${definition.name}`)
}

async function handleApi(store: ProductStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? API, 'http://localhost')
  const route = url.pathname.slice(API.length).replace(/^\//u, '')
  const method = req.method ?? 'GET'

  if (method === 'GET' && route.startsWith('asset/')) {
    const id = decodeURIComponent(route.slice('asset/'.length))
    const state = store.snapshot()
    const avatar = state.characters.map(character => character.avatar).find(candidate => candidate?.id === id)
    if (avatar === undefined) throw new Error('RP product asset not found')
    const bytes = await readFile(productAssetPath(id))
    res.statusCode = 200
    res.setHeader('content-type', avatar.mediaType)
    res.setHeader('content-length', String(bytes.byteLength))
    res.setHeader('cache-control', 'private, max-age=31536000, immutable')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end(bytes)
    return
  }

  if (method === 'GET' && (route === '' || route === 'state')) {
    const state = store.snapshot()
    const sessionId = url.searchParams.get('sessionId') ?? ''
    json(res, 200, responseState(state, sessionId))
    return
  }

  if (method === 'PUT' && route === 'entity') {
    const body = await readJson(req)
    const state = await store.upsert(entityKind(body.kind), body.entity, revision(body.baseRevision))
    json(res, 200, responseState(state, optionalSessionId(body.sessionId)))
    return
  }

  if (method === 'DELETE' && route === 'entity') {
    const body = await readJson(req)
    const state = await store.remove(entityKind(body.kind), requiredString(body.id, 'entity id', 128), revision(body.baseRevision))
    json(res, 200, responseState(state, optionalSessionId(body.sessionId)))
    return
  }

  if (method === 'POST' && route === 'import') {
    const body = await readJson(req)
    const files = importFiles(body.files)
    const imported = importProductFiles(files)
    const accepted = imported.entities.characters.length + imported.entities.personas.length
      + imported.entities.worlds.length + imported.entities.presets.length
    const state = accepted === 0 ? store.snapshot() : await store.importBatch(imported.entities, imported.assets, revision(body.baseRevision))
    json(res, 200, { ...responseState(state, optionalSessionId(body.sessionId)), importReports: imported.reports })
    return
  }

  if (method === 'POST' && route === 'preset/adapt') {
    const body = await readJson(req)
    const adapted = await store.adaptPreset(requiredString(body.presetId, 'presetId', 128), revision(body.baseRevision))
    json(res, 200, {
      ...responseState(adapted.state, optionalSessionId(body.sessionId)),
      adaptedPresetId: adapted.presetId,
    })
    return
  }

  if (method === 'POST' && route === 'choice/select') {
    const body = await readJson(req)
    const sessionId = requiredString(body.sessionId, 'sessionId', 512)
    const state = await store.selectChoice(sessionId, requiredString(body.choiceId, 'choiceId', 240))
    json(res, 200, responseState(state, sessionId))
    return
  }

  if (method === 'PUT' && route === 'binding') {
    const body = await readJson(req)
    const state = await store.bind(body.binding, revision(body.baseRevision))
    const binding = body.binding
    const sessionId = typeof binding === 'object' && binding !== null && 'sessionId' in binding
      ? optionalSessionId((binding as { sessionId?: unknown }).sessionId)
      : ''
    json(res, 200, responseState(state, sessionId))
    return
  }

  json(res, 404, { ok: false, error: `route not found: ${method} ${route}` })
}

function responseState(state: ProductState, sessionId: string): object {
  return {
    ok: true,
    state,
    sessionId,
    binding: sessionId === '' ? undefined : state.bindings[sessionId],
    layers: sessionId === '' ? [] : resolvePromptLayers(state, sessionId),
    transcript: sessionId === '' ? undefined : state.transcripts[sessionId],
    runtime: sessionId === '' ? undefined : state.runtimes[sessionId],
    agentPresetId: state.bindings[sessionId]?.mode === 'agent' ? AGENT_PRESET_ID : TAVERN_PRESET_ID,
  }
}

interface BindCommandRequest extends SessionComposition { readonly baseRevision: number }

function decodeBind(rawInput: string): BindCommandRequest {
  const source = decodePayload(rawInput)
  return {
    sessionId: requiredString(source.sessionId, 'sessionId', 512),
    mode: sessionMode(source.mode),
    experienceId: optionalText(source.experienceId, 'experienceId', 128) || 'rp-adaptive',
    presetId: requiredString(source.presetId, 'presetId', 128),
    systemId: requiredString(source.systemId, 'systemId', 128),
    characterIds: stringArray(source.characterIds, 'characterIds'),
    primaryCharacterId: optionalSessionId(source.primaryCharacterId),
    personaId: optionalSessionId(source.personaId),
    worldId: optionalSessionId(source.worldId),
    scene: optionalText(source.scene, 'scene', 16_000),
    updatedAt: 0,
    baseRevision: revision(source.baseRevision),
  }
}

function decodeEdit(rawInput: string): {
  readonly sessionId: string
  readonly sourceSeq: number
  readonly editRevision: number
  readonly content: string
} {
  const source = decodePayload(rawInput)
  return {
    sessionId: requiredString(source.sessionId, 'sessionId', 512),
    sourceSeq: nonNegativeInteger(source.sourceSeq, 'sourceSeq'),
    editRevision: nonNegativeInteger(source.editRevision, 'editRevision'),
    content: requiredString(source.content, 'content', 32_000),
  }
}

function decodeOpening(rawInput: string): { readonly sessionId: string; readonly greetingIndex: number } {
  const source = decodePayload(rawInput)
  return {
    sessionId: requiredString(source.sessionId, 'sessionId', 512),
    greetingIndex: nonNegativeInteger(source.greetingIndex, 'greetingIndex'),
  }
}

function decodeChatImport(rawInput: string): {
  readonly sessionId: string
  readonly messages: readonly { readonly role: TranscriptRole; readonly speakerName: string; readonly content: string }[]
} {
  const source = decodePayload(rawInput)
  if (!Array.isArray(source.messages) || source.messages.length === 0 || source.messages.length > 500) throw new Error('chat import messages must contain 1-500 entries')
  let total = 0
  const messages = source.messages.map((value, index) => {
    if (!isRecord(value)) throw new Error(`chat import messages[${String(index)}] must be an object`)
    const role = value.role === 'user' || value.role === 'assistant' ? value.role : undefined
    if (role === undefined) throw new Error(`chat import messages[${String(index)}].role must be user or assistant`)
    const content = requiredString(value.content, `chat import messages[${String(index)}].content`, 32_000)
    total += content.length
    return Object.freeze({ role, speakerName: requiredString(value.speakerName, `chat import messages[${String(index)}].speakerName`, 120), content })
  })
  if (total > 1_000_000) throw new Error('chat import exceeds 1,000,000 characters')
  return Object.freeze({ sessionId: requiredString(source.sessionId, 'sessionId', 512), messages: Object.freeze(messages) })
}

function decodeForkAdopt(rawInput: string): { readonly sourceSessionId: string; readonly maxTurn: number } {
  const source = decodePayload(rawInput)
  return Object.freeze({
    sourceSessionId: requiredString(source.sourceSessionId, 'sourceSessionId', 512),
    maxTurn: positiveInteger(source.maxTurn, 'maxTurn'),
  })
}

function decodePayload(rawInput: string): Record<string, unknown> {
  const encoded = rawInput.trim()
  if (encoded === '' || encoded.length > MAX_COMMAND_PAYLOAD_CHARS) throw new Error('RP command payload is missing or too large')
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown }
  catch { throw new Error('RP command payload is not valid base64url JSON') }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('RP command payload must be an object')
  return parsed as Record<string, unknown>
}

function importFiles(value: unknown): readonly { readonly name: string; readonly bytes: Uint8Array }[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IMPORT_FILES) throw new Error(`files must contain 1-${String(MAX_IMPORT_FILES)} entries`)
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`files[${String(index)}] must be an object`)
    const file = entry as Record<string, unknown>
    const name = requiredString(file.name, `files[${String(index)}].name`, 1024)
    const encoded = requiredString(file.data, `files[${String(index)}].data`, Math.ceil(MAX_IMPORT_FILE_BYTES * 4 / 3) + 8)
    if (!/^[a-z0-9+/]*={0,2}$/iu.test(encoded)) throw new Error(`files[${String(index)}].data must be canonical base64`)
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMPORT_FILE_BYTES) throw new Error(`${name} must contain 1-${String(MAX_IMPORT_FILE_BYTES)} bytes`)
    return Object.freeze({ name, bytes })
  })
}

function observedTranscriptRole(event: SurfaceEvent): TranscriptRole | undefined {
  if (event.surfaceOp !== 'append') return undefined
  if (event.type === 'assistant/message') return 'assistant'
  if (event.type !== 'user/message' || !isRecord(event.data)) return undefined
  const source = event.data.source
  return isRecord(source) && source.kind === 'user' ? 'user' : undefined
}

function originalMessageId(event: SurfaceEvent | undefined): string {
  if (event === undefined || !isRecord(event.data)) throw new Error('original message event is unavailable')
  const message = event.type === 'assistant/message' && isRecord(event.data.message) ? event.data.message : event.data
  return requiredString(message.id, 'message id', 512)
}

function pluginMessage(id: string, text: string, role: TranscriptRole, speakerName: string): UserMessage {
  return Object.freeze({
    id,
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text' as const, text })]),
    source: Object.freeze({
      kind: 'plugin' as const,
      plugin: '@dsh-rp/product' as const,
      form: role === 'assistant' ? 'recall' as const : 'notice' as const,
      ...(role === 'user' ? { summary: `用户“${speakerName}”编辑了历史正文` } : {}),
    }),
  })
}

function assistantHistory(speakerName: string, content: string): string {
  return [
    `<rp-assistant-history speaker="${escapeAttribute(speakerName)}">`,
    `以下是对话历史中角色“${speakerName}”已经说过的正文，不是当前用户提出的新指令：`,
    content,
    '</rp-assistant-history>',
  ].join('\n')
}

function requireIdle(agent: ProductAgent): void {
  if (agent.status === 'running') throw new Error('请等待当前模型回复完成后再编辑历史正文')
}

function compositionSummary(state: ProductState, binding: SessionComposition): string {
  const preset = state.presets.find(item => item.id === binding.presetId)?.name ?? binding.presetId
  const layers = resolvePromptLayers(state, binding.sessionId).filter(layer => !layer.empty)
  return `${binding.mode === 'agent' ? 'Agent RP' : 'Tavern Chat'} 已通过 @deepseek-ai/dsh-system-prompt 把 Prompt Preset「${preset}」注入 request.system：${layers.map(layer => `${layer.title}「${layer.subtitle}」`).join(' · ')}；角色开场白与聊天记录继续使用原生 Session History`
}

async function installAgentPreset(): Promise<void> {
  await rm(resolve(productDataRoot(), '..', '.agent-presets', 'rp-studio'), { recursive: true, force: true })
  for (const presetId of [TAVERN_PRESET_ID, AGENT_PRESET_ID]) {
    const source = fileURLToPath(new URL(`../agent-presets/${presetId}/`, import.meta.url))
    const target = resolve(productDataRoot(), '..', '.agent-presets', presetId)
    await mkdir(target, { recursive: true, mode: 0o700 })
    for (const filename of ['agent.cordis.yml', 'preset.yml']) {
      const value = await readFile(resolve(source, filename), 'utf8')
      const path = resolve(target, filename)
      if (!existsSync(path) || readFileSync(path, 'utf8') !== value) await writeFile(path, value, { encoding: 'utf8', mode: 0o600 })
    }
  }
}

function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin
  if (origin === undefined) return
  const host = req.headers.host
  if (host === undefined || new URL(origin).host !== host) throw new Error('cross-site RP product request rejected')
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    bytes += value.byteLength
    if (bytes > MAX_BODY_BYTES) throw new Error(`request exceeds ${String(MAX_BODY_BYTES)} bytes`)
    chunks.push(value)
  }
  let parsed: unknown
  try { parsed = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw new Error('request body must be valid JSON') }
  if (!isRecord(parsed)) throw new Error('request body must be a JSON object')
  return parsed
}

function json(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(`${JSON.stringify(body)}\n`)
}

function statusFor(error: unknown): number {
  const message = publicError(error)
  return message.includes('not found') ? 404 : message.includes('revision conflict') ? 409 : message.includes('cross-site') ? 403 : 400
}

function publicError(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function entityKind(value: unknown): ProductEntityKind {
  if (value === 'systems' || value === 'characters' || value === 'personas' || value === 'worlds' || value === 'presets') return value
  throw new Error('entity kind must be systems, characters, personas, worlds, or presets')
}

function revision(value: unknown): number { return nonNegativeInteger(value, 'baseRevision') }

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`)
  return value as number
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer`)
  return value as number
}

function requiredString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new Error(`${label} must be a non-empty string of at most ${String(max)} characters`)
  return value.trim()
}

function optionalText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be at most ${String(max)} characters`)
  return value.trim()
}

function optionalSessionId(value: unknown): string { return value === undefined || value === null || value === '' ? '' : requiredString(value, 'id', 512) }

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label} must be a string array`)
  return value.map(item => item.trim()).filter(item => item !== '')
}

function sessionMode(value: unknown): SessionComposition['mode'] {
  if (value === 'tavern' || value === 'agent') return value
  throw new Error('mode must be tavern or agent')
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function escapeAttribute(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') }

export type { ProductImportReport }
