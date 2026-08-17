/** Allowlisted inert package-evidence acquisition for the RP Registry. @module @dsh-rp/registry-sources */
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  RpPackageSource,
  RpPackageSourceProvider,
  RpResolvedPackage,
} from '@dsh-rp/registry'
import { RpRegistryError } from '@dsh-rp/registry'
import type { JsonValue } from '@dsh-rp/contracts'
import { extractRpNpmReleaseEnvelope } from '@dsh-rp/package-runtime'

const MANIFEST = 'rp.package.json'
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_SBOM_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const PAYLOAD = 'rp.package.tgz'
const SBOM = 'rp.sbom.json'

/** Filesystem and network authority for inert package-evidence acquisition. */
export interface Config {
  /** Canonical filesystem roots from which local manifests may be read. */
  localRoots?: string[]
  /** Exact HTTPS hosts allowed for GitHub or GitLab raw manifests. */
  gitHosts?: string[]
  /** Exact npm Registry origins allowed for package metadata. */
  npmRegistries?: string[]
  /** Exact HTTPS origins allowed for open Registry manifest endpoints. */
  registryOrigins?: string[]
  /** Maximum accepted package archive size after download. */
  maxArtifactBytes?: number
}

type ResolvedConfig = Required<Config>

export const Config: z<Config> = z.object({
  localRoots: z.array(z.string()).default([]),
  gitHosts: z.array(z.string()).default([]),
  npmRegistries: z.array(z.string()).default([]),
  registryOrigins: z.array(z.string()).default([]),
  maxArtifactBytes: z.number().step(1).min(1).max(512 * 1024 * 1024).default(DEFAULT_MAX_ARTIFACT_BYTES),
})

/**
 * Create all four inert source Providers with one explicit authority policy.
 * @param config - Filesystem and network authority allowlists.
 * @returns Frozen local, Git, npm, and Registry Provider collection.
 */
export function createRegistrySourceProviders(config: Config): readonly RpPackageSourceProvider[] {
  const resolved = normalizeConfig(config)
  return Object.freeze([
    localProvider(resolved),
    gitProvider(resolved),
    npmProvider(resolved),
    registryProvider(resolved),
  ])
}

function localProvider(config: ResolvedConfig): RpPackageSourceProvider {
  return {
    kind: 'local',
    async resolve(source): Promise<RpResolvedPackage> {
      if (config.localRoots.length === 0) throw denied('Local RP package access is disabled')
      const requested = resolve(source.locator)
      const target = (await stat(requested)).isDirectory() ? join(requested, MANIFEST) : requested
      const canonical = await realpath(target)
      const permitted = await Promise.all(config.localRoots.map(async root => await realpath(resolve(root))))
      if (!permitted.some(root => within(root, canonical))) throw denied(`Local RP manifest ${canonical} is outside allowed roots`)
      const manifest = await readManifestFile(canonical)
      const evidence = await localEvidence(manifest, dirname(canonical), config.maxArtifactBytes, permitted)
      return Object.freeze({ manifest, source: freezeSource(source), ...evidence })
    },
  }
}

function gitProvider(config: ResolvedConfig): RpPackageSourceProvider {
  return {
    kind: 'git',
    async resolve(source, signal): Promise<RpResolvedPackage> {
      const url = gitManifestUrl(source, config.gitHosts)
      const manifest = await fetchJson(url, signal)
      const evidence = await remoteEvidence(manifest, {
        payload: new URL(PAYLOAD, url),
        sbom: new URL(SBOM, url),
      }, config.maxArtifactBytes, signal)
      return Object.freeze({ manifest, source: freezeSource(source), ...evidence })
    },
  }
}

function npmProvider(config: ResolvedConfig): RpPackageSourceProvider {
  return {
    kind: 'npm',
    async resolve(source, signal): Promise<RpResolvedPackage> {
      if (source.ref === undefined || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(source.ref)) {
        throw invalid('npm RP package sources require an exact SemVer ref')
      }
      if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(source.locator)) {
        throw invalid('npm RP package locator must be a normalized package name')
      }
      const origin = requireOrigin(config.npmRegistries, 'npm Registry')
      const packagePath = source.locator.startsWith('@')
        ? source.locator.replace('/', '%2F')
        : source.locator
      const metadata = await fetchJson(new URL(packagePath, `${origin}/`), signal)
      if (!isRecord(metadata.versions)) throw invalid('npm metadata has no versions map')
      const release = metadata.versions[source.ref]
      if (!isRecord(release) || !isRecord(release.dshRp)) {
        throw invalid(`npm ${source.locator}@${source.ref} has no embedded dshRp manifest`)
      }
      const flags = evidenceFlags(release.dshRp)
      let bytes: Uint8Array | undefined
      let sbom: JsonValue | undefined
      if (flags.payload) {
        if (!isRecord(release.dist) || typeof release.dist.tarball !== 'string') {
          throw invalid(`npm ${source.locator}@${source.ref} has no dist.tarball for its integrity-bound payload`)
        }
        const tarball = requireAllowedUrl(release.dist.tarball, [origin], 'npm tarball')
        const tarballBytes = await fetchBytes(tarball, config.maxArtifactBytes, signal)
        const envelope = await extractRpNpmReleaseEnvelope(tarballBytes, release.dshRp, {
          maxUnpackedBytes: config.maxArtifactBytes + MAX_MANIFEST_BYTES + MAX_SBOM_BYTES + 1024 * 1024,
          maxFiles: 64,
          maxFileBytes: Math.max(config.maxArtifactBytes, MAX_SBOM_BYTES),
        })
        bytes = envelope.archive
        sbom = envelope.sbom
      }
      if (flags.sbom && sbom === undefined) throw invalid(`npm ${source.locator}@${source.ref} envelope has no RP SBOM`)
      return Object.freeze({
        manifest: release.dshRp,
        source: freezeSource(source),
        ...(bytes === undefined ? {} : { bytes }),
        ...(sbom === undefined ? {} : { sbom }),
      })
    },
  }
}

function registryProvider(config: ResolvedConfig): RpPackageSourceProvider {
  return {
    kind: 'registry',
    async resolve(source, signal): Promise<RpResolvedPackage> {
      const url = requireAllowedUrl(source.locator, config.registryOrigins, 'RP Registry')
      const value = await fetchJson(url, signal)
      const manifest = isRecord(value.manifest) ? value.manifest : value
      const flags = evidenceFlags(manifest)
      let bytes: Uint8Array | undefined
      if (flags.payload) {
        if (typeof value.payloadUrl !== 'string') throw invalid('RP Registry response has no payloadUrl')
        bytes = await fetchBytes(
          requireAllowedUrl(value.payloadUrl, config.registryOrigins, 'RP Registry payload'),
          config.maxArtifactBytes,
          signal,
        )
      }
      let sbom: JsonValue | undefined
      if (flags.sbom) {
        if (value.sbom !== undefined) sbom = requireJsonValue(value.sbom, 'RP Registry SBOM')
        else if (typeof value.sbomUrl === 'string') {
          sbom = await fetchJsonValue(
            requireAllowedUrl(value.sbomUrl, config.registryOrigins, 'RP Registry SBOM'),
            MAX_SBOM_BYTES,
            signal,
          )
        } else throw invalid('RP Registry response has no SBOM or sbomUrl')
      }
      return Object.freeze({
        manifest,
        source: freezeSource(source),
        ...(bytes === undefined ? {} : { bytes }),
        ...(sbom === undefined ? {} : { sbom }),
      })
    },
  }
}

/**
 * Resolve a supported GitHub or GitLab repository URL to one raw manifest URL.
 * @param source - Pinned Git package source.
 * @param allowedHosts - Exact authorized repository hosts.
 * @returns Clean-room raw manifest URL.
 */
export function gitManifestUrl(source: RpPackageSource, allowedHosts: readonly string[]): URL {
  if (source.ref === undefined || source.ref.trim() === '') throw invalid('Git RP package sources require an exact ref')
  const repository = requireAllowedUrl(source.locator, allowedHosts.map(host => `https://${host}`), 'Git')
  const segments = repository.pathname.replace(/\.git$/u, '').split('/').filter(Boolean)
  if (segments.length !== 2) throw invalid('Git RP package URL must identify exactly one owner/repository')
  const [owner, repo] = segments
  if (owner === undefined || repo === undefined) throw invalid('Git RP package URL is incomplete')
  const path = source.ref.split('/').map(encodeURIComponent).join('/')
  if (repository.hostname === 'github.com') {
    return new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${path}/${MANIFEST}`)
  }
  if (repository.hostname === 'gitlab.com') {
    return new URL(`https://gitlab.com/${owner}/${repo}/-/raw/${path}/${MANIFEST}`)
  }
  throw denied(`Git host ${repository.hostname} has no clean-room raw manifest adapter`)
}

async function readManifestFile(path: string): Promise<Record<string, unknown>> {
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) throw invalid('Local RP manifest must be a bounded regular file')
  return parseObject(await readFile(path, 'utf8'), path)
}

async function localEvidence(
  manifest: Record<string, unknown>,
  directory: string,
  maxArtifactBytes: number,
  permittedRoots: readonly string[],
): Promise<Pick<RpResolvedPackage, 'bytes' | 'sbom'>> {
  const flags = evidenceFlags(manifest)
  return {
    ...(flags.payload ? { bytes: await readBoundedFile(join(directory, PAYLOAD), maxArtifactBytes, permittedRoots) } : {}),
    ...(flags.sbom ? { sbom: await readJsonValue(join(directory, SBOM), MAX_SBOM_BYTES, permittedRoots) } : {}),
  }
}

async function remoteEvidence(
  manifest: Record<string, unknown>,
  urls: { readonly payload: URL; readonly sbom: URL },
  maxArtifactBytes: number,
  signal?: AbortSignal,
): Promise<Pick<RpResolvedPackage, 'bytes' | 'sbom'>> {
  const flags = evidenceFlags(manifest)
  return {
    ...(flags.payload ? { bytes: await fetchBytes(urls.payload, maxArtifactBytes, signal) } : {}),
    ...(flags.sbom ? { sbom: await fetchJsonValue(urls.sbom, MAX_SBOM_BYTES, signal) } : {}),
  }
}

function evidenceFlags(manifest: Record<string, unknown>): { readonly payload: boolean; readonly sbom: boolean } {
  const integrity = isRecord(manifest.integrity) ? manifest.integrity : undefined
  return { payload: typeof integrity?.sha256 === 'string', sbom: typeof integrity?.sbom === 'string' }
}

async function readBoundedFile(
  path: string,
  maxBytes: number,
  permittedRoots?: readonly string[],
): Promise<Uint8Array> {
  const canonical = await realpath(path)
  if (permittedRoots !== undefined && !permittedRoots.some(root => within(root, canonical))) {
    throw denied(`Local RP evidence ${canonical} is outside allowed roots`)
  }
  const info = await stat(canonical)
  if (!info.isFile() || info.size > maxBytes) throw invalid(`${canonical} must be a bounded regular file`)
  return new Uint8Array(await readFile(canonical))
}

async function readJsonValue(path: string, maxBytes: number, permittedRoots?: readonly string[]): Promise<JsonValue> {
  const bytes = await readBoundedFile(path, maxBytes, permittedRoots)
  return parseJsonValue(new TextDecoder('utf-8', { fatal: true }).decode(bytes), path)
}

async function fetchJson(url: URL, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const value = await fetchJsonValue(url, MAX_MANIFEST_BYTES, signal)
  if (!isRecord(value)) throw invalid(`${url.href} must contain a JSON object`)
  return value
}

async function fetchJsonValue(url: URL, maxBytes: number, signal?: AbortSignal): Promise<JsonValue> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw invalid(`Manifest request failed with HTTP ${response.status}`)
  const bytes = await readResponseBytes(response, maxBytes, 'Remote RP JSON')
  return parseJsonValue(new TextDecoder('utf-8', { fatal: true }).decode(bytes), url.href)
}

async function fetchBytes(url: URL, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: 'error', ...(signal === undefined ? {} : { signal }) })
  if (!response.ok) throw invalid(`Package request failed with HTTP ${response.status}`)
  return await readResponseBytes(response, maxBytes, 'Remote RP package')
}

async function readResponseBytes(response: Response, maxBytes: number, label: string): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes) throw invalid(`${label} exceeds the size limit`)
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw invalid(`${label} exceeds the size limit`)
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function parseObject(source: string, label: string): Record<string, unknown> {
  const value = parseJsonValue(source, label)
  if (!isRecord(value)) throw invalid(`${label} must contain a JSON object`)
  return value
}

function parseJsonValue(source: string, label: string): JsonValue {
  const value: unknown = JSON.parse(source)
  return requireJsonValue(value, label)
}

function requireJsonValue(value: unknown, label: string): JsonValue {
  if (!isJsonValue(value)) throw invalid(`${label} must contain JSON data`)
  return value
}

function requireOrigin(origins: readonly string[], label: string): string {
  if (origins.length !== 1) throw denied(`${label} requires exactly one configured origin`)
  return requireAllowedUrl(origins[0] as string, origins, label).origin
}

function requireAllowedUrl(value: string, origins: readonly string[], label: string): URL {
  const url = new URL(value)
  const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (url.protocol !== 'https:' && !loopback) throw denied(`${label} URL must use HTTPS`)
  const allowed = new Set(origins.map(item => new URL(item).origin))
  if (!allowed.has(url.origin)) throw denied(`${label} origin ${url.origin} is not allowed`)
  if (url.username !== '' || url.password !== '') throw denied(`${label} URL must not contain credentials`)
  return url
}

function normalizeConfig(config: Config): ResolvedConfig {
  return {
    localRoots: [...new Set(config.localRoots ?? [])],
    gitHosts: [...new Set(config.gitHosts ?? [])],
    npmRegistries: [...new Set(config.npmRegistries ?? [])],
    registryOrigins: [...new Set(config.registryOrigins ?? [])],
    maxArtifactBytes: config.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES,
  }
}

function within(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function freezeSource(source: RpPackageSource): RpPackageSource {
  return Object.freeze({ ...source })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function invalid(message: string): RpRegistryError {
  return new RpRegistryError(message, 'INVALID')
}

function denied(message: string): RpRegistryError {
  return new RpRegistryError(message, 'NO_PROVIDER')
}

export const name = 'rp-registry-sources'
export const inject = ['rpRegistry']
export function apply(ctx: Context, config: Config): void {
  for (const provider of createRegistrySourceProviders(config)) {
    ctx.effect(() => ctx.rpRegistry.registerProvider(provider))
  }
}
