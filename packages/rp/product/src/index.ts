/** Local-first RP product plugin for the installed DSH Host. */

import { Buffer } from 'node:buffer'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolvePromptLayers,
  type ProductEntityKind,
  type ProductState,
  type SessionComposition,
} from './model.ts'
import { ProductStore, productDataRoot } from './store.ts'

export const name = 'dsh-rp-product'
export const inject = ['webServer', 'commands', 'agentPresets']

const API = '/api/dsh-rp/product'
const PRESET_ID = 'rp-studio'
const MAX_BODY_BYTES = 512 * 1024

interface ProductAgent {
  readonly id: string
  readonly ctx: object
  readonly session: {
    readonly events: readonly { readonly type: string }[]
    append(type: 'agent-preset/selected', data: { readonly agentPreset: string }): unknown
  }
}

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
      readonly handler: (input: { readonly agent: ProductAgent; readonly rawInput: string }) => Promise<{
        readonly kind: 'success' | 'error'
        readonly text: string
      }>
    }): () => void
  }
  readonly agentPresets: {
    composedPreset(agentContext: object): string | undefined
    recompose(agentContext: object, id: string): Promise<{ readonly id: string }>
  }
  effect(factory: () => (() => void) | void, label?: string): unknown
  readonly logger?: { warn(message: string): void; error(error: unknown): void }
}

/** Install the local API, Session-binding command, and owned RP Agent preset. */
export async function apply(ctx: ProductContext): Promise<void> {
  await installAgentPreset()
  const store = await ProductStore.open()

  ctx.effect(() => ctx.commands.register({
    name: 'rp-studio-bind',
    description: 'bind the current Session to one layered RP Studio composition',
    input: { hint: '<base64url-composition>' },
    handler: async ({ agent, rawInput }) => {
      try {
        const request = decodeCommand(rawInput)
        if (request.sessionId !== agent.id) throw new Error('composition Session must match the receiving Agent')
        const currentPreset = ctx.agentPresets.composedPreset(agent.ctx)
        if (currentPreset !== PRESET_ID && agent.session.events.some(event => event.type === 'turn/start')) {
          throw new Error('RP Studio can only take over a blank Session; create a new Session to change Agent preset')
        }
        const next = await store.bindWithEffect(request, request.baseRevision, async () => {
          if (currentPreset !== PRESET_ID) {
            const preset = await ctx.agentPresets.recompose(agent.ctx, PRESET_ID)
            agent.session.append('agent-preset/selected', { agentPreset: preset.id })
          }
        })
        const binding = next.bindings[agent.id]
        return { kind: 'success', text: binding === undefined ? 'RP composition unavailable' : compositionSummary(next, binding) }
      } catch (error: unknown) {
        return { kind: 'error', text: publicError(error) }
      }
    },
  }), 'dsh-rp-product: Session binding command')

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

async function handleApi(store: ProductStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? API, 'http://localhost')
  const route = url.pathname.slice(API.length).replace(/^\//u, '')
  const method = req.method ?? 'GET'

  if (method === 'GET' && (route === '' || route === 'state')) {
    const state = store.snapshot()
    const sessionId = url.searchParams.get('sessionId') ?? ''
    json(res, 200, responseState(state, sessionId))
    return
  }

  if (method === 'PUT' && route === 'entity') {
    const body = await readJson(req)
    const kind = entityKind(body.kind)
    const baseRevision = revision(body.baseRevision)
    const state = await store.upsert(kind, body.entity, baseRevision)
    json(res, 200, responseState(state, optionalSessionId(body.sessionId)))
    return
  }

  if (method === 'DELETE' && route === 'entity') {
    const body = await readJson(req)
    const kind = entityKind(body.kind)
    const id = requiredString(body.id, 'entity id', 128)
    const state = await store.remove(kind, id, revision(body.baseRevision))
    json(res, 200, responseState(state, optionalSessionId(body.sessionId)))
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
    presetId: PRESET_ID,
  }
}

interface BindCommandRequest extends SessionComposition { readonly baseRevision: number }

function decodeCommand(rawInput: string): BindCommandRequest {
  const encoded = rawInput.trim()
  if (encoded === '' || encoded.length > 32_768) throw new Error('RP composition payload is missing or too large')
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown }
  catch { throw new Error('RP composition payload is not valid base64url JSON') }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('RP composition payload must be an object')
  const source = parsed as Record<string, unknown>
  return {
    sessionId: requiredString(source.sessionId, 'sessionId', 512),
    systemId: requiredString(source.systemId, 'systemId', 128),
    characterIds: stringArray(source.characterIds, 'characterIds'),
    primaryCharacterId: optionalSessionId(source.primaryCharacterId),
    personaId: optionalSessionId(source.personaId),
    worldId: optionalSessionId(source.worldId),
    scene: optionalText(source.scene, 'scene', 12_000),
    updatedAt: 0,
    baseRevision: revision(source.baseRevision),
  }
}

function compositionSummary(state: ProductState, binding: SessionComposition): string {
  const layers = resolvePromptLayers(state, binding.sessionId).filter(layer => !layer.empty)
  return `RP Studio 已应用：${layers.map(layer => `${layer.title}「${layer.subtitle}」`).join(' · ')}`
}

async function installAgentPreset(): Promise<void> {
  const source = fileURLToPath(new URL('../agent-presets/rp-studio/', import.meta.url))
  const target = resolve(productDataRoot(), '..', '.agent-presets', PRESET_ID)
  await mkdir(target, { recursive: true, mode: 0o700 })
  for (const filename of ['agent.cordis.yml', 'preset.yml']) {
    const value = await readFile(resolve(source, filename), 'utf8')
    const path = resolve(target, filename)
    if (!existsSync(path) || readFileSync(path, 'utf8') !== value) {
      await writeFile(path, value, { encoding: 'utf8', mode: 0o600 })
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
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('request body must be a JSON object')
  return parsed as Record<string, unknown>
}

function json(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(`${JSON.stringify(body)}\n`)
}

function statusFor(error: unknown): number {
  const message = publicError(error)
  return message.includes('revision conflict') ? 409 : message.includes('cross-site') ? 403 : 400
}

function publicError(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function entityKind(value: unknown): ProductEntityKind {
  if (value === 'systems' || value === 'characters' || value === 'personas' || value === 'worlds') return value
  throw new Error('entity kind must be systems, characters, personas, or worlds')
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('baseRevision must be a non-negative integer')
  return value as number
}

function requiredString(value: unknown, label: string, max: number): string {
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

function optionalSessionId(value: unknown): string {
  return value === undefined || value === null || value === '' ? '' : requiredString(value, 'id', 512)
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label} must be a string array`)
  return value.map(item => item.trim()).filter(item => item !== '')
}
