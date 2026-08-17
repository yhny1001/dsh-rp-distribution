/** Pluggable RP media generation registry. @module @dsh-rp/media */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { RpMediaProviderId } from '@dsh-rp/contracts'
import type {
  JsonObject,
  MediaArtifact,
  RpModelMediaInput,
  RpMediaProviderId as MediaProviderId,
  RpTrustLevel,
} from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpMedia: RpMediaRuntime }
  interface Events {
    /**
     * A media Provider returned one validated artifact.
     * @param provider - Provider identity.
     * @param artifact - Frozen validated artifact.
     * @mode emit
     */
    'rp/media-provider-completed'(provider: MediaProviderId, artifact: MediaArtifact): void
    /**
     * One media-input Adapter entered or left the live registry.
     * @param adapterId - Exact changed Adapter identity.
     * @mode emit
     */
    'rp/media-input-adapter-changed'(adapterId: string): void
    /**
     * One bounded input batch became durable media artifacts.
     * @param adapterId - Adapter which admitted and stored the batch.
     * @param artifacts - Frozen artifacts containing no source bytes.
     * @mode emit
     */
    'rp/media-input-ingested'(adapterId: string, artifacts: readonly MediaArtifact[]): void
  }
}

/** One media generation request routed to a Provider. */
export interface RpMediaRequest {
  readonly kind: MediaArtifact['kind']
  readonly prompt: string
  readonly provider?: MediaProviderId
  readonly options?: JsonObject
}

/** Replaceable media Provider with declared authority metadata. */
export interface RpMediaProvider {
  readonly id: MediaProviderId
  readonly version: string
  readonly title: string
  readonly trust: RpTrustLevel
  readonly kinds: readonly MediaArtifact['kind'][]
  readonly permissions?: readonly string[]
  generate(request: RpMediaRequest, signal?: AbortSignal): Promise<MediaArtifact>
}

/** Read-only media Provider metadata exposed to catalogs and inspectors. */
export type RpMediaProviderDescriptor = Readonly<Pick<
  RpMediaProvider,
  'id' | 'version' | 'title' | 'trust' | 'kinds' | 'permissions'
>>

/** Byte-bearing input accepted only at the Host ingress boundary. */
export interface RpMediaInputRequest {
  readonly kind: MediaArtifact['kind']
  readonly mimeType: string
  readonly data: Uint8Array
  readonly name?: string
  /** Exact Adapter route when the caller intentionally pins one. */
  readonly adapter?: string
}

/** Byte-free descriptor used by deterministic Adapter matching. */
export type RpMediaInputDescriptor = Readonly<Omit<RpMediaInputRequest, 'data'>>

/** Effective authority already intersected by deployment and Agent policy. */
export interface RpMediaInputAuthority {
  readonly trust: RpTrustLevel
  readonly permissions: readonly string[]
}

/** Replaceable ingress and model-materialization Adapter. */
export interface RpMediaInputAdapter {
  readonly id: string
  readonly version: string
  readonly title: string
  readonly trust: RpTrustLevel
  readonly permissions?: readonly string[]
  /** Pure compatibility predicate; it never receives source bytes. */
  supports(input: RpMediaInputDescriptor): boolean
  /** Validate the whole batch before publishing its immutable artifacts. */
  ingest(inputs: readonly RpMediaInputRequest[], signal?: AbortSignal): Promise<readonly MediaArtifact[]>
  /** Resolve artifacts owned by this Adapter into model-visible immutable references. */
  modelInput(artifact: MediaArtifact): RpModelMediaInput | undefined
}

/** Inspector-safe media-input Adapter metadata. */
export type RpMediaInputAdapterDescriptor = Readonly<Pick<
  RpMediaInputAdapter,
  'id' | 'version' | 'title' | 'trust' | 'permissions'
>>

/** Stable media-ingress failure taxonomy. */
export class RpMediaInputError extends Error {
  constructor(
    message: string,
    readonly code: 'DUPLICATE' | 'INVALID' | 'MISSING' | 'DENIED' | 'ADAPTER' | 'OUTPUT',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'RpMediaInputError'
  }
}

/** Media Provider discovery, deterministic routing, and result validation. */
export class RpMediaRuntime extends Service {
  private readonly providers = new Map<MediaProviderId, RpMediaProvider>()
  private readonly inputAdapters = new Map<string, RpMediaInputAdapter>()
  constructor(ctx: Context) {
    super(ctx, 'rpMedia')
    ctx.effect(() => this.register(createSvgCardProvider()))
  }

  /**
   * Register one media Provider.
   * @param provider - Provider definition and executor.
   * @returns Idempotent registration disposer.
   */
  register(provider: RpMediaProvider): () => void {
    validateProvider(provider)
    if (this.providers.has(provider.id)) throw new Error(`RP media Provider ${JSON.stringify(provider.id)} already exists`)
    const stored = Object.freeze({
      ...provider,
      kinds: Object.freeze([...new Set(provider.kinds)]),
      ...(provider.permissions === undefined ? {} : { permissions: Object.freeze([...new Set(provider.permissions)]) }),
    })
    this.providers.set(stored.id, stored)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.providers.get(stored.id) === stored) this.providers.delete(stored.id)
    }
  }

  /**
   * List Provider metadata in deterministic order.
   * @returns Frozen Provider descriptors without executor functions.
   */
  list(): readonly RpMediaProviderDescriptor[] {
    return Object.freeze([...this.providers.values()]
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .map(provider => Object.freeze({
        id: provider.id,
        version: provider.version,
        title: provider.title,
        trust: provider.trust,
        kinds: provider.kinds,
        ...(provider.permissions === undefined ? {} : { permissions: provider.permissions }),
      })))
  }

  /**
   * Register one reversible media-input Adapter.
   * @param adapter - Ingress, storage, and model-materialization boundary.
   * @returns Idempotent exact-registration disposer.
   */
  registerInputAdapter(adapter: RpMediaInputAdapter): () => void {
    validateInputAdapter(adapter)
    if (this.inputAdapters.has(adapter.id)) {
      throw new RpMediaInputError(`RP media input Adapter ${JSON.stringify(adapter.id)} already exists`, 'DUPLICATE')
    }
    const stored = Object.freeze({
      ...adapter,
      ...(adapter.permissions === undefined
        ? {}
        : { permissions: Object.freeze([...new Set(adapter.permissions)]) }),
    })
    this.inputAdapters.set(stored.id, stored)
    this.ctx.emit('rp/media-input-adapter-changed', stored.id)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.inputAdapters.get(stored.id) !== stored) return
      this.inputAdapters.delete(stored.id)
      this.ctx.emit('rp/media-input-adapter-changed', stored.id)
    }
  }

  /**
   * List live input Adapters without executable functions.
   * @returns Frozen descriptors sorted by Adapter id.
   */
  listInputAdapters(): readonly RpMediaInputAdapterDescriptor[] {
    return Object.freeze([...this.inputAdapters.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(adapter => Object.freeze({
        id: adapter.id,
        version: adapter.version,
        title: adapter.title,
        trust: adapter.trust,
        ...(adapter.permissions === undefined ? {} : { permissions: adapter.permissions }),
      })))
  }

  /**
   * Ingest a byte-bearing batch through deterministic, authority-bounded Adapters.
   * Each Adapter receives its complete sub-batch so aggregate limits can be
   * validated before that Adapter publishes anything.
   * @param inputs - Ordered untrusted media inputs.
   * @param authority - Effective trust and permission ceilings.
   * @param signal - Optional cancellation signal.
   * @returns Ordered durable artifacts with source bytes removed.
   */
  async ingestInputs(
    inputs: readonly RpMediaInputRequest[],
    authority: RpMediaInputAuthority,
    signal?: AbortSignal,
  ): Promise<readonly MediaArtifact[]> {
    if (inputs.length === 0) return Object.freeze([])
    throwIfAborted(signal)
    const detached = inputs.map(detachInputRequest)
    const selected = detached.map(input => this.selectInputAdapter(input, authority))
    const groups = new Map<RpMediaInputAdapter, { indexes: number[]; inputs: RpMediaInputRequest[] }>()
    for (const [index, adapter] of selected.entries()) {
      const group = groups.get(adapter) ?? { indexes: [], inputs: [] }
      const input = detached[index]
      if (input === undefined) throw new RpMediaInputError('RP media input routing lost an input', 'OUTPUT')
      group.indexes.push(index)
      group.inputs.push(input)
      groups.set(adapter, group)
    }
    const artifacts: Array<MediaArtifact | undefined> = inputs.map(() => undefined)
    for (const [adapter, group] of [...groups].sort(([left], [right]) => left.id.localeCompare(right.id))) {
      throwIfAborted(signal)
      let output: readonly MediaArtifact[]
      try {
        output = await adapter.ingest(Object.freeze(group.inputs), signal)
      } catch (error: unknown) {
        throwIfAborted(signal)
        if (error instanceof RpMediaInputError) throw error
        throw new RpMediaInputError(
          `RP media input Adapter ${JSON.stringify(adapter.id)} failed`,
          'ADAPTER',
          { cause: error },
        )
      }
      if (output.length !== group.inputs.length) {
        throw new RpMediaInputError(
          `RP media input Adapter ${JSON.stringify(adapter.id)} returned the wrong artifact count`,
          'OUTPUT',
        )
      }
      const completed = output.map((artifact, outputIndex) => {
        const expected = group.inputs[outputIndex]
        if (expected === undefined) throw new RpMediaInputError('RP media input routing lost an input', 'OUTPUT')
        validateArtifact(artifact, expected.kind)
        if (artifact.mimeType !== expected.mimeType) {
          throw new RpMediaInputError(
            `RP media input Adapter ${JSON.stringify(adapter.id)} changed the admitted MIME type`,
            'OUTPUT',
          )
        }
        const existingOwner = artifact.metadata?.inputAdapter
        if (existingOwner !== undefined && existingOwner !== adapter.id) {
          throw new RpMediaInputError('RP media artifact claimed a different input Adapter', 'OUTPUT')
        }
        return freezeArtifact({
          ...artifact,
          metadata: { ...(artifact.metadata ?? {}), inputAdapter: adapter.id },
        })
      })
      for (const [offset, artifact] of completed.entries()) {
        const artifactIndex = group.indexes[offset]
        if (artifactIndex === undefined) throw new RpMediaInputError('RP media input routing lost an index', 'OUTPUT')
        artifacts[artifactIndex] = artifact
      }
      this.ctx.emit('rp/media-input-ingested', adapter.id, Object.freeze(completed))
    }
    return Object.freeze(artifacts.map((artifact) => {
      if (artifact === undefined) throw new RpMediaInputError('RP media input routing lost an artifact', 'OUTPUT')
      return artifact
    }))
  }

  /**
   * Resolve one durable input artifact into model-visible reference metadata.
   * @param artifact - Artifact previously returned by an input Adapter.
   * @returns Frozen model media block.
   */
  modelInput(artifact: MediaArtifact): RpModelMediaInput {
    validateArtifact(artifact, artifact.kind)
    const adapterId = artifact.metadata?.inputAdapter
    if (typeof adapterId !== 'string' || adapterId.trim() === '') {
      throw new RpMediaInputError('RP media artifact has no input Adapter provenance', 'INVALID')
    }
    const adapter = this.inputAdapters.get(adapterId)
    if (adapter === undefined) {
      throw new RpMediaInputError(`RP media input Adapter ${JSON.stringify(adapterId)} is not live`, 'MISSING')
    }
    const input = adapter.modelInput(freezeArtifact(artifact))
    if (input === undefined) {
      throw new RpMediaInputError(`RP media input Adapter ${JSON.stringify(adapterId)} rejected its artifact`, 'OUTPUT')
    }
    validateModelInput(input)
    return Object.freeze({ type: 'image', attachment: Object.freeze({ ...input.attachment }) })
  }

  /**
   * Generate one artifact through an explicit or deterministically selected Provider.
   * @param request - Bounded media request.
   * @param signal - Optional cancellation signal.
   * @returns Frozen validated media artifact.
   */
  async generate(request: RpMediaRequest, signal?: AbortSignal): Promise<MediaArtifact> {
    validateRequest(request)
    if (signal?.aborted === true) throw abortError(signal)
    const provider = request.provider === undefined
      ? [...this.providers.values()]
        .filter(candidate => candidate.kinds.includes(request.kind))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))[0]
      : this.providers.get(request.provider)
    if (provider === undefined || !provider.kinds.includes(request.kind)) {
      throw new Error(`No RP media Provider supports ${request.kind}`)
    }
    const artifact = freezeArtifact(await provider.generate(detachRequest(request), signal))
    validateArtifact(artifact, request.kind)
    this.ctx.emit('rp/media-provider-completed', provider.id, artifact)
    return artifact
  }

  private selectInputAdapter(input: RpMediaInputRequest, authority: RpMediaInputAuthority): RpMediaInputAdapter {
    const descriptor = inputDescriptor(input)
    const candidates = [...this.inputAdapters.values()]
      .filter(candidate => input.adapter === undefined || candidate.id === input.adapter)
      .filter((candidate) => {
        try { return candidate.supports(descriptor) }
        catch (error: unknown) {
          throw new RpMediaInputError(
            `RP media input Adapter ${JSON.stringify(candidate.id)} failed during compatibility matching`,
            'ADAPTER',
            { cause: error },
          )
        }
      })
      .sort((left, right) => left.id.localeCompare(right.id))
    const firstCandidate = candidates[0]
    if (firstCandidate === undefined) {
      throw new RpMediaInputError(`No RP media input Adapter supports ${input.kind} ${JSON.stringify(input.mimeType)}`, 'MISSING')
    }
    const granted = new Set(authority.permissions)
    const adapter = candidates.find(candidate => TRUST_RANK[candidate.trust] <= TRUST_RANK[authority.trust]
      && candidate.permissions?.every(permission => granted.has(permission)) !== false)
    if (adapter !== undefined) return adapter
    if (TRUST_RANK[firstCandidate.trust] > TRUST_RANK[authority.trust]) {
      throw new RpMediaInputError(
        `RP media input Adapter ${JSON.stringify(firstCandidate.id)} exceeds the trust ceiling`,
        'DENIED',
      )
    }
    const denied = firstCandidate.permissions?.find(permission => !granted.has(permission))
    if (denied !== undefined) {
      throw new RpMediaInputError(
        `RP media input Adapter ${JSON.stringify(firstCandidate.id)} requires denied permission ${JSON.stringify(denied)}`,
        'DENIED',
      )
    }
    throw new RpMediaInputError('No RP media input Adapter is authorized by the effective authority', 'DENIED')
  }
}

/**
 * Create the built-in deterministic SVG scene-card Provider.
 * @returns L0 SVG media Provider.
 */
export function createSvgCardProvider(): RpMediaProvider {
  return {
    id: RpMediaProviderId('svg-card'), version: '1.0.0', title: 'SVG Scene Card', trust: 'L0', kinds: ['image'],
    generate(request, signal) {
      if (signal?.aborted === true) return Promise.reject(abortError(signal))
      const width = dimension(request.options?.width, 1_024)
      const height = dimension(request.options?.height, 576)
      const title = typeof request.options?.title === 'string' ? request.options.title.slice(0, 120) : 'RP Scene'
      const promptLines = wrapSvgText(request.prompt, 72, 12)
        .map((line, index) => `<tspan x="6%" dy="${index === 0 ? 0 : 32}">${escapeXml(line)}</tspan>`)
        .join('')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#121722"/><text x="6%" y="18%" fill="#9fa8ff" font-family="sans-serif" font-size="32">${escapeXml(title)}</text><text x="6%" y="30%" fill="#e8edf6" font-family="sans-serif" font-size="24">${promptLines}</text></svg>`
      const digest = createHash('sha256').update(svg).digest('hex')
      return Promise.resolve({
        schemaVersion: 1,
        id: `svg-${digest}`,
        kind: 'image',
        mimeType: 'image/svg+xml',
        uri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
        metadata: { provider: 'svg-card', width, height, sha256: digest },
      })
    },
  }
}

const TRUST_RANK: Readonly<Record<RpTrustLevel, number>> = Object.freeze({ L0: 0, L1: 1, L2: 2 })

function validateInputAdapter(adapter: RpMediaInputAdapter): void {
  if (adapter.id.trim() === '' || adapter.id !== adapter.id.trim()
    || adapter.version.trim() === '' || adapter.title.trim() === '') {
    throw new RpMediaInputError('RP media input Adapter id, version, and title are required and normalized', 'INVALID')
  }
  if (!Object.hasOwn(TRUST_RANK, adapter.trust)) {
    throw new RpMediaInputError('RP media input Adapter trust is invalid', 'INVALID')
  }
  if (adapter.permissions?.some(permission => permission.trim() === '' || permission !== permission.trim()) === true
    || adapter.permissions !== undefined && new Set(adapter.permissions).size !== adapter.permissions.length) {
    throw new RpMediaInputError('RP media input Adapter permissions must be unique normalized strings', 'INVALID')
  }
}

function detachInputRequest(input: RpMediaInputRequest): RpMediaInputRequest {
  if (!['image', 'audio', 'video', 'document'].includes(input.kind)) {
    throw new RpMediaInputError('RP media input kind is invalid', 'INVALID')
  }
  if (input.mimeType.trim() === '' || input.mimeType !== input.mimeType.trim() || input.mimeType.length > 256) {
    throw new RpMediaInputError('RP media input MIME type is invalid', 'INVALID')
  }
  if (!(input.data instanceof Uint8Array) || input.data.byteLength === 0) {
    throw new RpMediaInputError('RP media input bytes must be a non-empty Uint8Array', 'INVALID')
  }
  if (input.name !== undefined && (input.name.trim() === '' || input.name.length > 256)) {
    throw new RpMediaInputError('RP media input name must contain 1 to 256 characters', 'INVALID')
  }
  if (input.adapter !== undefined && (input.adapter.trim() === '' || input.adapter !== input.adapter.trim())) {
    throw new RpMediaInputError('RP media input Adapter route must be normalized', 'INVALID')
  }
  return Object.freeze({
    kind: input.kind,
    mimeType: input.mimeType,
    data: Uint8Array.from(input.data),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.adapter === undefined ? {} : { adapter: input.adapter }),
  })
}

function inputDescriptor(input: RpMediaInputRequest): RpMediaInputDescriptor {
  return Object.freeze({
    kind: input.kind,
    mimeType: input.mimeType,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.adapter === undefined ? {} : { adapter: input.adapter }),
  })
}

function validateModelInput(input: RpModelMediaInput): void {
  const attachment = input.attachment
  if (attachment.attachmentId.trim() === '' || attachment.mediaType.trim() === '') {
    throw new RpMediaInputError('RP media Adapter returned an invalid model image identity', 'OUTPUT')
  }
  for (const [key, value] of Object.entries({
    bytes: attachment.bytes,
    width: attachment.width,
    height: attachment.height,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RpMediaInputError(`RP media Adapter returned invalid image ${key}`, 'OUTPUT')
    }
  }
  if (attachment.name !== undefined && (attachment.name.trim() === '' || attachment.name.length > 256)) {
    throw new RpMediaInputError('RP media Adapter returned an invalid image name', 'OUTPUT')
  }
}

function validateProvider(provider: RpMediaProvider): void {
  if (String(provider.id).trim() === '' || provider.version.trim() === '' || provider.title.trim() === '') {
    throw new Error('RP media Provider id, version, and title are required')
  }
  if (provider.kinds.length === 0) throw new Error('RP media Provider must support at least one artifact kind')
}
function validateRequest(request: RpMediaRequest): void {
  if (!['image', 'audio', 'video', 'document'].includes(request.kind)) throw new Error('Unknown RP media kind')
  if (request.prompt.trim() === '' || request.prompt.length > 2_000) {
    throw new Error('RP media prompt must contain 1 to 2000 characters')
  }
}
function validateArtifact(artifact: MediaArtifact, expectedKind: MediaArtifact['kind']): void {
  if (artifact.id.trim() === '' || artifact.kind !== expectedKind) {
    throw new Error('RP media Provider returned invalid artifact identity or kind')
  }
  if (artifact.mimeType.trim() === '' || Buffer.byteLength(artifact.uri, 'utf8') > 4 * 1024 * 1024) {
    throw new Error('RP media artifact MIME type is required and URI is limited to 4 MiB')
  }
  if (!/^(?:data:|https:\/\/|attachment:)/u.test(artifact.uri)) {
    throw new Error('RP media artifact URI must use data, HTTPS, or attachment scheme')
  }
}
function detachRequest(request: RpMediaRequest): RpMediaRequest {
  return Object.freeze({
    ...request,
    ...(request.options === undefined ? {} : { options: Object.freeze(structuredClone(request.options)) }),
  })
}
function freezeArtifact(artifact: MediaArtifact): MediaArtifact {
  return Object.freeze({
    ...artifact,
    ...(artifact.metadata === undefined ? {} : { metadata: Object.freeze(structuredClone(artifact.metadata)) }),
  })
}
function dimension(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 64 || value > 4_096) {
    throw new Error('SVG scene-card dimensions must be integers from 64 to 4096')
  }
  return value
}
function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
function wrapSvgText(value: string, width: number, limit: number): string[] {
  const chunks: string[] = []
  for (const sourceLine of value.split(/\r?\n/u)) {
    const line = sourceLine.trim()
    if (line === '') chunks.push(' ')
    for (let offset = 0; offset < line.length; offset += width) chunks.push(line.slice(offset, offset + width))
    if (chunks.length >= limit) break
  }
  return chunks.slice(0, limit)
}
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'media generation cancelled'))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError(signal)
}

export default RpMediaRuntime
