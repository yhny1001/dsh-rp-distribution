/** Durable self-hosted reference service for the open RP package Registry protocol. @module @dsh-rp/registry-server */

import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  mkdir, mkdtemp, readFile, rename, rm, stat, writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { JsonValue, RpPackageManifest } from '@dsh-rp/contracts'
import { parseRpRuntimeArchive } from '@dsh-rp/package-runtime'
import {
  DEFAULT_RP_RUNTIME_ARCHIVE_LIMITS,
  hashRpPackageManifest,
  validateRpPackageManifest,
  verifyRpPackageIntegrity,
  verifyRpPackageSbom,
  verifyRpPackageSignature,
} from '@dsh-rp/sdk'

const INDEX = 'index.json'
const MANIFEST = 'rp.package.json'
const PAYLOAD = 'rp.package.tgz'
const SBOM = 'rp.sbom.json'
const MAX_MANIFEST_ENVELOPE_BYTES = 1024 * 1024
const MAX_SBOM_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_REQUEST_BYTES = 96 * 1024 * 1024

/** Stable machine-readable server failure classes. */
export type RpRegistryServerErrorCode =
  | 'AUTH'
  | 'CONFLICT'
  | 'CORRUPT'
  | 'INTEGRITY'
  | 'INVALID'
  | 'NOT_FOUND'
  | 'READ_ONLY'
  | 'REVOKED'

/** Failure returned consistently by repository and HTTP boundaries. */
export class RpRegistryServerError extends Error {
  constructor(message: string, readonly code: RpRegistryServerErrorCode) {
    super(message)
    this.name = 'RpRegistryServerError'
  }
}

/** Trusted publisher key accepted by the reference server. */
export interface RpRegistryPublisherKey {
  readonly keyId: string
  readonly publicKey: string | Buffer
}

/** Durable repository and public URL configuration. */
export interface RpReferenceRegistryOptions {
  readonly root: string
  readonly publicOrigin: string
  readonly publisherKeys?: readonly RpRegistryPublisherKey[]
  readonly maxArtifactBytes?: number
  readonly clock?: () => number
}

/** Complete immutable release accepted by a publication transaction. */
export interface RpRegistryPublication {
  readonly manifest: unknown
  readonly archive: Uint8Array
  readonly sbom: unknown
}

/** Public catalog row with revocation and evidence state. */
export interface RpRegistryCatalogEntry {
  readonly id: string
  readonly version: string
  readonly name: string
  readonly trust: RpPackageManifest['trust']
  readonly publishedAt: number
  readonly manifestHash: string
  readonly payloadSha256: string
  readonly sbomSha256: string
  readonly signingKeyId?: string
  readonly revoked: boolean
  readonly signingKeyRevoked: boolean
  readonly manifestUrl: string
}

/** Package or exact-version revocation record. */
export interface RpRegistryPackageRevocation {
  readonly id: string
  readonly version?: string
  readonly reason: string
  readonly revokedAt: number
}

/** Publisher-key revocation record. */
export interface RpRegistryKeyRevocation {
  readonly keyId: string
  readonly reason: string
  readonly revokedAt: number
}

/** Publication result distinguishing a new commit from an idempotent retry. */
export interface RpRegistryPublicationResult {
  readonly created: boolean
  readonly entry: RpRegistryCatalogEntry
}

/** Verified immutable release metadata returned by repository resolution. */
export interface RpRegistryReleaseRecord {
  readonly manifest: RpPackageManifest
  readonly manifestHash: string
  readonly publishedAt: number
}

interface StoredIndex {
  readonly schemaVersion: 1
  readonly releases: readonly RpRegistryReleaseRecord[]
  readonly packageRevocations: readonly RpRegistryPackageRevocation[]
  readonly keyRevocations: readonly RpRegistryKeyRevocation[]
}

/**
 * Filesystem-backed immutable release repository.
 *
 * Writers serialize on one cross-process index lock. Release directories are staged and renamed
 * before the atomic index publication, so lock-free readers never observe an indexed partial release.
 */
export class RpReferenceRegistry {
  /** Canonical durable repository root. */
  readonly root: string
  /** Credential-free public origin embedded in release evidence URLs. */
  readonly publicOrigin: URL
  /** Maximum accepted or served package archive size. */
  readonly maxArtifactBytes: number
  private readonly clock: () => number
  private readonly publisherKeys: ReadonlyMap<string, string | Buffer>
  private readonly indexPath: string
  private initialized: Promise<void> | undefined

  constructor(options: RpReferenceRegistryOptions) {
    this.root = resolve(options.root)
    this.publicOrigin = registryOrigin(options.publicOrigin)
    this.maxArtifactBytes = positiveInteger(options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES, 'maxArtifactBytes')
    this.clock = options.clock ?? Date.now
    this.publisherKeys = publisherKeyMap(options.publisherKeys ?? [])
    this.indexPath = join(this.root, INDEX)
  }

  /**
   * Create the durable tree and an empty atomic index exactly once.
   * @returns Initialization completion shared by concurrent callers.
   */
  initialize(): Promise<void> {
    this.initialized ??= this.initializeOnce()
    return this.initialized
  }

  /**
   * Validate and atomically publish an immutable package release.
   * @param publication - Untrusted Manifest, archive, and SBOM evidence.
   * @returns Committed catalog row and whether this call created it.
   */
  async publish(publication: RpRegistryPublication): Promise<RpRegistryPublicationResult> {
    await this.initialize()
    const verified = await this.verifyPublication(publication)
    return await withFileLock(this.indexPath, async () => {
      const index = await this.readIndex()
      assertNotRevoked(index, verified.manifest)
      const existing = index.releases.find(item => sameRelease(item, verified.manifest))
      if (existing !== undefined) {
        if (existing.manifestHash !== verified.manifestHash) {
          throw conflict(`${verified.manifest.id}@${verified.manifest.version} is immutable and already differs`)
        }
        await this.verifyStoredEvidence(existing)
        return Object.freeze({ created: false, entry: this.catalogEntry(existing, index) })
      }
      const directory = this.releaseDirectory(verified.manifest)
      await mkdir(dirname(directory), { recursive: true, mode: 0o755 })
      const stage = await mkdtemp(join(this.root, 'releases', '.stage-'))
      let promoted = false
      try {
        await writeFile(join(stage, MANIFEST), renderJson(verified.manifest), { flag: 'wx', mode: 0o644 })
        await writeFile(join(stage, PAYLOAD), verified.archive, { flag: 'wx', mode: 0o644 })
        await writeFile(join(stage, SBOM), renderJson(verified.sbom), { flag: 'wx', mode: 0o644 })
        try {
          await rename(stage, directory)
          promoted = true
        } catch (error: unknown) {
          if (!await isDirectory(directory)) throw error
          await this.verifyDirectoryEvidence(directory, verified.manifest, verified.archive, verified.sbom)
        }
        const stored: RpRegistryReleaseRecord = Object.freeze({
          manifest: verified.manifest,
          manifestHash: verified.manifestHash,
          publishedAt: this.clock(),
        })
        const next: StoredIndex = Object.freeze({
          ...index,
          releases: Object.freeze([...index.releases, stored]),
        })
        try { await this.writeIndex(next) }
        catch (error: unknown) {
          if (promoted) await rm(directory, { recursive: true, force: true })
          throw error
        }
        return Object.freeze({ created: true, entry: this.catalogEntry(stored, next) })
      } finally {
        await rm(stage, { recursive: true, force: true })
      }
    })
  }

  /**
   * List every immutable release in deterministic package and descending-version order.
   * @returns Detached public catalog rows.
   */
  async list(): Promise<readonly RpRegistryCatalogEntry[]> {
    await this.initialize()
    const index = await this.readIndex()
    return Object.freeze(index.releases
      .map(release => this.catalogEntry(release, index))
      .sort((left, right) => left.id.localeCompare(right.id) || compareVersions(right.version, left.version)))
  }

  /**
   * Resolve an exact release, or the highest active version when version is omitted.
   * @param id - Exact package identity.
   * @param version - Optional exact version.
   * @returns Verified immutable release metadata.
   */
  async resolveRelease(id: string, version?: string): Promise<RpRegistryReleaseRecord> {
    await this.initialize()
    const index = await this.readIndex()
    const matches = index.releases
      .filter(item => String(item.manifest.id) === id && (version === undefined || item.manifest.version === version))
      .sort((left, right) => compareVersions(right.manifest.version, left.manifest.version))
    if (version !== undefined) {
      const exact = matches[0]
      if (exact === undefined) throw notFound(`${id}@${version} is not published`)
      assertNotRevoked(index, exact.manifest)
      await this.verifyStoredEvidence(exact)
      return freezeRelease(exact)
    }
    for (const candidate of matches) {
      if (!isRevoked(index, candidate.manifest)) {
        await this.verifyStoredEvidence(candidate)
        return freezeRelease(candidate)
      }
    }
    if (matches.length > 0) throw revoked(`${id} has no active release`)
    throw notFound(`${id} is not published`)
  }

  /**
   * Build the open Registry Provider response for one release.
   * @param id - Exact package identity.
   * @param version - Optional exact version.
   * @returns Manifest, payload URL, and detached hash-bound SBOM.
   */
  async releaseEnvelope(id: string, version?: string): Promise<Readonly<Record<string, JsonValue>>> {
    const release = await this.resolveRelease(id, version)
    const base = this.releaseUrl(release.manifest)
    await this.readVerifiedSbom(release)
    return Object.freeze({
      manifest: structuredClone(release.manifest) as unknown as JsonValue,
      payloadUrl: `${base}/payload`,
      sbomUrl: `${base}/sbom`,
    })
  }

  /**
   * Read and reverify immutable payload bytes before serving them.
   * @param id - Exact package identity.
   * @param version - Exact release version.
   * @returns Detached integrity-verified archive bytes.
   */
  async readPayload(id: string, version: string): Promise<Uint8Array> {
    const release = await this.resolveRelease(id, version)
    const archive = new Uint8Array(await readFile(join(this.releaseDirectory(release.manifest), PAYLOAD)))
    if (archive.byteLength > this.maxArtifactBytes || !verifyRpPackageIntegrity(archive, release.manifest)) {
      throw corrupt(`${release.manifest.id}@${release.manifest.version} stored payload is corrupt`)
    }
    return archive
  }

  /**
   * Read and reverify the hash-bound SBOM before serving it.
   * @param id - Exact package identity.
   * @param version - Exact release version.
   * @returns Detached integrity-verified SBOM.
   */
  async readSbom(id: string, version: string): Promise<JsonValue> {
    const release = await this.resolveRelease(id, version)
    return await this.readVerifiedSbom(release)
  }

  /**
   * Add an append-only package or exact-version revocation.
   * @param input - Package target, reason, and optional owning timestamp.
   * @returns Existing idempotent or newly committed revocation.
   */
  async revokePackage(input: Omit<RpRegistryPackageRevocation, 'revokedAt'> & { readonly revokedAt?: number }): Promise<RpRegistryPackageRevocation> {
    await this.initialize()
    const id = nonEmpty(input.id, 'revocation id')
    const version = input.version === undefined ? undefined : exactVersion(input.version)
    const reason = nonEmpty(input.reason, 'revocation reason')
    return await withFileLock(this.indexPath, async () => {
      const index = await this.readIndex()
      const existing = index.packageRevocations.find(item => item.id === id && item.version === version)
      if (existing !== undefined) {
        if (existing.reason !== reason) throw conflict(`Revocation for ${id}@${version ?? '*'} already has a different reason`)
        return Object.freeze({ ...existing })
      }
      const stored = Object.freeze({
        id,
        ...(version === undefined ? {} : { version }),
        reason,
        revokedAt: input.revokedAt === undefined ? this.clock() : timestamp(input.revokedAt, 'revokedAt'),
      })
      await this.writeIndex(Object.freeze({
        ...index,
        packageRevocations: Object.freeze([...index.packageRevocations, stored]),
      }))
      return stored
    })
  }

  /**
   * Add an append-only signing-key revocation.
   * @param input - Signing-key target, reason, and optional owning timestamp.
   * @returns Existing idempotent or newly committed revocation.
   */
  async revokeKey(input: Omit<RpRegistryKeyRevocation, 'revokedAt'> & { readonly revokedAt?: number }): Promise<RpRegistryKeyRevocation> {
    await this.initialize()
    const keyId = nonEmpty(input.keyId, 'key revocation id')
    const reason = nonEmpty(input.reason, 'key revocation reason')
    return await withFileLock(this.indexPath, async () => {
      const index = await this.readIndex()
      const existing = index.keyRevocations.find(item => item.keyId === keyId)
      if (existing !== undefined) {
        if (existing.reason !== reason) throw conflict(`Revocation for key ${keyId} already has a different reason`)
        return Object.freeze({ ...existing })
      }
      const stored = Object.freeze({
        keyId,
        reason,
        revokedAt: input.revokedAt === undefined ? this.clock() : timestamp(input.revokedAt, 'revokedAt'),
      })
      await this.writeIndex(Object.freeze({
        ...index,
        keyRevocations: Object.freeze([...index.keyRevocations, stored]),
      }))
      return stored
    })
  }

  /**
   * List detached append-only revocation records for mirrors and audit clients.
   * @returns Package and key revocation feeds.
   */
  async listRevocations(): Promise<Readonly<{
    packages: readonly RpRegistryPackageRevocation[]
    keys: readonly RpRegistryKeyRevocation[]
  }>> {
    await this.initialize()
    const index = await this.readIndex()
    return Object.freeze({
      packages: Object.freeze(index.packageRevocations.map(item => Object.freeze({ ...item }))),
      keys: Object.freeze(index.keyRevocations.map(item => Object.freeze({ ...item }))),
    })
  }

  private async initializeOnce(): Promise<void> {
    await mkdir(join(this.root, 'releases'), { recursive: true, mode: 0o755 })
    await withFileLock(this.indexPath, async () => {
      try { await this.readIndex() }
      catch (error: unknown) {
        if (!isMissing(error)) throw error
        await this.writeIndex(emptyIndex())
      }
    })
  }

  private async verifyPublication(publication: RpRegistryPublication): Promise<Readonly<{
    manifest: RpPackageManifest
    manifestHash: string
    archive: Uint8Array
    sbom: JsonValue
  }>> {
    if (!(publication.archive instanceof Uint8Array) || publication.archive.byteLength === 0
      || publication.archive.byteLength > this.maxArtifactBytes) {
      throw invalid(`RP archive must contain 1..${this.maxArtifactBytes} bytes`)
    }
    const validation = validateRpPackageManifest(publication.manifest)
    if (!validation.valid || validation.manifest === undefined) {
      throw invalid(validation.diagnostics.map(item => `${item.path}: ${item.message}`).join('; '))
    }
    const manifest = validation.manifest
    const sbom = jsonValue(publication.sbom, 'RP SBOM')
    const base = this.releaseUrl(manifest)
    if (Buffer.byteLength(renderJson({
      manifest,
      payloadUrl: `${base}/payload`,
      sbomUrl: `${base}/sbom`,
    }), 'utf8') > MAX_MANIFEST_ENVELOPE_BYTES) {
      throw invalid(`RP Registry release envelope exceeds ${MAX_MANIFEST_ENVELOPE_BYTES} bytes`)
    }
    if (Buffer.byteLength(renderJson(sbom), 'utf8') > MAX_SBOM_BYTES) {
      throw invalid(`RP SBOM exceeds ${MAX_SBOM_BYTES} bytes`)
    }
    if (!verifyRpPackageIntegrity(publication.archive, manifest)) throw integrity('RP archive SHA-256 mismatch')
    if (!verifyRpPackageSbom(sbom, manifest)) throw integrity('RP SBOM digest mismatch')
    const keyId = manifest.integrity?.keyId
    const signature = manifest.integrity?.signature
    if (manifest.trust === 'L2' && (keyId === undefined || signature === undefined)) {
      throw integrity('Trust L2 publication requires a signed Manifest')
    }
    if (keyId !== undefined || signature !== undefined) {
      if (keyId === undefined || signature === undefined) throw integrity('Manifest signature and keyId must be declared together')
      const publicKey = this.publisherKeys.get(keyId)
      if (publicKey === undefined) throw integrity(`Publisher key ${keyId} is not trusted by this Registry`)
      if (!verifyRpPackageSignature(manifest, publicKey)) throw integrity('Manifest signature is invalid')
    }
    await parseRpRuntimeArchive(publication.archive, manifest, DEFAULT_RP_RUNTIME_ARCHIVE_LIMITS)
    return Object.freeze({
      manifest,
      manifestHash: hashRpPackageManifest(manifest),
      archive: publication.archive.slice(),
      sbom: structuredClone(sbom),
    })
  }

  private async verifyStoredEvidence(release: RpRegistryReleaseRecord): Promise<void> {
    const directory = this.releaseDirectory(release.manifest)
    const manifestValue = parseJson(await readFile(join(directory, MANIFEST), 'utf8'), MANIFEST)
    const validation = validateRpPackageManifest(manifestValue)
    if (!validation.valid || validation.manifest === undefined
      || hashRpPackageManifest(validation.manifest) !== release.manifestHash) {
      throw corrupt(`${release.manifest.id}@${release.manifest.version} stored Manifest is corrupt`)
    }
    const archive = new Uint8Array(await readFile(join(directory, PAYLOAD)))
    const sbom = parseJson(await readFile(join(directory, SBOM), 'utf8'), SBOM)
    if (archive.byteLength > this.maxArtifactBytes || !verifyRpPackageIntegrity(archive, release.manifest)
      || !verifyRpPackageSbom(sbom, release.manifest)) {
      throw corrupt(`${release.manifest.id}@${release.manifest.version} stored evidence is corrupt`)
    }
    this.verifyStoredSignature(release.manifest)
  }

  private async readVerifiedSbom(release: RpRegistryReleaseRecord): Promise<JsonValue> {
    const sbom = parseJson(await readFile(join(this.releaseDirectory(release.manifest), SBOM), 'utf8'), SBOM)
    if (!verifyRpPackageSbom(sbom, release.manifest)) {
      throw corrupt(`${release.manifest.id}@${release.manifest.version} stored SBOM is corrupt`)
    }
    return sbom
  }

  private verifyStoredSignature(manifest: RpPackageManifest): void {
    const keyId = manifest.integrity?.keyId
    const signature = manifest.integrity?.signature
    if (manifest.trust === 'L2' && (keyId === undefined || signature === undefined)) {
      throw corrupt(`${manifest.id}@${manifest.version} no longer satisfies L2 signing policy`)
    }
    if (keyId === undefined && signature === undefined) return
    const publicKey = keyId === undefined ? undefined : this.publisherKeys.get(keyId)
    if (keyId === undefined || signature === undefined || publicKey === undefined
      || !verifyRpPackageSignature(manifest, publicKey)) {
      throw corrupt(`${manifest.id}@${manifest.version} stored signature is not trusted`)
    }
  }

  private async verifyDirectoryEvidence(
    directory: string,
    manifest: RpPackageManifest,
    archive: Uint8Array,
    sbom: JsonValue,
  ): Promise<void> {
    const storedManifest = parseJson(await readFile(join(directory, MANIFEST), 'utf8'), MANIFEST)
    const storedArchive = new Uint8Array(await readFile(join(directory, PAYLOAD)))
    const storedSbom = parseJson(await readFile(join(directory, SBOM), 'utf8'), SBOM)
    if (JSON.stringify(storedManifest) !== JSON.stringify(manifest)
      || !timingSafeBytes(storedArchive, archive)
      || JSON.stringify(storedSbom) !== JSON.stringify(sbom)) {
      throw conflict(`${manifest.id}@${manifest.version} has a conflicting orphan release directory`)
    }
  }

  private async readIndex(): Promise<StoredIndex> {
    const value = parseJson(await readFile(this.indexPath, 'utf8'), INDEX)
    return parseIndex(value)
  }

  private async writeIndex(index: StoredIndex): Promise<void> {
    await writeFileAtomic(this.indexPath, renderJson(index), { mode: 0o644, dirMode: 0o755 })
  }

  private releaseDirectory(manifest: RpPackageManifest): string {
    const owner = createHash('sha256').update(String(manifest.id)).digest('hex')
    return join(this.root, 'releases', owner, manifest.version)
  }

  private releaseUrl(manifest: RpPackageManifest): string {
    return new URL(
      `/api/rp/v1/packages/${encodeURIComponent(String(manifest.id))}/${encodeURIComponent(manifest.version)}`,
      this.publicOrigin,
    ).href.replace(/\/$/u, '')
  }

  private catalogEntry(release: RpRegistryReleaseRecord, index: StoredIndex): RpRegistryCatalogEntry {
    const manifest = release.manifest
    return Object.freeze({
      id: String(manifest.id),
      version: manifest.version,
      name: manifest.name,
      trust: manifest.trust,
      publishedAt: release.publishedAt,
      manifestHash: release.manifestHash,
      payloadSha256: manifest.integrity?.sha256 as string,
      sbomSha256: manifest.integrity?.sbom as string,
      ...(manifest.integrity?.keyId === undefined ? {} : { signingKeyId: manifest.integrity.keyId }),
      revoked: isPackageRevoked(index, String(manifest.id), manifest.version),
      signingKeyRevoked: manifest.integrity?.keyId !== undefined
        && index.keyRevocations.some(item => item.keyId === manifest.integrity?.keyId),
      manifestUrl: this.releaseUrl(manifest),
    })
  }
}

/** HTTP handler authentication and request-size policy. */
export interface RpRegistryHttpOptions {
  readonly publishToken?: string
  readonly maxRequestBytes?: number
}

/**
 * Create a Fetch-compatible API and zero-script catalog Web handler.
 * @param registry - Durable release repository.
 * @param options - Mutation authentication and request-size policy.
 * @returns Fetch-compatible request handler.
 */
export function createRpRegistryFetchHandler(
  registry: RpReferenceRegistry,
  options: RpRegistryHttpOptions = {},
): (request: Request) => Promise<Response> {
  const maxRequestBytes = positiveInteger(options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES, 'maxRequestBytes')
  return async (request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const segments = url.pathname.split('/').filter(Boolean)
      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/') {
        const response = htmlResponse(renderCatalog(await registry.list()))
        return request.method === 'HEAD' ? withoutBody(response) : response
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/rp/v1/catalog') {
        const response = jsonResponse({ schemaVersion: 1, releases: await registry.list() })
        return request.method === 'HEAD' ? withoutBody(response) : response
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/rp/v1/revocations') {
        const response = jsonResponse({ schemaVersion: 1, ...await registry.listRevocations() })
        return request.method === 'HEAD' ? withoutBody(response) : response
      }
      if (segments.slice(0, 4).join('/') === 'api/rp/v1/packages' && (request.method === 'GET' || request.method === 'HEAD')) {
        const id = segments[4] === undefined ? undefined : decodePath(segments[4])
        const version = segments[5] === undefined ? undefined : decodePath(segments[5])
        const resource = segments[6]
        if (id === undefined || segments.length > 7) throw notFound('Unknown Registry package route')
        if (resource === undefined) {
          const response = jsonResponse(await registry.releaseEnvelope(id, version))
          return request.method === 'HEAD' ? withoutBody(response) : response
        }
        if (version === undefined || (resource !== 'payload' && resource !== 'sbom')) {
          throw notFound('Unknown Registry evidence route')
        }
        if (resource === 'payload') {
          const response = new Response(fetchBody(await registry.readPayload(id, version)), {
            status: 200,
            headers: immutableHeaders('application/gzip'),
          })
          return request.method === 'HEAD' ? withoutBody(response) : response
        }
        const response = jsonResponse(await registry.readSbom(id, version), 200, true)
        return request.method === 'HEAD' ? withoutBody(response) : response
      }
      if (request.method === 'POST' && url.pathname === '/api/rp/v1/releases') {
        requireMutationToken(request, options.publishToken)
        const body = recordValue(await requestJson(request, maxRequestBytes), 'publication')
        onlyKeys(body, ['manifest', 'payloadBase64', 'sbom'], 'publication')
        const archive = canonicalBase64(body.payloadBase64, 'publication payloadBase64')
        const result = await registry.publish({ manifest: body.manifest, archive, sbom: body.sbom })
        return jsonResponse(result, result.created ? 201 : 200)
      }
      if (request.method === 'POST' && url.pathname === '/api/rp/v1/revocations/packages') {
        requireMutationToken(request, options.publishToken)
        const body = recordValue(await requestJson(request, maxRequestBytes), 'package revocation')
        onlyKeys(body, ['id', 'version', 'reason'], 'package revocation')
        return jsonResponse(await registry.revokePackage({
          id: stringValue(body.id, 'package revocation id'),
          ...(body.version === undefined ? {} : { version: stringValue(body.version, 'package revocation version') }),
          reason: stringValue(body.reason, 'package revocation reason'),
        }), 201)
      }
      if (request.method === 'POST' && url.pathname === '/api/rp/v1/revocations/keys') {
        requireMutationToken(request, options.publishToken)
        const body = recordValue(await requestJson(request, maxRequestBytes), 'key revocation')
        onlyKeys(body, ['keyId', 'reason'], 'key revocation')
        return jsonResponse(await registry.revokeKey({
          keyId: stringValue(body.keyId, 'key revocation id'),
          reason: stringValue(body.reason, 'key revocation reason'),
        }), 201)
      }
      throw notFound('Unknown Registry route')
    } catch (error: unknown) {
      const normalized = normalizeError(error)
      return jsonResponse({ error: normalized.message, code: normalized.code }, statusFor(normalized.code))
    }
  }
}

/**
 * Adapt the Fetch handler to Node's built-in HTTP server without framework coupling.
 * @param registry - Durable release repository.
 * @param options - Mutation authentication and request-size policy.
 * @returns Node HTTP request listener.
 */
export function createRpRegistryNodeHandler(
  registry: RpReferenceRegistry,
  options: RpRegistryHttpOptions = {},
): (request: IncomingMessage, response: ServerResponse) => void {
  const fetchHandler = createRpRegistryFetchHandler(registry, options)
  const maxRequestBytes = positiveInteger(options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES, 'maxRequestBytes')
  return (request, response): void => {
    void handleNodeRequest(request, response, registry.publicOrigin, fetchHandler, maxRequestBytes)
  }
}

async function handleNodeRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  origin: URL,
  handler: (request: Request) => Promise<Response>,
  maxRequestBytes: number,
): Promise<void> {
  try {
    const method = incoming.method ?? 'GET'
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readNodeBody(incoming, maxRequestBytes)
    const request = new Request(new URL(incoming.url ?? '/', origin), {
      method,
      headers: nodeHeaders(incoming),
      ...(body === undefined ? {} : { body: fetchBody(body) }),
    })
    const result = await handler(request)
    outgoing.statusCode = result.status
    result.headers.forEach((value, key) => outgoing.setHeader(key, value))
    outgoing.end(Buffer.from(await result.arrayBuffer()))
  } catch (error: unknown) {
    const normalized = normalizeError(error)
    outgoing.statusCode = statusFor(normalized.code)
    outgoing.setHeader('content-type', 'application/json; charset=utf-8')
    outgoing.setHeader('x-content-type-options', 'nosniff')
    outgoing.end(renderJson({ error: normalized.message, code: normalized.code }))
  }
}

async function readNodeBody(request: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += bytes.byteLength
    if (total > maxBytes) throw invalid(`HTTP request exceeds ${maxBytes} bytes`)
    chunks.push(bytes)
  }
  return new Uint8Array(Buffer.concat(chunks, total))
}

function nodeHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => { headers.append(key, item) })
    else if (value !== undefined) headers.set(key, value)
  }
  return headers
}

function parseIndex(value: JsonValue): StoredIndex {
  const record = recordValue(value, 'Registry index')
  if (record.schemaVersion !== 1 || !Array.isArray(record.releases)
    || !Array.isArray(record.packageRevocations) || !Array.isArray(record.keyRevocations)) {
    throw corrupt('Registry index has an unsupported shape')
  }
  const releases = record.releases.map((item, index): RpRegistryReleaseRecord => {
    const row = recordValue(item, `Registry release ${index}`)
    const validation = validateRpPackageManifest(row.manifest)
    if (!validation.valid || validation.manifest === undefined
      || typeof row.manifestHash !== 'string' || row.manifestHash !== hashRpPackageManifest(validation.manifest)
      || typeof row.publishedAt !== 'number' || !Number.isSafeInteger(row.publishedAt) || row.publishedAt < 0) {
      throw corrupt(`Registry release ${index} is invalid`)
    }
    return Object.freeze({ manifest: validation.manifest, manifestHash: row.manifestHash, publishedAt: row.publishedAt })
  })
  const identities = releases.map(item => `${item.manifest.id}\0${item.manifest.version}`)
  if (new Set(identities).size !== identities.length) throw corrupt('Registry index contains duplicate releases')
  const packageRevocations = record.packageRevocations.map(parsePackageRevocation)
  const packageTargets = packageRevocations.map(item => `${item.id}\0${item.version ?? '*'}`)
  if (new Set(packageTargets).size !== packageTargets.length) throw corrupt('Registry index contains duplicate package revocations')
  const keyRevocations = record.keyRevocations.map(parseKeyRevocation)
  if (new Set(keyRevocations.map(item => item.keyId)).size !== keyRevocations.length) {
    throw corrupt('Registry index contains duplicate key revocations')
  }
  return Object.freeze({
    schemaVersion: 1,
    releases: Object.freeze(releases),
    packageRevocations: Object.freeze(packageRevocations),
    keyRevocations: Object.freeze(keyRevocations),
  })
}

function parsePackageRevocation(value: unknown, index: number): RpRegistryPackageRevocation {
  const record = recordValue(value, `Package revocation ${index}`)
  return Object.freeze({
    id: nonEmpty(record.id, `Package revocation ${index} id`),
    ...(record.version === undefined ? {} : { version: exactVersion(record.version) }),
    reason: nonEmpty(record.reason, `Package revocation ${index} reason`),
    revokedAt: timestamp(record.revokedAt, `Package revocation ${index} revokedAt`),
  })
}

function parseKeyRevocation(value: unknown, index: number): RpRegistryKeyRevocation {
  const record = recordValue(value, `Key revocation ${index}`)
  return Object.freeze({
    keyId: nonEmpty(record.keyId, `Key revocation ${index} keyId`),
    reason: nonEmpty(record.reason, `Key revocation ${index} reason`),
    revokedAt: timestamp(record.revokedAt, `Key revocation ${index} revokedAt`),
  })
}

function emptyIndex(): StoredIndex {
  return Object.freeze({
    schemaVersion: 1,
    releases: Object.freeze([]),
    packageRevocations: Object.freeze([]),
    keyRevocations: Object.freeze([]),
  })
}

function assertNotRevoked(index: StoredIndex, manifest: RpPackageManifest): void {
  if (isPackageRevoked(index, String(manifest.id), manifest.version)) throw revoked(`${manifest.id}@${manifest.version} is revoked`)
  const keyId = manifest.integrity?.keyId
  if (keyId !== undefined && index.keyRevocations.some(item => item.keyId === keyId)) {
    throw revoked(`Publisher key ${keyId} is revoked`)
  }
}

function isRevoked(index: StoredIndex, manifest: RpPackageManifest): boolean {
  return isPackageRevoked(index, String(manifest.id), manifest.version)
    || (manifest.integrity?.keyId !== undefined && index.keyRevocations.some(item => item.keyId === manifest.integrity?.keyId))
}

function isPackageRevoked(index: StoredIndex, id: string, version: string): boolean {
  return index.packageRevocations.some(item => item.id === id && (item.version === undefined || item.version === version))
}

function sameRelease(release: RpRegistryReleaseRecord, manifest: RpPackageManifest): boolean {
  return String(release.manifest.id) === String(manifest.id) && release.manifest.version === manifest.version
}

function freezeRelease(release: RpRegistryReleaseRecord): RpRegistryReleaseRecord {
  return Object.freeze({
    manifest: structuredClone(release.manifest),
    manifestHash: release.manifestHash,
    publishedAt: release.publishedAt,
  })
}

function publisherKeyMap(keys: readonly RpRegistryPublisherKey[]): ReadonlyMap<string, string | Buffer> {
  const result = new Map<string, string | Buffer>()
  for (const key of keys) {
    const id = nonEmpty(key.keyId, 'publisher key id')
    if (result.has(id)) throw invalid(`Duplicate publisher key ${id}`)
    result.set(id, typeof key.publicKey === 'string' ? key.publicKey : Buffer.from(key.publicKey))
  }
  return result
}

function registryOrigin(value: string): URL {
  const url = new URL(value)
  const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
  if (url.protocol !== 'https:' && !loopback) throw invalid('Registry publicOrigin must use HTTPS unless it is loopback')
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw invalid('Registry publicOrigin must be a credential-free origin')
  }
  return url
}

function renderCatalog(entries: readonly RpRegistryCatalogEntry[]): string {
  const rows = entries.map(entry => `<tr><td><a href="${escapeHtml(entry.manifestUrl)}">${escapeHtml(entry.id)}</a></td><td>${escapeHtml(entry.version)}</td><td>${escapeHtml(entry.trust)}</td><td>${entry.revoked || entry.signingKeyRevoked ? 'revoked' : 'active'}</td></tr>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH RP Registry</title><style>body{font:16px system-ui;max-width:72rem;margin:3rem auto;padding:0 1rem;color:#17202a}table{border-collapse:collapse;width:100%}th,td{padding:.65rem;border-bottom:1px solid #ccd1d1;text-align:left}code{background:#f4f6f7;padding:.15rem .3rem}</style></head><body><h1>DSH RP Registry</h1><p>Immutable MIT RP package releases. Machine catalog: <a href="/api/rp/v1/catalog"><code>/api/rp/v1/catalog</code></a>.</p><table><thead><tr><th>Package</th><th>Version</th><th>Trust</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
}

function jsonResponse(value: unknown, status = 200, immutable = false): Response {
  return new Response(renderJson(value), {
    status,
    headers: immutable ? immutableHeaders('application/json; charset=utf-8') : publicJsonHeaders(),
  })
}

function publicJsonHeaders(): Headers {
  return new Headers({
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
}

function immutableHeaders(contentType: string): Headers {
  return new Headers({
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=31536000, immutable',
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
  })
}

function htmlResponse(value: string): Response {
  return new Response(value, { headers: {
    'cache-control': 'no-cache',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    'content-type': 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff',
  } })
}

function withoutBody(response: Response): Response {
  return new Response(null, { status: response.status, headers: response.headers })
}

async function requestJson(request: Request, maxBytes: number): Promise<JsonValue> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw invalid('HTTP mutation requires application/json')
  }
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw invalid(`HTTP request exceeds ${maxBytes} bytes`)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw invalid(`HTTP request exceeds ${maxBytes} bytes`)
  let source: string
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw invalid('HTTP request must be valid UTF-8') }
  let value: unknown
  try { value = JSON.parse(source) }
  catch (error: unknown) { throw invalid(`HTTP request is invalid JSON: ${renderError(error)}`) }
  return jsonValue(value, 'HTTP request')
}

function requireMutationToken(request: Request, configured: string | undefined): void {
  if (configured === undefined || configured === '') throw new RpRegistryServerError('Registry mutations are disabled', 'READ_ONLY')
  const authorization = request.headers.get('authorization')
  if (authorization === null || !authorization.startsWith('Bearer ')
    || !timingSafeText(authorization.slice(7), configured)) {
    throw new RpRegistryServerError('Registry mutation token is invalid', 'AUTH')
  }
}

function timingSafeText(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}

function timingSafeBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return timingSafeEqual(left, right)
}

function fetchBody(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer
}

function canonicalBase64(value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string' || value === '' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw invalid(`${label} must be canonical base64`)
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) throw invalid(`${label} must be canonical base64`)
  return new Uint8Array(decoded)
}

function decodePath(value: string): string {
  try { return decodeURIComponent(value) }
  catch { throw invalid('Registry path contains invalid percent encoding') }
}

function parseJson(source: string, label: string): JsonValue {
  let value: unknown
  try { value = JSON.parse(source) }
  catch (error: unknown) { throw corrupt(`${label} is invalid JSON: ${renderError(error)}`) }
  return jsonValue(value, label)
}

function jsonValue(value: unknown, label: string): JsonValue {
  if (!isJsonValue(value)) throw invalid(`${label} must contain finite JSON data`)
  return structuredClone(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return typeof value === 'object' && Object.values(value).every(isJsonValue)
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(`${label} must be an object`)
  return value as Record<string, unknown>
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const accepted = new Set(allowed)
  const unknown = Object.keys(record).find(key => !accepted.has(key))
  if (unknown !== undefined) throw invalid(`${label} contains unknown field ${JSON.stringify(unknown)}`)
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalid(`${label} must be a string`)
  return value
}

function nonEmpty(value: unknown, label: string): string {
  const result = stringValue(value, label)
  if (result.trim() === '') throw invalid(`${label} must be non-empty`)
  return result
}

function exactVersion(value: unknown): string {
  const version = nonEmpty(value, 'version')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) throw invalid('version must be exact SemVer')
  return version
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw corrupt(`${label} must be a non-negative timestamp`)
  return value
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalid(`${label} must be a positive safe integer`)
  return value
}

function compareVersions(left: string, right: string): number {
  const [leftCore = '', leftPre] = left.split('-', 2)
  const [rightCore = '', rightPre] = right.split('-', 2)
  const leftParts = leftCore.split('.').map(Number)
  const rightParts = rightCore.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (leftPre === undefined && rightPre !== undefined) return 1
  if (leftPre !== undefined && rightPre === undefined) return -1
  const leftIdentifiers = (leftPre ?? '').split('.')
  const rightIdentifiers = (rightPre ?? '').split('.')
  const length = Math.max(leftIdentifiers.length, rightIdentifiers.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftIdentifiers[index]
    const rightIdentifier = rightIdentifiers[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    const difference = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier)
    if (difference !== 0) return difference
  }
  return 0
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  if (left === right) return 0
  const leftNumeric = /^\d+$/u.test(left)
  const rightNumeric = /^\d+$/u.test(right)
  if (leftNumeric && !rightNumeric) return -1
  if (!leftNumeric && rightNumeric) return 1
  if (!leftNumeric) return left.localeCompare(right)
  const normalizedLeft = left.replace(/^0+/u, '') || '0'
  const normalizedRight = right.replace(/^0+/u, '') || '0'
  return normalizedLeft.length - normalizedRight.length || normalizedLeft.localeCompare(normalizedRight)
}

function renderJson(value: unknown): string {
  return `${JSON.stringify(value, undefined, 2)}\n`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] as string)
}

function normalizeError(error: unknown): RpRegistryServerError {
  if (error instanceof RpRegistryServerError) return error
  return corrupt(renderError(error))
}

function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusFor(code: RpRegistryServerErrorCode): number {
  if (code === 'AUTH') return 401
  if (code === 'READ_ONLY') return 403
  if (code === 'NOT_FOUND') return 404
  if (code === 'CONFLICT') return 409
  if (code === 'REVOKED') return 410
  if (code === 'INVALID') return 400
  if (code === 'INTEGRITY') return 422
  return 500
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory() }
  catch (error: unknown) {
    if (isMissing(error)) return false
    throw error
  }
}

function invalid(message: string): RpRegistryServerError { return new RpRegistryServerError(message, 'INVALID') }
function conflict(message: string): RpRegistryServerError { return new RpRegistryServerError(message, 'CONFLICT') }
function corrupt(message: string): RpRegistryServerError { return new RpRegistryServerError(message, 'CORRUPT') }
function integrity(message: string): RpRegistryServerError { return new RpRegistryServerError(message, 'INTEGRITY') }
function notFound(message: string): RpRegistryServerError { return new RpRegistryServerError(message, 'NOT_FOUND') }
function revoked(message: string): RpRegistryServerError { return new RpRegistryServerError(message, 'REVOKED') }
