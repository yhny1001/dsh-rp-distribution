/** RP Studio Host API. @module @dsh-rp/web */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@dsh-rp/component-runtime'
import type {} from '@dsh-rp/capability-catalog'
import type {} from '@dsh-rp/pipeline-runtime'
import type {} from '@dsh-rp/experience-registry'
import { parseRpPackageSource } from '@dsh-rp/registry'
import type { RpPackageInstallation } from '@dsh-rp/registry'
import type {} from '@dsh-rp/workflow-router'
import type {} from '@dsh-rp/outbox'
import type {} from '@dsh-rp/projection'
import type {} from '@dsh-rp/rules'
import type {} from '@dsh-rp/media'
import type {} from '@dsh-rp/memory-basic'
import type {} from '@dsh-rp/policy'
import type {} from '@dsh-rp/turn-runtime'
import type {} from '@dsh-rp/ui-slot-runtime'
import { importCharacterCard, importCharacterCardCharx, importCharacterCardPng, importChat, importPersona, importPreset, importWorldInfo } from '@dsh-rp/compat-sillytavern'
import type { SillyTavernPresetIR } from '@dsh-rp/compat-sillytavern'
import type { RpPromptPresetRecord } from '@dsh-rp/preset'
import type {} from '@dsh-rp/preset'
import type { RpLibraryAssetKind, RpLibrarySaveBundle } from '@dsh-rp/library'
import type {} from '@dsh-rp/library'
import type { CharacterIR, CompatibilityLossReport, JsonObject, JsonValue, LoreIR, PersonaIR } from '@dsh-rp/contracts'
import type {
  RpWebCatalog,
  RpWebImportRequest,
  RpWebImportResponse,
  RpWebLibraryAssetDetailResponse,
  RpWebLibraryCatalogResponse,
  RpWebLibraryMutationRequest,
  RpWebLibraryMutationResponse,
  RpWebPresetCatalogResponse,
  RpWebPresetDetailResponse,
  RpWebPresetMutationResponse,
  RpWebRegistryInstallationSummary,
  RpWebRegistryMutationResponse,
  RpWebTimelineRequest,
  RpWebTimelineResponse,
  RpWebTurnErrorResponse,
} from './types.ts'
import {
  createRpTurnExecutor,
  RpWebTurnError,
} from './turn-api.ts'
import type { RpWebTurnApiConfig } from './turn-api.ts'
export type * from './types.ts'
export * from './turn-api.ts'
export const name = 'rp-web'
export const inject = [
  'httpServer',
  'rpComponents',
  'rpCapabilities',
  'rpPipelines',
  'rpExperiences',
  'rpRegistry',
  'rpWorkflowRouter',
  'rpOutbox',
  'sessions',
  'rpProjection',
  'rpRules',
  'rpMedia',
  'rpMemory',
  'rpPolicy',
  'rpUiSlots',
  'agents',
  'rpTurn',
]
const API_PATH = '/api/rp/v1'
const MAX_REQUEST_BYTES = 90 * 1024 * 1024
const MAX_INSPECT_REQUEST_BYTES = 16 * 1024
const FIRST_PARTY_EXPERIENCES = [
  'rp-adaptive', 'rp-fast', 'rp-directed', 'rp-multi-character', 'rp-world-sim',
  'rp-trpg', 'rp-companion', 'rp-creator', 'rp-premium',
] as const

/** Web Studio and shared Headless Turn entrypoint configuration. */
export interface Config {
  /** Shared remote/in-process Turn admission and authority ceiling. */
  readonly turnApi?: {
    /** Whether admitted calls may execute; defaults to true. */
    readonly enabled?: boolean
    /** Experience used when the request omits one; defaults to `rp-adaptive`. */
    readonly defaultExperience?: string
    /** Complete deployment allowlist for request-selected Experiences. */
    readonly allowedExperiences?: string[]
    /** Permission ceiling intersected with registered policy layers. */
    readonly permissions?: string[]
    /** Maximum native execution trust admitted at this transport. */
    readonly maxTrust?: 'L0' | 'L1' | 'L2'
    /** Component capability grants available during composition resolution. */
    readonly grantedCapabilities?: string[]
    /** Positive per-Turn ceilings; omitted fields use the documented defaults. */
    readonly budget?: {
      /** Wall-clock execution timeout in milliseconds. */
      readonly timeoutMs?: number
      /** Maximum aggregate model token budget. */
      readonly maxTokens?: number
      /** Maximum Tool invocations. */
      readonly maxToolCalls?: number
      /** Maximum delegated Agent count. */
      readonly maxAgents?: number
      /** Optional maximum provider cost in US dollars. */
      readonly maxCostUsd?: number
    }
    /** Exact network domain grants; empty by default. */
    readonly networkDomains?: string[]
    /** Exact filesystem root grants; empty by default. */
    readonly fileRoots?: string[]
    /** Deployment secret required on every non-loopback listener. */
    readonly bearerToken?: string
    /** Maximum accepted HTTP JSON body size; defaults to 256 KiB. */
    readonly maxRequestBytes?: number
  }
}

/** Strict deployment schema; request payloads never get to mutate these fields. */
export const Config: z<Config> = z.object({
  turnApi: z.object({
    enabled: z.boolean().default(true),
    defaultExperience: z.string().default('rp-adaptive'),
    allowedExperiences: z.array(z.string()).default([...FIRST_PARTY_EXPERIENCES]),
    permissions: z.array(z.string()).default(['rp.pipeline.execute', 'agent:spawn']),
    maxTrust: z.union([z.const('L0'), z.const('L1'), z.const('L2')]).default('L2'),
    grantedCapabilities: z.array(z.string()).default([]),
    budget: z.object({
      timeoutMs: z.number().step(1).min(1).max(300_000).default(60_000),
      maxTokens: z.number().step(1).min(1).max(1_000_000).default(128_000),
      maxToolCalls: z.number().step(1).min(1).max(1_000).default(64),
      maxAgents: z.number().step(1).min(1).max(128).default(8),
      maxCostUsd: z.number().min(0.000001).max(10_000),
    }),
    networkDomains: z.array(z.string()).default([]),
    fileRoots: z.array(z.string()).default([]),
    bearerToken: z.string().role('secret'),
    maxRequestBytes: z.number().step(1).min(1_024).max(32 * 1024 * 1024).default(8 * 1024 * 1024),
  }),
})

/** Register catalog and Creator import routes. */
export function apply(ctx: Context, config: Config = {}): void {
  const turnApi = resolveTurnApiConfig(config.turnApi)
  if (turnApi.enabled && !isLoopbackHost(ctx.httpServer.host) && turnApi.bearerToken === undefined) {
    throw new Error('rp-web turnApi.bearerToken is required when WebServer is not bound to a loopback host')
  }
  const executeTurn = createRpTurnExecutor(ctx, turnApi)
  ctx.effect(function* () {
    yield ctx.httpServer.register({
      kind: 'prefix',
      path: `${API_PATH}/ui`,
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          json(res, 405, { error: 'method-not-allowed' })
          return
        }
        const response = resolveUiResource(ctx, req.url ?? '/', uiResourceOrigins(req))
        res.writeHead(response.status, response.headers)
        res.end(req.method === 'HEAD' ? undefined : response.body)
      },
    })
    yield ctx.httpServer.register({
      kind: 'exact',
      path: `${API_PATH}/turn`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'method-not-allowed' } })
          return
        }
        const controller = new AbortController()
        const onAbort = (): void => { controller.abort(new Error('RP Turn client disconnected')) }
        const onClose = (): void => { if (!res.writableEnded) onAbort() }
        req.once('aborted', onAbort)
        res.once('close', onClose)
        try {
          requireTrustedTurnRequest(ctx, req, turnApi)
          const body = await readTurnJson(req, turnApi.maxRequestBytes)
          json(res, 200, await executeTurn(body, controller.signal))
        } catch (error: unknown) {
          const rendered = publicTurnError(error)
          if (rendered.status >= 500) ctx.logger.warn(error instanceof Error ? error : new Error(renderError(error)))
          if (!res.headersSent && !res.destroyed) json(res, rendered.status, { error: rendered.error })
        } finally {
          req.off('aborted', onAbort)
          res.off('close', onClose)
        }
      },
    })
    yield ctx.httpServer.register({
      kind: 'exact',
      path: `${API_PATH}/catalog`,
      handler: (_req, res) => {
        json(res, 200, catalog(ctx))
      },
    })
    yield ctx.httpServer.register({
      kind: 'exact',
      path: `${API_PATH}/registry`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'method-not-allowed' })
          return
        }
        try {
          requireTrustedMutationRequest(req)
          const body = await readJson(req, MAX_INSPECT_REQUEST_BYTES)
          json(res, 200, await mutateRegistry(ctx, body))
        } catch (error: unknown) {
          json(res, 400, { error: renderError(error) })
        }
      },
    })
    yield ctx.httpServer.register({
      kind: 'exact',
      path: `${API_PATH}/timeline`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'method-not-allowed' })
          return
        }
        try {
          const body = await readJson(req, MAX_INSPECT_REQUEST_BYTES)
          json(res, 200, timeline(ctx, body as unknown as RpWebTimelineRequest))
        } catch (error: unknown) {
          json(res, 400, { error: renderError(error) })
        }
      },
    })
    yield ctx.httpServer.register({
      kind: 'exact',
      path: `${API_PATH}/presets`,
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            const url = new URL(req.url ?? `${API_PATH}/presets`, 'http://localhost')
            const sessionId = url.searchParams.get('sessionId') ?? undefined
            const presetId = url.searchParams.get('presetId') ?? undefined
            if (presetId !== undefined) {
              json(res, 200, presetDetail(ctx, presetId))
              return
            }
            json(res, 200, presetCatalog(ctx, sessionId))
            return
          }
          if (req.method !== 'POST') {
            json(res, 405, { error: 'method-not-allowed' })
            return
          }
          requireTrustedMutationRequest(req)
          const body = await readJson(req)
          json(res, 200, await mutatePreset(ctx, body))
        } catch (error: unknown) {
          json(res, 400, { error: renderError(error) })
        }
      },
    })
    yield ctx.httpServer.register({
      kind: 'exact',
      path: `${API_PATH}/library`,
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            const url = new URL(req.url ?? `${API_PATH}/library`, 'http://localhost')
            const sessionId = url.searchParams.get('sessionId') ?? undefined
            const assetKind = url.searchParams.get('assetKind') ?? undefined
            const assetId = url.searchParams.get('assetId') ?? undefined
            if (assetKind !== undefined || assetId !== undefined) {
              if (assetKind === undefined || assetId === undefined) {
                throw new Error('library detail requires assetKind and assetId')
              }
              json(res, 200, libraryAssetDetail(ctx, assetKind, assetId))
              return
            }
            json(res, 200, libraryCatalog(ctx, sessionId))
            return
          }
          if (req.method !== 'POST') {
            json(res, 405, { error: 'method-not-allowed' })
            return
          }
          requireTrustedMutationRequest(req)
          const body = await readJson(req)
          json(res, 200, await mutateLibrary(ctx, body))
        } catch (error: unknown) {
          json(res, 400, { error: renderError(error) })
        }
      },
    })
    yield ctx.httpServer.register({
      kind: 'exact',
      path: `${API_PATH}/import`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'method-not-allowed' })
          return
        }
        try {
          const body = await readJson(req)
          json(res, 200, importPayload(body as unknown as RpWebImportRequest))
        } catch (error: unknown) {
          json(res, 400, { error: renderError(error) })
        }
      },
    })
  }, 'rp-web routes')
}

/**
 * Build one replay-backed RP timeline for a live Session.
 * @param ctx - Host Context owning the live Session and RP Projection service.
 * @param request - Session identity to inspect.
 * @returns Detached RP events and their replayed projection.
 */
export function timeline(ctx: Context, request: RpWebTimelineRequest): RpWebTimelineResponse {
  if (typeof request.sessionId !== 'string'
    || request.sessionId.trim() === ''
    || request.sessionId.length > 512) {
    throw new Error('timeline requires a non-empty sessionId of at most 512 characters')
  }
  const session = ctx.sessions.get(SessionId(request.sessionId))
  if (session === undefined) throw new Error(`session ${JSON.stringify(request.sessionId)} is not live`)
  const events = session.events
    .filter(event => event.type.startsWith('rp/'))
    .map(event => Object.freeze({
      seq: event.seq,
      time: event.time,
      type: event.type,
      data: structuredClone(event.data) as unknown as JsonValue,
    }))
  return Object.freeze({
    sessionId: request.sessionId,
    events: Object.freeze(events),
    projection: ctx.rpProjection.project(session) as unknown as JsonValue,
  })
}

/**
 * Build a detached catalog snapshot suitable for Web and Headless clients.
 * @param ctx - Context containing the mounted RP registries.
 * @returns Detached read-only catalog projection.
 */
export function catalog(ctx: Context): RpWebCatalog {
  const activePackages = new Map(ctx.rpRegistry.listActivePackages().map(item => [item.id, item]))
  const installationStore = ctx.rpRegistry.getInstallationStore()
  const artifactStore = ctx.rpRegistry.getArtifactStore()
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: Date.now(),
    experiences: ctx.rpExperiences.list(),
    components: ctx.rpComponents.list().map(component => ({
      id: String(component.id),
      version: component.version,
      trust: component.trust,
      scopes: [...component.scopes],
      provides: [...component.provides ?? []],
    })),
    capabilities: ctx.rpCapabilities.list().map(capability => ({
      id: String(capability.id),
      kind: capability.kind,
      version: capability.version,
      title: capability.title,
      trust: capability.trust,
      scopes: [...capability.scopes],
      permissions: [...capability.permissions ?? []],
      executable: isExecutableCapability(ctx, capability.id),
    })),
    capabilityAuthorizers: ctx.rpCapabilities.listAuthorizers().map(authorizer => ({
      id: authorizer.id,
      priority: authorizer.priority ?? 0,
    })),
    policyLayers: ctx.rpPolicy.list().map(layer => ({
      name: layer.name,
      ...(layer.permissions === undefined ? {} : { permissions: [...layer.permissions] }),
      ...(layer.maxTrust === undefined ? {} : { maxTrust: layer.maxTrust }),
      ...(layer.budget === undefined ? {} : { budget: { ...layer.budget } }),
      ...(layer.networkDomains === undefined ? {} : { networkDomains: [...layer.networkDomains] }),
      ...(layer.fileRoots === undefined ? {} : { fileRoots: [...layer.fileRoots] }),
    })),
    pipelines: ctx.rpPipelines.list().map((pipeline) => {
      const snapshot = ctx.rpPipelines.snapshot(pipeline.id)
      return {
        id: String(pipeline.id),
        kind: pipeline.kind,
        version: pipeline.version,
        description: pipeline.description,
        trust: pipeline.trust,
        permissions: [...pipeline.permissions],
        hash: snapshot.hash,
        levels: snapshot.levels,
      }
    }),
    workflowBackends: ctx.rpWorkflowRouter.list().map(backend => ({
      id: backend.id,
      kind: backend.kind,
      trust: backend.trust,
      priority: backend.priority ?? 0,
      kinds: [...backend.kinds],
    })),
    ruleSystems: ctx.rpRules.list().map(system => ({
      id: String(system.id),
      version: system.version,
      title: system.title,
    })),
    mediaProviders: ctx.rpMedia.list().map(provider => ({
      id: String(provider.id),
      version: provider.version,
      title: provider.title,
      trust: provider.trust,
      kinds: [...provider.kinds],
      permissions: [...provider.permissions ?? []],
    })),
    mediaInputAdapters: ctx.rpMedia.listInputAdapters().map(adapter => ({
      id: adapter.id,
      version: adapter.version,
      title: adapter.title,
      trust: adapter.trust,
      permissions: [...adapter.permissions ?? []],
    })),
    memoryRetrievers: ctx.rpMemory.listRetrievers().map(retriever => ({
      id: retriever.id,
      version: retriever.version,
      title: retriever.title,
      priority: retriever.priority ?? 0,
    })),
    memoryStores: ctx.rpMemory.listStores().map(store => ({
      id: store.id,
      version: store.version,
      title: store.title,
      priority: store.priority ?? 0,
    })),
    uiSlots: ctx.rpUiSlots.list().map(slot => ({
      packageId: String(slot.packageId),
      packageVersion: slot.packageVersion,
      id: slot.id,
      title: slot.title,
      placement: slot.placement,
      trust: slot.trust,
      script: slot.script,
      height: slot.height ?? 320,
      entryUrl: uiSlotResourceUrl(String(slot.packageId), slot.id, slot.entry, slot.packageVersion),
    })),
    registryReleases: ctx.rpRegistry.list().map(release => ({
      id: String(release.manifest.id),
      version: release.manifest.version,
      trust: release.manifest.trust,
      sourceKind: release.source.kind,
      manifestHash: release.manifestHash,
      revoked: ctx.rpRegistry.isRevoked(String(release.manifest.id), release.manifest.version),
      ...(release.manifest.integrity?.sha256 === undefined ? {} : { payloadSha256: release.manifest.integrity.sha256 }),
      ...(release.manifest.integrity?.keyId === undefined ? {} : { signingKeyId: release.manifest.integrity.keyId }),
      signed: release.manifest.integrity?.signature !== undefined,
      signingKeyRevoked: release.manifest.integrity?.keyId === undefined
        ? false
        : ctx.rpRegistry.isSigningKeyRevoked(release.manifest.integrity.keyId),
      ...(release.manifest.integrity?.sbom === undefined ? {} : { sbomSha256: release.manifest.integrity.sbom }),
      evidenceVerified: release.evidenceVerified,
      permissions: [...release.manifest.permissions ?? []],
      networkDomains: [...release.manifest.networkDomains ?? []],
      fileRoots: [...release.manifest.fileRoots ?? []],
      sourceLocator: release.source.locator,
      ...(release.source.ref === undefined ? {} : { sourceRef: release.source.ref }),
    })),
    registryInstallations: ctx.rpRegistry.listInstallations()
      .map(installation => projectInstallation(ctx, installation, activePackages)),
    registryLifecycleAdapters: ctx.rpRegistry.listLifecycleAdapters().map(adapter => ({
      id: adapter.id,
      priority: adapter.priority ?? 0,
    })),
    registrySourceProviders: ctx.rpRegistry.listSourceProviders(),
    registrySecurityPolicies: ctx.rpRegistry.listSecurityPolicies().map(policy => ({
      id: policy.id,
      appliesTo: [...policy.appliesTo ?? ['L0', 'L1', 'L2']],
      requirePayloadIntegrity: policy.requirePayloadIntegrity ?? false,
      requireSignature: policy.requireSignature ?? false,
      requireSbom: policy.requireSbom ?? false,
    })),
    ...(installationStore === undefined ? {} : { registryInstallationStore: installationStore }),
    ...(artifactStore === undefined ? {} : { registryArtifactStore: artifactStore }),
    outbox: {
      pending: ctx.rpOutbox.list('pending').length,
      running: ctx.rpOutbox.list('running').length,
      completed: ctx.rpOutbox.list('completed').length,
      failed: ctx.rpOutbox.list('failed').length,
    },
  })
}

/** Detached HTTP response used by both the WebServer adapter and security tests. */
export interface RpUiResourceResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string | number>>
  readonly body: Uint8Array
}

/**
 * Build a version-addressed package resource URL without admitting path syntax from ids.
 * @param packageId - Owning package id.
 * @param slotId - Package-local Slot id.
 * @param path - Exact declared resource path.
 * @param version - Exact package version used as the cache address.
 * @returns Host-relative URL for the live package resource.
 */
export function uiSlotResourceUrl(packageId: string, slotId: string, path: string, version: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `${API_PATH}/ui/${encodeURIComponent(packageId)}/${encodeURIComponent(slotId)}/${encodedPath}?v=${encodeURIComponent(version)}`
}

/**
 * Resolve one live package UI resource and apply a non-weakenable response-header sandbox.
 * @param ctx - Host Context containing the injected RP UI registry.
 * @param requestUrl - Absolute or Host-relative resource request URL.
 * @param resourceOrigins - Allowed HTTP origins; each remains restricted to this package and Slot path.
 * @returns Detached response with sandbox headers and either the resource or a stable error body.
 */
export function resolveUiResource(
  ctx: Context,
  requestUrl: string,
  resourceOrigins: readonly string[] = [],
): RpUiResourceResponse {
  const notFound = (): RpUiResourceResponse => response(404, 'text/plain; charset=utf-8', new TextEncoder().encode('not found'))
  let pathname: string
  try { pathname = new URL(requestUrl, 'http://rp.invalid').pathname }
  catch { return response(400, 'text/plain; charset=utf-8', new TextEncoder().encode('bad request')) }
  const prefix = `${API_PATH}/ui/`
  if (!pathname.startsWith(prefix)) return notFound()
  const raw = pathname.slice(prefix.length).split('/')
  if (raw.length < 3) return notFound()
  let parts: string[]
  try { parts = raw.map(part => decodeURIComponent(part)) }
  catch { return response(400, 'text/plain; charset=utf-8', new TextEncoder().encode('bad request')) }
  const packageId = parts[0]
  const slotId = parts[1]
  const path = parts.slice(2).join('/')
  if (packageId === undefined || slotId === undefined || packageId === '' || slotId === '' || path === '') return notFound()
  const slot = ctx.rpUiSlots.get(packageId, slotId)
  if (slot === undefined || !slot.assets.includes(path)) return notFound()
  let body: Uint8Array | undefined
  try { body = ctx.rpUiSlots.resource(packageId, slotId, path) }
  catch { return notFound() }
  if (body === undefined) return notFound()
  const resourcePath = `${API_PATH}/ui/${encodeURIComponent(packageId)}/${encodeURIComponent(slotId)}/`
  const sources = resourceOrigins.map(origin => `${origin}${resourcePath}`)
  return response(200, mimeType(path), body, contentSecurityPolicy(sources))
}

function response(
  status: number,
  contentType: string,
  body: Uint8Array,
  csp = "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'",
): RpUiResourceResponse {
  return Object.freeze({
    status,
    headers: Object.freeze({
      'content-type': contentType,
      'content-length': body.byteLength,
      'cache-control': 'no-store',
      'content-security-policy': csp,
      'cross-origin-opener-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
    }),
    body: body.slice(),
  })
}

function contentSecurityPolicy(resourceSources: readonly string[]): string {
  const resources = resourceSources.length === 0 ? "'none'" : resourceSources.join(' ')
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    `style-src ${resources} 'unsafe-inline'`,
    `img-src ${resources}`,
    `font-src ${resources}`,
    `media-src ${resources}`,
    "script-src 'none'",
  ].join('; ')
}

function uiResourceOrigins(req: IncomingMessage): readonly string[] {
  const host = req.headers.host
  if (host === undefined || host.length > 255 || /[\u0000-\u0020\u007f]/u.test(host)) return Object.freeze([])
  try {
    const parsed = new URL(`http://${host}`)
    if (parsed.host !== host || parsed.pathname !== '/' || parsed.username !== '' || parsed.password !== '') return Object.freeze([])
  } catch { return Object.freeze([]) }
  return Object.freeze([`http://${host}`, `https://${host}`])
}

function mimeType(path: string): string {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  return MIME_TYPES[extension] ?? 'application/octet-stream'
}

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
})

/**
 * Execute one validated Host-owned Registry mutation.
 * @param ctx - Context owning the Registry transaction service.
 * @param request - Untrusted mutation request from a local or remote client.
 * @returns Detached committed installation state.
 */
export async function mutateRegistry(
  ctx: Context,
  request: unknown,
): Promise<RpWebRegistryMutationResponse> {
  if (!isRecord(request)
    || (request.action !== 'install' && request.action !== 'update' && request.action !== 'uninstall')) {
    throw new Error('registry action must be install, update, or uninstall')
  }
  if (request.action === 'uninstall') {
    const rootId = boundedString(request.rootId, 'rootId', 256)
    const removed = await ctx.rpRegistry.uninstall(rootId)
    return Object.freeze({
      schemaVersion: 1,
      action: 'uninstall',
      rootId,
      graphHash: removed.lock.graphHash,
      installed: false,
    })
  }
  const source = parseRpPackageSource(boundedString(request.source, 'source', 2048))
  const lock = request.action === 'install'
    ? await ctx.rpRegistry.install(source)
    : await ctx.rpRegistry.update(source)
  const rootEntry = lock.packages.at(-1)
  if (rootEntry === undefined) throw new Error('registry returned an empty lock graph')
  const installation = ctx.rpRegistry.listInstallations().find(item => item.rootId === rootEntry.id)
  if (installation === undefined) throw new Error(`registry installation ${rootEntry.id} disappeared after commit`)
  return Object.freeze({
    schemaVersion: 1,
    action: request.action,
    rootId: installation.rootId,
    graphHash: lock.graphHash,
    installed: true,
    installation: projectInstallation(ctx, installation),
  })
}

function projectInstallation(
  ctx: Context,
  installation: RpPackageInstallation,
  active = new Map(ctx.rpRegistry.listActivePackages().map(item => [item.id, item])),
): RpWebRegistryInstallationSummary {
  const root = installation.lock.packages.at(-1)
  if (root === undefined) throw new Error(`installation ${installation.rootId} has an empty lock graph`)
  return Object.freeze({
    rootId: installation.rootId,
    rootVersion: root.version,
    sourceKind: installation.source.kind,
    sourceLocator: installation.source.locator,
    ...(installation.source.ref === undefined ? {} : { sourceRef: installation.source.ref }),
    graphHash: installation.lock.graphHash,
    installedAt: installation.installedAt,
    updatedAt: installation.updatedAt,
    packages: Object.freeze(installation.lock.packages.map((entry) => {
      const release = ctx.rpRegistry.list(entry.id).find(item => item.manifest.version === entry.version)
      if (release === undefined) throw new Error(`installed release ${entry.id}@${entry.version} is unavailable`)
      const runtime = active.get(entry.id)
      return Object.freeze({
        id: entry.id,
        version: entry.version,
        trust: release.manifest.trust,
        manifestHash: entry.manifestHash,
        evidenceVerified: entry.evidenceVerified,
        revoked: ctx.rpRegistry.isRevoked(entry.id, entry.version),
        runtimeActive: runtime?.runtimeActive ?? false,
        owners: Object.freeze([...(runtime?.owners ?? [])]),
        ...(runtime?.lifecycleAdapterId === undefined ? {} : { lifecycleAdapterId: runtime.lifecycleAdapterId }),
        permissions: Object.freeze([...release.manifest.permissions ?? []]),
        networkDomains: Object.freeze([...release.manifest.networkDomains ?? []]),
        fileRoots: Object.freeze([...release.manifest.fileRoots ?? []]),
        ...(entry.payloadSha256 === undefined ? {} : { payloadSha256: entry.payloadSha256 }),
        ...(entry.signingKeyId === undefined ? {} : { signingKeyId: entry.signingKeyId }),
        signingKeyRevoked: entry.signingKeyId === undefined
          ? false
          : ctx.rpRegistry.isSigningKeyRevoked(entry.signingKeyId),
        ...(entry.sbomSha256 === undefined ? {} : { sbomSha256: entry.sbomSha256 }),
      })
    })),
  })
}

function isExecutableCapability(
  ctx: Context,
  id: Parameters<Context['rpCapabilities']['get']>[0],
): boolean {
  return ctx.rpCapabilities.isExecutable(id)
}

/**
 * Import one Creator payload and collect path-addressed compatibility reports.
 * @param request - Text or canonical-base64 import request.
 * @returns Normalized IR plus detached compatibility reports.
 */
export function importPayload(request: RpWebImportRequest): RpWebImportResponse {
  if (!isImportKind(request.kind)) throw new Error('Unknown RP import kind')
  const options = {
    ...(request.sourceId === undefined ? {} : { sourceId: request.sourceId }),
    importedAt: Date.now(),
  }
  let result: JsonValue
  if (request.kind === 'character-card-json') {
    result = importCharacterCard(requiredSource(request), options) as unknown as JsonValue
  } else if (request.kind === 'persona') {
    result = importPersona(requiredSource(request), options) as unknown as JsonValue
  } else if (request.kind === 'world-info') {
    result = importWorldInfo(requiredSource(request), options) as unknown as JsonValue
  } else if (request.kind === 'preset') {
    result = importPreset(requiredSource(request), options) as unknown as JsonValue
  } else if (request.kind === 'chat') {
    result = importChat(requiredSource(request), options) as unknown as JsonValue
  } else if (request.kind === 'character-card-png') {
    result = importCharacterCardPng(requiredBytes(request), options) as unknown as JsonValue
  } else {
    result = importCharacterCardCharx(requiredBytes(request), options) as unknown as JsonValue
  }
  return { kind: request.kind, result, lossReports: collectLossReports(result) }
}

/**
 * Project saved RP assets and the active selection for one optional conversation identity.
 * @param ctx - Host Context owning the Library.
 * @param sessionId - Optional conversation identity.
 * @returns Detached library summaries and active snapshot identity.
 */
export function libraryCatalog(ctx: Context, sessionId?: string): RpWebLibraryCatalogResponse {
  const library = requireLibraryRuntime(ctx)
  const scope = sessionId === undefined ? undefined : conversationScope(sessionId)
  const active = scope === undefined ? undefined : library.capture(scope)
  return Object.freeze({
    schemaVersion: 1,
    ...(sessionId === undefined ? {} : { sessionId }),
    characters: Object.freeze(library.listCharacters().map(record => Object.freeze({
      id: record.asset.id,
      name: record.asset.name,
      ...(record.asset.description === undefined ? {} : { description: record.asset.description }),
      savedAt: record.savedAt,
    }))),
    personas: Object.freeze(library.listPersonas().map(record => Object.freeze({
      id: record.asset.id, name: record.asset.name, description: record.asset.description, savedAt: record.savedAt,
    }))),
    lorebooks: Object.freeze(library.listLorebooks().map(record => Object.freeze({
      id: record.asset.id, name: record.asset.name, entryCount: record.asset.entries.length, savedAt: record.savedAt,
    }))),
    ...(active === undefined ? {} : { active: Object.freeze({
      snapshotHash: active.snapshotHash,
      characterIds: Object.freeze(active.characters.map(asset => asset.id)),
      personaIds: Object.freeze(active.personas.map(asset => asset.id)),
      lorebookIds: Object.freeze(active.lorebooks.map(asset => asset.id)),
    }) }),
  })
}

/** Load one full normalized library asset for the browser editor. */
export function libraryAssetDetail(
  ctx: Context,
  assetKindValue: unknown,
  assetIdValue: unknown,
): RpWebLibraryAssetDetailResponse {
  const library = requireLibraryRuntime(ctx)
  const assetKind = libraryAssetKind(assetKindValue)
  const assetId = boundedString(assetIdValue, 'assetId', 512)
  const records = assetKind === 'character' ? library.listCharacters()
    : assetKind === 'persona' ? library.listPersonas() : library.listLorebooks()
  const record = records.find(item => item.asset.id === assetId)
  if (record === undefined) throw new Error(`RP ${assetKind} ${JSON.stringify(assetId)} is not saved`)
  return Object.freeze({
    schemaVersion: 1,
    assetKind,
    asset: structuredClone(record.asset),
    savedAt: record.savedAt,
  })
}

/**
 * Execute one bounded Creator asset-library mutation through the shared Host runtime.
 * @param ctx - Host Context owning the Library and Sessions.
 * @param request - Validated mutation-shaped input.
 * @returns Refreshed detached catalog and affected asset identities.
 */
export async function mutateLibrary(
  ctx: Context,
  request: unknown,
): Promise<RpWebLibraryMutationResponse> {
  const library = requireLibraryRuntime(ctx)
  if (!isRecord(request) || typeof request.action !== 'string') throw new Error('library action is required')
  if (request.action === 'save') {
    if (!isLibraryImportKind(request.kind)) throw new Error('Unknown RP library import kind')
    const sourceId = request.sourceId === undefined ? undefined : boundedString(request.sourceId, 'sourceId', 512)
    if (request.source !== undefined && typeof request.source !== 'string') throw new Error('library source must be text')
    if (request.base64 !== undefined && typeof request.base64 !== 'string') throw new Error('library base64 must be text')
    const importedAt = Date.now()
    const importRequest: RpWebImportRequest = {
      kind: request.kind,
      ...(request.source === undefined ? {} : { source: request.source }),
      ...(request.base64 === undefined ? {} : { base64: request.base64 }),
      ...(sourceId === undefined ? {} : { sourceId }),
    }
    const options = { ...(sourceId === undefined ? {} : { sourceId }), importedAt }
    let bundle: RpLibrarySaveBundle
    if (request.kind === 'character-card-json') {
      const value = importCharacterCard(requiredSource(importRequest), options)
      bundle = { characters: [value.character], ...(value.lore === undefined ? {} : { lorebooks: [value.lore] }) }
    } else if (request.kind === 'character-card-png') {
      const value = importCharacterCardPng(requiredBytes(importRequest), options)
      bundle = { characters: [value.character], ...(value.lore === undefined ? {} : { lorebooks: [value.lore] }) }
    } else if (request.kind === 'character-card-charx') {
      const value = importCharacterCardCharx(requiredBytes(importRequest), options)
      bundle = { characters: [value.character], ...(value.lore === undefined ? {} : { lorebooks: [value.lore] }) }
    } else if (request.kind === 'persona') {
      bundle = { personas: [importPersona(requiredSource(importRequest), options)] }
    } else {
      bundle = { lorebooks: [importWorldInfo(requiredSource(importRequest), options)] }
    }
    const saved = await library.saveBundle(bundle)
    const assetIds = Object.freeze([
      ...saved.characters.map(record => record.asset.id),
      ...saved.personas.map(record => record.asset.id),
      ...saved.lorebooks.map(record => record.asset.id),
    ])
    return Object.freeze({ ...libraryCatalog(ctx), action: 'save', assetIds })
  }
  if (request.action === 'update') {
    const sessionId = boundedString(request.sessionId, 'sessionId', 512)
    const assetKind = libraryAssetKind(request.assetKind)
    const assetId = boundedString(request.assetId, 'assetId', 512)
    if (!isRecord(request.asset) || request.asset.id !== assetId) {
      throw new Error('library update asset id must match assetId')
    }
    const asset = structuredClone(request.asset)
    if (assetKind === 'character') await library.saveCharacter(asset as unknown as CharacterIR)
    else if (assetKind === 'persona') await library.savePersona(asset as unknown as PersonaIR)
    else await library.saveLore(asset as unknown as LoreIR)
    return Object.freeze({ ...libraryCatalog(ctx, sessionId), action: 'update', assetIds: [assetId] })
  }
  if (request.action !== 'activate' && request.action !== 'deactivate' && request.action !== 'remove') {
    throw new Error('Unsupported RP library action')
  }
  const assetKind = libraryAssetKind(request.assetKind)
  const assetId = boundedString(request.assetId, 'assetId', 512)
  if (request.action === 'activate') {
    const sessionId = boundedString(request.sessionId, 'sessionId', 512)
    await library.activate(conversationScope(sessionId), assetKind, assetId)
    return Object.freeze({ ...libraryCatalog(ctx, sessionId), action: 'activate', assetIds: [assetId] })
  }
  if (request.action === 'deactivate') {
    const sessionId = boundedString(request.sessionId, 'sessionId', 512)
    await library.deactivate(conversationScope(sessionId), assetKind, assetId)
    return Object.freeze({ ...libraryCatalog(ctx, sessionId), action: 'deactivate', assetIds: [assetId] })
  }
  await library.remove(assetKind, assetId)
  return Object.freeze({ ...libraryCatalog(ctx), action: 'remove', assetIds: [assetId] })
}

/**
 * Project saved presets and the active binding for one optional conversation identity.
 * @param ctx - Host Context owning presets.
 * @param sessionId - Optional conversation identity.
 * @returns Detached preset summaries and active snapshot identity.
 */
export function presetCatalog(ctx: Context, sessionId?: string): RpWebPresetCatalogResponse {
  const presets = requirePresetRuntime(ctx)
  const scope = sessionId === undefined ? undefined : conversationScope(sessionId)
  const active = scope === undefined ? undefined : presets.capture(scope)
  return Object.freeze({
    schemaVersion: 1,
    ...(sessionId === undefined ? {} : { sessionId }),
    presets: Object.freeze(presets.list().map(preset => Object.freeze({
      id: preset.id,
      name: preset.name,
      selectedPromptOrderId: preset.selectedPromptOrderId,
      promptDefinitionCount: preset.promptDefinitions.length,
      promptOrderCount: preset.promptOrders.length,
      enabledPromptIds: Object.freeze(preset.prompts.map(item => item.id)),
      generation: structuredClone(preset.generation),
      savedAt: preset.savedAt,
    }))),
    ...(active === undefined ? {} : { active: Object.freeze({
      presetId: active.id,
      snapshotHash: active.snapshotHash,
      selectedPromptOrderId: active.selectedPromptOrderId,
      enabledPromptIds: Object.freeze(active.prompts.map(item => item.id)),
    }) }),
  })
}

/** Load one full normalized prompt preset for the browser editor. */
export function presetDetail(ctx: Context, presetIdValue: unknown): RpWebPresetDetailResponse {
  const presetId = boundedString(presetIdValue, 'presetId', 512)
  const preset = requirePresetRuntime(ctx).get(presetId)
  if (preset === undefined) throw new Error(`RP preset ${JSON.stringify(presetId)} is not saved`)
  return Object.freeze({ schemaVersion: 1, preset: structuredClone(preset) })
}

/**
 * Validate and apply one Creator preset mutation at the Host boundary.
 * @param ctx - Host Context owning presets.
 * @param request - Untrusted decoded JSON request.
 * @returns Refreshed durable preset catalog.
 */
export async function mutatePreset(
  ctx: Context,
  request: unknown,
): Promise<RpWebPresetMutationResponse> {
  const presets = requirePresetRuntime(ctx)
  if (!isRecord(request) || typeof request.action !== 'string') throw new Error('preset action is required')
  if (!['save', 'update', 'activate', 'deactivate', 'remove'].includes(request.action)) {
    throw new Error(`unsupported preset action ${JSON.stringify(request.action)}`)
  }
  if (request.action === 'save') {
    if (typeof request.source !== 'string') throw new Error('preset save requires source text')
    const imported = importPreset(request.source, {
      ...(request.sourceId === undefined ? {} : { sourceId: boundedString(request.sourceId, 'sourceId', 512) }),
      importedAt: Date.now(),
    })
    const stored = await presets.save(toPresetRecord(imported))
    return Object.freeze({ ...presetCatalog(ctx), action: 'save', presetId: stored.id })
  }
  if (request.action === 'update') {
    const sessionId = boundedString(request.sessionId, 'sessionId', 512)
    const presetId = boundedString(request.presetId, 'presetId', 512)
    if (!isRecord(request.preset) || request.preset.id !== presetId) {
      throw new Error('preset update id must match presetId')
    }
    const stored = await presets.save({
      ...structuredClone(request.preset) as unknown as RpPromptPresetRecord,
      schemaVersion: 1,
      id: presetId,
      savedAt: Date.now(),
    })
    return Object.freeze({ ...presetCatalog(ctx, sessionId), action: 'update', presetId: stored.id })
  }
  if (request.action === 'activate') {
    const sessionId = boundedString(request.sessionId, 'sessionId', 512)
    const presetId = boundedString(request.presetId, 'presetId', 512)
    await presets.activate(conversationScope(sessionId), presetId)
    return Object.freeze({ ...presetCatalog(ctx, sessionId), action: 'activate', presetId })
  }
  if (request.action === 'deactivate') {
    const sessionId = boundedString(request.sessionId, 'sessionId', 512)
    await presets.deactivate(conversationScope(sessionId))
    return Object.freeze({ ...presetCatalog(ctx, sessionId), action: 'deactivate' })
  }
  const presetId = boundedString(request.presetId, 'presetId', 512)
  await presets.remove(presetId)
  return Object.freeze({ ...presetCatalog(ctx), action: 'remove', presetId })
}

function toPresetRecord(imported: SillyTavernPresetIR): RpPromptPresetRecord {
  return Object.freeze({
    schemaVersion: 1,
    id: imported.id,
    name: imported.name,
    promptDefinitions: Object.freeze(imported.promptDefinitions.map(definition => Object.freeze({
      schemaVersion: 1 as const,
      id: definition.id,
      name: definition.name,
      role: definition.role,
      content: definition.content,
      marker: definition.marker,
    }))),
    promptOrders: imported.promptOrders.map(order => Object.freeze({
      id: order.id,
      entries: order.entries,
    })),
    selectedPromptOrderId: imported.selectedPromptOrderId,
    prompts: imported.prompts,
    generation: imported.generation,
    compatibility: imported.compatibility,
    savedAt: Date.now(),
  })
}

/**
 * Normalize a durable conversation owner before or after its live Agent Session exists.
 * Turn execution remains responsible for requiring the matching live Session.
 */
function conversationScope(sessionId: string): { readonly kind: 'conversation'; readonly id: string } {
  if (sessionId.trim() === '' || sessionId !== sessionId.trim() || sessionId.length > 512) {
    throw new Error('sessionId must be a normalized non-empty string of at most 512 characters')
  }
  return Object.freeze({ kind: 'conversation', id: sessionId })
}

function requirePresetRuntime(ctx: Context): Context['rpPresets'] {
  const presets = ctx.get('rpPresets')
  if (presets === undefined) throw new Error('RP preset plugin is not installed')
  return presets
}

function requireLibraryRuntime(ctx: Context): Context['rpLibrary'] {
  const library = ctx.get('rpLibrary')
  if (library === undefined) throw new Error('RP library plugin is not installed')
  return library
}

function libraryAssetKind(value: unknown): RpLibraryAssetKind {
  if (value !== 'character' && value !== 'persona' && value !== 'lore') throw new Error('Unknown RP library asset kind')
  return value
}

function collectLossReports(value: JsonValue): RpWebImportResponse['lossReports'] {
  const reports: { path: string; report: CompatibilityLossReport }[] = []
  const visit = (current: JsonValue, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => { visit(item, `${path}[${index}]`) })
      return
    }
    if (!isJsonObject(current)) return
    if (isCompatibilityLossReport(current.lossReport)) {
      reports.push({ path: `${path}.lossReport`, report: structuredClone(current.lossReport) })
    }
    for (const [key, child] of Object.entries(current)) {
      if (key !== 'unknownFields' && key !== 'lossReport') visit(child, `${path}.${key}`)
    }
  }
  visit(value, '$')
  return Object.freeze(reports.map(item => Object.freeze(item)))
}

function isCompatibilityLossReport(value: JsonValue | undefined): value is JsonObject & CompatibilityLossReport {
  return isJsonObject(value)
    && value.schemaVersion === 1
    && typeof value.losslessData === 'boolean'
    && typeof value.executableBehaviorDisabled === 'boolean'
    && Array.isArray(value.items)
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maxLength} characters`)
  }
  return value.trim()
}

function requireTrustedMutationRequest(req: IncomingMessage): void {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new Error('cross-site registry mutations are forbidden')
  const origin = req.headers.origin
  const host = req.headers.host
  if (origin === undefined || host === undefined) return
  let originHost: string
  try { originHost = new URL(origin).host }
  catch (error: unknown) { throw new Error('registry mutation origin is invalid', { cause: error }) }
  if (originHost !== host) throw new Error('cross-origin registry mutations are forbidden')
}

function resolveTurnApiConfig(config: Config['turnApi']): RpWebTurnApiConfig {
  const budget = config?.budget ?? {}
  const defaultExperience = configValue(config?.defaultExperience ?? 'rp-adaptive', 'turnApi.defaultExperience')
  const allowedExperiences = configValues(
    config?.allowedExperiences ?? FIRST_PARTY_EXPERIENCES,
    'turnApi.allowedExperiences',
  )
  if (!allowedExperiences.includes(defaultExperience)) {
    throw new Error('rp-web turnApi.defaultExperience must appear in turnApi.allowedExperiences')
  }
  const bearerToken = config?.bearerToken
  if (bearerToken !== undefined && (bearerToken.length < 16 || bearerToken.length > 4_096)) {
    throw new Error('rp-web turnApi.bearerToken must contain between 16 and 4096 characters')
  }
  return Object.freeze({
    enabled: config?.enabled ?? true,
    defaultExperience,
    allowedExperiences,
    permissions: configValues(
      config?.permissions ?? ['rp.pipeline.execute', 'agent:spawn', 'attachment.write'],
      'turnApi.permissions',
    ),
    maxTrust: config?.maxTrust ?? 'L2',
    grantedCapabilities: configValues(config?.grantedCapabilities ?? [], 'turnApi.grantedCapabilities'),
    budget: Object.freeze({
      timeoutMs: budget.timeoutMs ?? 60_000,
      maxTokens: budget.maxTokens ?? 128_000,
      maxToolCalls: budget.maxToolCalls ?? 64,
      maxAgents: budget.maxAgents ?? 8,
      ...(budget.maxCostUsd === undefined ? {} : { maxCostUsd: budget.maxCostUsd }),
    }),
    networkDomains: configValues(config?.networkDomains ?? [], 'turnApi.networkDomains'),
    fileRoots: configValues(config?.fileRoots ?? [], 'turnApi.fileRoots'),
    ...(bearerToken === undefined ? {} : { bearerToken }),
    maxRequestBytes: config?.maxRequestBytes ?? 8 * 1024 * 1024,
  })
}

function requireTrustedTurnRequest(
  ctx: Context,
  req: IncomingMessage,
  config: RpWebTurnApiConfig,
): void {
  try { requireTrustedMutationRequest(req) }
  catch (error: unknown) {
    throw new RpWebTurnError('Cross-origin RP Turn requests are forbidden', 'ACCESS_DENIED', error)
  }
  if (!config.enabled) throw new RpWebTurnError('RP Turn API is disabled by deployment policy', 'ACCESS_DENIED')
  if (!isLoopbackHost(ctx.httpServer.host) && config.bearerToken === undefined) {
    throw new RpWebTurnError('RP Turn API requires a bearer token on a non-loopback WebServer', 'ACCESS_DENIED')
  }
  if (config.bearerToken === undefined) return
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')
    || !sameSecret(header.slice('Bearer '.length), config.bearerToken)) {
    throw new RpWebTurnError('A valid deployment bearer token is required', 'ACCESS_DENIED')
  }
}

function sameSecret(received: string, expected: string): boolean {
  const left = createHash('sha256').update(received).digest()
  const right = createHash('sha256').update(expected).digest()
  return timingSafeEqual(left, right)
}

function publicTurnError(error: unknown): {
  readonly status: number
  readonly error: RpWebTurnErrorResponse['error']
} {
  if (!(error instanceof RpWebTurnError)) {
    return { status: 500, error: { code: 'EXECUTION_FAILED', message: 'RP Turn execution failed before commit' } }
  }
  const status = error.code === 'INVALID_REQUEST' ? 400
    : error.code === 'ACCESS_DENIED' ? 403
      : error.code === 'NOT_FOUND' ? 404
        : error.code === 'CONFLICT' || error.code === 'BUSY' ? 409
          : error.code === 'CANCELLED' ? 499
            : error.code === 'DURABILITY' ? 503
              : 500
  return {
    status,
    error: {
      code: error.code,
      message: error.message,
      ...(error.code === 'DURABILITY' ? { retryWithSameRequestId: true } : {}),
    },
  }
}

async function readTurnJson(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  try {
    return await readJson(req, maxBytes)
  } catch (error: unknown) {
    throw new RpWebTurnError(renderError(error), 'INVALID_REQUEST', error)
  }
}

function configValues(values: readonly string[], field: string): readonly string[] {
  const result = values.map((value, index) => configValue(value, `${field}[${String(index)}]`))
  if (new Set(result).size !== result.length) throw new Error(`rp-web ${field} must not contain duplicates`)
  return Object.freeze(result)
}

function configValue(value: string, field: string): string {
  if (value.trim() === '' || value !== value.trim() || value.length > 512) {
    throw new Error(`rp-web ${field} must be a normalized non-empty string of at most 512 characters`)
  }
  return value
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  return normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.')
}

function requiredSource(request: RpWebImportRequest): string {
  if (typeof request.source !== 'string') throw new Error(`${request.kind} requires source text`)
  return request.source
}

function requiredBytes(request: RpWebImportRequest): Uint8Array {
  if (typeof request.base64 !== 'string'
    || request.base64.length === 0
    || request.base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/u.test(request.base64)) {
    throw new Error(`${request.kind} requires canonical base64`)
  }
  const bytes = Buffer.from(request.base64, 'base64')
  if (bytes.toString('base64') !== request.base64) {
    throw new Error(`${request.kind} requires canonical base64`)
  }
  return bytes
}

function isImportKind(value: unknown): value is RpWebImportRequest['kind'] {
  return typeof value === 'string' && [
    'character-card-json',
    'character-card-png',
    'character-card-charx',
    'persona',
    'world-info',
    'preset',
    'chat',
  ].includes(value)
}

function isLibraryImportKind(
  value: unknown,
): value is Extract<RpWebLibraryMutationRequest, { readonly action: 'save' }>['kind'] {
  return typeof value === 'string' && [
    'character-card-json', 'character-card-png', 'character-card-charx', 'persona', 'world-info',
  ].includes(value)
}

async function readJson(
  req: IncomingMessage,
  maxBytes: number = MAX_REQUEST_BYTES,
): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.toLocaleLowerCase().startsWith('application/json')) {
    throw new Error('content-type must be application/json')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > maxBytes) throw new Error(`request exceeds ${maxBytes} bytes`)
    chunks.push(bytes)
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error: unknown) {
    throw new Error('request is not valid JSON', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('request must be a JSON object')
  }
  return value as Record<string, unknown>
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function renderError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unrenderable error]'
  }
}
