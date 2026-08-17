/** Strict RP runtime descriptor and bounded tar-gzip reader. @module @dsh-rp/package-runtime */
import { Buffer } from 'node:buffer'
import { createGunzip, gzipSync } from 'node:zlib'
import { Readable, Transform } from 'node:stream'
import type { Headers } from 'tar-stream'
import { extract, pack } from 'tar-stream'
import { parse } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import type {
  JsonObject,
  JsonValue,
  RpBudget,
  RpCapabilityId,
  RpComponentId,
  RpPackageManifest,
  RpPipelineId,
  RpScopeKind,
  RpTrustLevel,
  RpUiSlotManifest,
} from '@dsh-rp/contracts'
import {
  RpCapabilityId as capabilityId,
  RpComponentId as componentId,
  RpPipelineId as pipelineId,
} from '@dsh-rp/contracts'

/** Manifest compatibility value selecting the version-one runtime descriptor. */
export const RP_RUNTIME_V1 = 'dsh-rp-runtime-v1'
/** Required descriptor path inside a runtime archive. */
export const RP_RUNTIME_DESCRIPTOR = 'rp.runtime.json'
/** Registry-compatible runtime archive filename. */
export const RP_PACKAGE_ARCHIVE = 'rp.package.tgz'
/** Registry-compatible SBOM filename. */
export const RP_PACKAGE_SBOM = 'rp.sbom.json'

/** Deployment-owned extraction ceilings. */
export interface RpRuntimeArchiveLimits {
  readonly maxUnpackedBytes: number
  readonly maxFiles: number
  readonly maxFileBytes: number
}

/** One dependency declared by a runtime component. */
export interface RpRuntimeComponentDependency {
  readonly id: RpComponentId
  readonly version?: string
  readonly optional?: boolean
}

/** Component metadata contributed when a package activates. */
export interface RpRuntimeComponentSpec {
  readonly id: RpComponentId
  readonly scopes: readonly RpScopeKind[]
  readonly dependencies?: readonly RpRuntimeComponentDependency[]
  readonly provides?: readonly string[]
  readonly requires?: readonly string[]
}

/** Executable implementation selected by package trust. */
export type RpRuntimeImplementation =
  | { readonly kind: 'expression'; readonly expression: JsonValue }
  | { readonly kind: 'quickjs'; readonly path: string }
  | { readonly kind: 'wasm'; readonly path: string; readonly export: string }
  | { readonly kind: 'native'; readonly path: string }

/** Capability metadata and optional implementation contributed on activation. */
export interface RpRuntimeCapabilitySpec {
  readonly id: RpCapabilityId
  readonly kind: 'tool' | 'skill' | 'subagent' | 'agent' | 'pipeline' | 'memory' | 'lore' | 'media' | 'rules'
  readonly title: string
  readonly description: string
  readonly scopes: readonly RpScopeKind[]
  readonly permissions?: readonly string[]
  readonly budget?: RpBudget
  readonly inputSchema?: JsonObject
  readonly outputSchema?: JsonObject
  readonly tags?: readonly string[]
  readonly implementation?: RpRuntimeImplementation
}

/** Declarative operation accepted in an installable Pipeline stage. */
export type RpRuntimePipelineStageOperation =
  | {
    readonly kind: 'invoke-capability'
    readonly capabilityId: string
    readonly inputKey?: string
    readonly grantedPermissions?: readonly string[]
    readonly grantedTrust?: RpTrustLevel
  }
  | { readonly kind: 'invoke-pipeline'; readonly pipelineId: RpPipelineId; readonly inputKey?: string }
  | { readonly kind: 'conditional'; readonly valueKey: string; readonly equals: JsonValue }

/** One code-free DAG stage routed through the canonical Pipeline Runtime. */
export interface RpRuntimePipelineStageSpec {
  readonly id: string
  readonly operation: RpRuntimePipelineStageOperation
  readonly after?: readonly string[]
  readonly before?: readonly string[]
  readonly timeoutMs?: number
  readonly retries?: number
  readonly failure?: 'fatal' | 'continue'
}

/** Named Pipeline graph contributed by an installable package. */
export interface RpRuntimePipelineSpec {
  readonly id: RpPipelineId
  readonly kind: 'turn' | 'workflow' | 'sidecar'
  readonly description: string
  readonly stages: readonly RpRuntimePipelineStageSpec[]
  readonly budget?: RpBudget
}

/** Versioned runtime descriptor stored in an integrity-bound archive. */
export interface RpRuntimeDescriptor {
  readonly schemaVersion: 1
  readonly components: readonly RpRuntimeComponentSpec[]
  readonly capabilities: readonly RpRuntimeCapabilitySpec[]
  /** Graphs whose ids exactly match discovery entries with capability kind `pipeline`. */
  readonly pipelines?: readonly RpRuntimePipelineSpec[]
  /** Opaque-origin package UI contributions; files are integrity-bound archive assets. */
  readonly uiSlots?: readonly RpUiSlotManifest[]
}

/** Immutable archive view which returns detached file bytes. */
export interface RpRuntimeArchive {
  readonly descriptor: RpRuntimeDescriptor
  readonly files: readonly string[]
  bytes(path: string): Uint8Array
  text(path: string): string
}

/** One inert file included in a deterministic runtime archive. */
export interface RpRuntimeArchiveFile {
  /** Safe POSIX-style path relative to the package root. */
  readonly path: string
  /** Exact file bytes; callers retain ownership of their input Buffer. */
  readonly bytes: Uint8Array
}

/** Complete input for the deterministic runtime archive writer. */
export interface RpRuntimeArchiveInput {
  readonly descriptor: RpRuntimeDescriptor
  readonly files?: readonly RpRuntimeArchiveFile[]
}

/** Inner evidence extracted from a bounded npm distribution tarball. */
export interface RpNpmReleaseEnvelope {
  readonly archive: Uint8Array
  readonly sbom?: JsonValue
}

/**
 * Create a minimal deterministic npm tarball containing an embedded RP release envelope.
 * @param manifest - Final integrity-bound Manifest exposed as npm `dshRp` metadata.
 * @param archive - Inner `rp.package.tgz` bytes bound by the Manifest SHA-256.
 * @param sbom - Optional SBOM bound by the Manifest.
 * @param limits - Outer tar extraction ceilings used for mandatory self-verification.
 * @returns Byte-stable npm tarball suitable for `npm publish <tarball>`.
 */
export async function createRpNpmReleaseEnvelope(
  manifest: RpPackageManifest,
  archive: Uint8Array,
  sbom: JsonValue | undefined,
  limits: RpRuntimeArchiveLimits,
): Promise<Uint8Array> {
  validateLimits(limits)
  if (archive.byteLength > limits.maxFileBytes) throw limitError(`${RP_PACKAGE_ARCHIVE} exceeds ${limits.maxFileBytes} bytes`)
  const packageMetadata = {
    name: String(manifest.id),
    version: manifest.version,
    type: 'module',
    license: 'MIT',
    files: sbom === undefined ? [RP_PACKAGE_ARCHIVE] : [RP_PACKAGE_ARCHIVE, RP_PACKAGE_SBOM],
    dshRp: manifest,
  } as unknown as JsonValue
  const packageJson = new TextEncoder().encode(`${canonicalJson(packageMetadata)}\n`)
  const entries: RpRuntimeArchiveFile[] = [
    { path: 'package/package.json', bytes: packageJson },
    { path: `package/${RP_PACKAGE_ARCHIVE}`, bytes: archive },
  ]
  if (sbom !== undefined) {
    if (!isJsonValue(sbom)) throw archiveError('npm RP SBOM must contain finite JSON data')
    entries.push({
      path: `package/${RP_PACKAGE_SBOM}`,
      bytes: new TextEncoder().encode(`${canonicalJson(sbom)}\n`),
    })
  }
  const normalized = normalizeWriterFiles(entries, limits, false)
  const tar = pack()
  const chunks: Buffer[] = []
  const completed = new Promise<Buffer>((resolve, reject) => {
    tar.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    tar.on('error', reject)
    tar.on('end', () => { resolve(Buffer.concat(chunks)) })
  })
  for (const entry of normalized) await writeTarEntry(tar, entry.path, entry.bytes)
  tar.finalize()
  const result = new Uint8Array(gzipSync(await completed, { level: 9 }))
  await extractRpNpmReleaseEnvelope(result, manifest, limits)
  return result
}

/** Runtime archive validation failure. */
export class RpRuntimePackageError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_ARCHIVE' | 'LIMIT' | 'INVALID_DESCRIPTOR' | 'DECLARATION_MISMATCH' | 'TRUST',
  ) {
    super(message)
    this.name = 'RpRuntimePackageError'
  }
}

/**
 * Create a deterministic tar-gzip archive and verify it through the same strict reader used at install time.
 * @param input - Runtime descriptor and detached implementation or asset bytes.
 * @param manifest - Manifest whose declarations and trust level must match the descriptor.
 * @param limits - Deployment-compatible archive ceilings used for the mandatory round trip.
 * @returns Stable gzip bytes; equal semantic input produces byte-identical output.
 */
export async function createRpRuntimeArchive(
  input: RpRuntimeArchiveInput,
  manifest: RpPackageManifest,
  limits: RpRuntimeArchiveLimits,
): Promise<Uint8Array> {
  validateLimits(limits)
  if (!isJsonValue(input.descriptor)) throw descriptorError('Runtime descriptor must contain finite JSON data')
  const files = normalizeWriterFiles(input.files ?? [], limits)
  const descriptor = new TextEncoder().encode(`${canonicalJson(input.descriptor)}\n`)
  if (descriptor.byteLength > limits.maxFileBytes) {
    throw limitError(`${RP_RUNTIME_DESCRIPTOR} exceeds ${limits.maxFileBytes} bytes`)
  }
  const archive = pack()
  const chunks: Buffer[] = []
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    archive.on('error', reject)
    archive.on('end', () => { resolve(Buffer.concat(chunks)) })
  })
  await writeTarEntry(archive, RP_RUNTIME_DESCRIPTOR, descriptor)
  for (const file of files) await writeTarEntry(archive, file.path, file.bytes)
  archive.finalize()
  let result: Uint8Array
  try {
    result = new Uint8Array(gzipSync(await completed, { level: 9 }))
  } catch (error: unknown) {
    throw archiveError(`Could not create runtime archive: ${renderError(error)}`)
  }
  await parseRpRuntimeArchive(result, manifest, limits)
  return result
}

/**
 * Extract the integrity-bound inner RP release from an npm tarball without loading package code.
 * @param payload - Exact npm Registry `dist.tarball` bytes.
 * @param manifest - Validated Manifest expected in the tarball's package metadata.
 * @param limits - Outer tar extraction ceilings.
 * @returns Detached inner runtime archive and optional SBOM.
 */
export async function extractRpNpmReleaseEnvelope(
  payload: Uint8Array,
  manifest: unknown,
  limits: RpRuntimeArchiveLimits,
): Promise<RpNpmReleaseEnvelope> {
  validateLimits(limits)
  if (!isJsonValue(manifest)) throw mismatch('npm Registry dshRp metadata is not finite JSON data')
  const files = normalizeNpmPrefix(await readTarGzip(payload, limits))
  const archive = files.get(RP_PACKAGE_ARCHIVE)
  if (archive === undefined) throw archiveError(`npm RP release has no ${RP_PACKAGE_ARCHIVE}`)
  const packageJson = files.get('package.json')
  if (packageJson === undefined) throw archiveError('npm RP release has no package.json')
  let metadata: unknown
  try { metadata = JSON.parse(decodeText(packageJson, 'package.json')) }
  catch (error: unknown) { throw archiveError(`npm package.json is invalid JSON: ${renderError(error)}`) }
  if (!isRecord(metadata) || !isJsonValue(metadata.dshRp)
    || canonicalJson(metadata.dshRp) !== canonicalJson(manifest)) {
    throw mismatch('npm package.json dshRp does not match Registry metadata')
  }
  const sbomBytes = files.get(RP_PACKAGE_SBOM)
  let sbom: JsonValue | undefined
  if (sbomBytes !== undefined) {
    let value: unknown
    try { value = JSON.parse(decodeText(sbomBytes, RP_PACKAGE_SBOM)) }
    catch (error: unknown) { throw archiveError(`${RP_PACKAGE_SBOM} is invalid JSON: ${renderError(error)}`) }
    if (!isJsonValue(value)) throw archiveError(`${RP_PACKAGE_SBOM} must contain finite JSON data`)
    sbom = freezeJson(structuredClone(value))
  }
  return Object.freeze({ archive: archive.slice(), ...(sbom === undefined ? {} : { sbom }) })
}

function normalizeWriterFiles(
  input: readonly RpRuntimeArchiveFile[],
  limits: RpRuntimeArchiveLimits,
  reserveDescriptor = true,
): readonly RpRuntimeArchiveFile[] {
  if (input.length + (reserveDescriptor ? 1 : 0) > limits.maxFiles) {
    throw limitError(`Runtime archive contains more than ${limits.maxFiles} files`)
  }
  const seen = new Set<string>(reserveDescriptor ? [RP_RUNTIME_DESCRIPTOR] : [])
  const files = input.map((file) => {
    const path = safePath(file.path, 'Runtime file')
    if (seen.has(path)) throw archiveError(`Runtime archive contains duplicate path ${JSON.stringify(path)}`)
    seen.add(path)
    if (!(file.bytes instanceof Uint8Array)) {
      throw archiveError(`Runtime file ${JSON.stringify(path)} bytes must be a Uint8Array`)
    }
    if (file.bytes.byteLength > limits.maxFileBytes) {
      throw limitError(`Runtime file ${JSON.stringify(path)} exceeds ${limits.maxFileBytes} bytes`)
    }
    return Object.freeze({ path, bytes: Uint8Array.from(file.bytes) })
  })
  return Object.freeze(files.sort((left, right) => left.path.localeCompare(right.path)))
}

async function writeTarEntry(
  archive: ReturnType<typeof pack>,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    archive.entry({
      name: path,
      type: 'file',
      size: bytes.byteLength,
      mode: 0o644,
      mtime: new Date(0),
      uid: 0,
      gid: 0,
      uname: '',
      gname: '',
    }, Buffer.from(bytes), (error?: Error | null) => {
      if (error === undefined || error === null) resolve()
      else reject(error)
    })
  })
}

/**
 * Read one bounded tar-gzip archive and validate its runtime descriptor against the signed Manifest.
 * @param payload - Integrity-verified package archive bytes.
 * @param manifest - Validated package Manifest owning all public declarations.
 * @param limits - Deployment extraction ceilings.
 * @returns Immutable descriptor and detached file accessors.
 */
export async function parseRpRuntimeArchive(
  payload: Uint8Array,
  manifest: RpPackageManifest,
  limits: RpRuntimeArchiveLimits,
): Promise<RpRuntimeArchive> {
  validateLimits(limits)
  if (manifest.compatibility?.runtime !== RP_RUNTIME_V1) {
    throw descriptorError(`Package ${String(manifest.id)} does not declare runtime ${RP_RUNTIME_V1}`)
  }
  const files = await readTarGzip(payload, limits)
  const normalized = normalizeNpmPrefix(files)
  const descriptorBytes = normalized.get(RP_RUNTIME_DESCRIPTOR)
  if (descriptorBytes === undefined) throw descriptorError(`Runtime archive has no ${RP_RUNTIME_DESCRIPTOR}`)
  const descriptor = parseDescriptor(decodeText(descriptorBytes, RP_RUNTIME_DESCRIPTOR), normalized)
  assertManifestDeclarations(descriptor, manifest)
  assertTrustImplementations(descriptor, manifest)
  for (const asset of manifest.assets ?? []) {
    const path = safePath(asset, 'Manifest asset')
    if (!normalized.has(path)) throw descriptorError(`Manifest asset ${JSON.stringify(path)} is absent from the archive`)
  }
  const names = Object.freeze([...normalized.keys()].sort())
  return Object.freeze({
    descriptor,
    files: names,
    bytes(path: string): Uint8Array {
      const normalizedPath = safePath(path, 'Runtime file')
      const value = normalized.get(normalizedPath)
      if (value === undefined) throw archiveError(`Runtime file ${JSON.stringify(normalizedPath)} does not exist`)
      return value.slice()
    },
    text(path: string): string {
      const normalizedPath = safePath(path, 'Runtime file')
      const value = normalized.get(normalizedPath)
      if (value === undefined) throw archiveError(`Runtime file ${JSON.stringify(normalizedPath)} does not exist`)
      return decodeText(value, normalizedPath)
    },
  })
}

async function readTarGzip(
  payload: Uint8Array,
  limits: RpRuntimeArchiveLimits,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  let fileCount = 0
  let unpackedBytes = 0
  const source = Readable.from([payload])
  const gunzip = createGunzip()
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      unpackedBytes += chunk.byteLength
      callback(unpackedBytes > limits.maxUnpackedBytes
        ? limitError(`Runtime archive expands beyond ${limits.maxUnpackedBytes} bytes`)
        : null, chunk)
    },
  })
  const reader = extract()
  let settled = false
  const completion = new Promise<void>((resolve, reject) => {
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      const failure = error instanceof RpRuntimePackageError
        ? error
        : archiveError(renderError(error))
      source.destroy()
      gunzip.destroy()
      limiter.destroy()
      reader.destroy()
      reject(failure)
    }
    reader.on('entry', (header: Headers, stream, next) => {
      try {
        const path = safePath(header.name.replace(/\/$/u, ''), 'Archive entry')
        if (header.type === 'directory') {
          stream.on('error', fail)
          stream.on('end', next)
          stream.resume()
          return
        }
        if (header.type !== 'file') throw archiveError(`Archive entry ${JSON.stringify(path)} has forbidden type ${header.type}`)
        fileCount += 1
        if (fileCount > limits.maxFiles) throw limitError(`Runtime archive contains more than ${limits.maxFiles} files`)
        if (files.has(path)) throw archiveError(`Runtime archive contains duplicate path ${JSON.stringify(path)}`)
        if (!Number.isSafeInteger(header.size) || (header.size ?? -1) < 0) {
          throw archiveError(`Runtime file ${JSON.stringify(path)} has an invalid tar size`)
        }
        const expectedSize = header.size as number
        if (expectedSize > limits.maxFileBytes) {
          throw limitError(`Runtime file ${JSON.stringify(path)} exceeds ${limits.maxFileBytes} bytes`)
        }
        const chunks: Buffer[] = []
        let size = 0
        stream.on('data', (chunk: Buffer) => {
          size += chunk.byteLength
          if (size > limits.maxFileBytes) {
            fail(limitError(`Runtime file ${JSON.stringify(path)} exceeds ${limits.maxFileBytes} bytes`))
            return
          }
          chunks.push(Buffer.from(chunk))
        })
        stream.on('error', fail)
        stream.on('end', () => {
          if (settled) return
          if (size !== expectedSize) {
            fail(archiveError(`Runtime file ${JSON.stringify(path)} size does not match its tar header`))
            return
          }
          files.set(path, new Uint8Array(Buffer.concat(chunks, size)))
          next()
        })
      } catch (error: unknown) {
        stream.resume()
        fail(error)
      }
    })
    for (const stream of [source, gunzip, limiter, reader]) stream.on('error', fail)
    reader.on('finish', () => {
      if (settled) return
      settled = true
      resolve()
    })
  })
  source.pipe(gunzip).pipe(limiter).pipe(reader)
  await completion
  return files
}

function normalizeNpmPrefix(files: ReadonlyMap<string, Uint8Array>): ReadonlyMap<string, Uint8Array> {
  return files.size > 0 && [...files.keys()].every(path => path.startsWith('package/'))
    ? new Map([...files].map(([path, bytes]) => [path.slice('package/'.length), bytes]))
    : files
}

function parseDescriptor(source: string, files: ReadonlyMap<string, Uint8Array>): RpRuntimeDescriptor {
  let value: unknown
  try { value = JSON.parse(source) }
  catch (error: unknown) { throw descriptorError(`${RP_RUNTIME_DESCRIPTOR} is invalid JSON: ${renderError(error)}`) }
  const record = strictRecord(value, ['schemaVersion', 'components', 'capabilities', 'pipelines', 'uiSlots'], 'Runtime descriptor')
  if (record.schemaVersion !== 1 || !Array.isArray(record.components) || !Array.isArray(record.capabilities)) {
    throw descriptorError('Runtime descriptor requires schemaVersion 1, components, and capabilities')
  }
  const components = Object.freeze(record.components.map((item, index) => parseComponent(item, index)))
  const capabilities = Object.freeze(record.capabilities.map((item, index) => parseCapability(item, index, files)))
  const pipelines = record.pipelines === undefined
    ? undefined
    : Object.freeze(arrayOf(record.pipelines, 'Runtime descriptor pipelines').map(parsePipeline))
  const uiSlots = record.uiSlots === undefined
    ? undefined
    : Object.freeze(arrayOf(record.uiSlots, 'Runtime descriptor uiSlots').map((item, index) => parseUiSlot(item, index, files)))
  assertUnique(components.map(item => String(item.id)), 'component')
  assertUnique(capabilities.map(item => String(item.id)), 'capability')
  if (pipelines !== undefined) assertUnique(pipelines.map(item => String(item.id)), 'pipeline')
  if (uiSlots !== undefined) assertUnique(uiSlots.map(item => item.id), 'UI Slot')
  for (const slot of uiSlots ?? []) validateUiDocuments(slot, files)
  assertPipelineDeclarations(capabilities, pipelines ?? [])
  return Object.freeze({
    schemaVersion: 1,
    components,
    capabilities,
    ...(pipelines === undefined ? {} : { pipelines }),
    ...(uiSlots === undefined ? {} : { uiSlots }),
  })
}

function parseUiSlot(
  value: unknown,
  index: number,
  files: ReadonlyMap<string, Uint8Array>,
): RpUiSlotManifest {
  const label = `Runtime UI Slot ${index}`
  const record = strictRecord(value, [
    'schemaVersion', 'id', 'title', 'placement', 'entry', 'assets', 'script', 'height',
  ], label)
  if (record.schemaVersion !== 1) throw descriptorError(`${label} requires schemaVersion 1`)
  const placement = requiredString(record.placement, `${label} placement`)
  if (!UI_SLOT_PLACEMENTS.includes(placement as RpUiSlotManifest['placement'])) {
    throw descriptorError(`${label} placement ${JSON.stringify(placement)} is unsupported`)
  }
  const script = requiredString(record.script, `${label} script`)
  if (script !== 'none' && script !== 'sandbox') throw descriptorError(`${label} script must be none or sandbox`)
  const assets = Object.freeze(stringArray(record.assets, `${label} assets`).map((path) => {
    const normalized = safePath(path, `${label} asset`)
    if (!files.has(normalized)) throw descriptorError(`${label} asset ${JSON.stringify(normalized)} is absent`)
    return normalized
  }))
  const entry = safePath(requiredString(record.entry, `${label} entry`), `${label} entry`)
  if (!entry.toLowerCase().endsWith('.html') || !assets.includes(entry)) {
    throw descriptorError(`${label} entry must be a declared .html asset`)
  }
  const height = optionalNonNegativeInteger(record.height, `${label} height`)
  if (height !== undefined && (height < 120 || height > 1600)) {
    throw descriptorError(`${label} height must be from 120 through 1600`)
  }
  return Object.freeze({
    schemaVersion: 1,
    id: uiSlotId(record.id, `${label} id`),
    title: requiredString(record.title, `${label} title`),
    placement: placement as RpUiSlotManifest['placement'],
    entry,
    assets,
    script,
    ...(height === undefined ? {} : { height }),
  })
}

type HtmlNode = DefaultTreeAdapterMap['node']
type HtmlElement = DefaultTreeAdapterMap['element']

function validateUiDocuments(slot: RpUiSlotManifest, files: ReadonlyMap<string, Uint8Array>): void {
  for (const path of slot.assets.filter(asset => asset.toLowerCase().endsWith('.html'))) {
    validateUiDocument(slot, path, files)
  }
}

function validateUiDocument(
  slot: RpUiSlotManifest,
  documentPath: string,
  files: ReadonlyMap<string, Uint8Array>,
): void {
  const source = decodeText(files.get(documentPath) as Uint8Array, `Runtime UI Slot ${slot.id} document ${documentPath}`)
  const document = parse(source, { scriptingEnabled: false })
  const assets = new Set(slot.assets)
  const visit = (node: HtmlNode): void => {
    if (isHtmlElement(node)) {
      const tag = node.tagName.toLowerCase()
      if (FORBIDDEN_UI_TAGS.has(tag)) {
        throw descriptorError(`Runtime UI Slot ${JSON.stringify(slot.id)} document ${JSON.stringify(documentPath)} contains forbidden <${tag}>`)
      }
      const attributes = new Map(node.attrs.map(attribute => [attribute.name.toLowerCase(), attribute.value]))
      for (const [name, value] of attributes) {
        if (name.startsWith('on') || FORBIDDEN_UI_ATTRIBUTES.has(name)) {
          throw descriptorError(`Runtime UI Slot ${JSON.stringify(slot.id)} document ${JSON.stringify(documentPath)} contains forbidden attribute ${JSON.stringify(name)}`)
        }
        if (UI_RESOURCE_ATTRIBUTES.has(name)) {
          validateUiReference(slot, documentPath, tag, name, value, assets)
        }
      }
      if (tag === 'meta' && attributes.has('http-equiv')) {
        throw descriptorError(`Runtime UI Slot ${JSON.stringify(slot.id)} document ${JSON.stringify(documentPath)} cannot use meta http-equiv`)
      }
      if (tag === 'link' && attributes.get('rel')?.toLowerCase() !== 'stylesheet') {
        throw descriptorError(`Runtime UI Slot ${JSON.stringify(slot.id)} document ${JSON.stringify(documentPath)} permits only stylesheet links`)
      }
    }
    for (const child of 'childNodes' in node ? node.childNodes : []) visit(child)
  }
  visit(document)
}

function validateUiReference(
  slot: RpUiSlotManifest,
  documentPath: string,
  tag: string,
  attribute: string,
  value: string,
  assets: ReadonlySet<string>,
): void {
  const references = attribute === 'srcset'
    ? value.split(',').map(candidate => candidate.trim().split(/\s+/u)[0] ?? '')
    : [value]
  for (const reference of references) {
    if (reference.startsWith('#') && tag === 'a' && attribute === 'href') continue
    if (reference === '' || reference.startsWith('/') || reference.startsWith('//') || reference.includes('\\')
      || /%(?:2f|5c)/iu.test(reference) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(reference)) {
      throw descriptorError(`Runtime UI Slot ${JSON.stringify(slot.id)} document ${JSON.stringify(documentPath)} has external or unsafe ${attribute}`)
    }
    let url: URL
    try { url = new URL(reference, `https://rp.invalid/${documentPath}`) }
    catch (error: unknown) { throw descriptorError(`Runtime UI Slot ${JSON.stringify(slot.id)} document ${JSON.stringify(documentPath)} has invalid ${attribute}: ${renderError(error)}`) }
    if (url.origin !== 'https://rp.invalid') {
      throw descriptorError(`Runtime UI Slot ${JSON.stringify(slot.id)} document ${JSON.stringify(documentPath)} has external ${attribute}`)
    }
    let path: string
    try { path = decodeURIComponent(url.pathname.slice(1)) }
    catch (error: unknown) { throw descriptorError(`Runtime UI Slot ${JSON.stringify(slot.id)} document ${JSON.stringify(documentPath)} has invalid ${attribute}: ${renderError(error)}`) }
    if (!assets.has(path)) {
      throw mismatch(`Runtime UI Slot ${JSON.stringify(slot.id)} document ${JSON.stringify(documentPath)} references undeclared asset ${JSON.stringify(path)}`)
    }
    if (tag === 'a' && attribute === 'href' && !path.toLowerCase().endsWith('.html')) {
      throw descriptorError(`Runtime UI Slot ${JSON.stringify(slot.id)} links may navigate only to declared HTML`)
    }
  }
}

function isHtmlElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node && typeof node.tagName === 'string' && 'attrs' in node
}

function uiSlotId(value: unknown, label: string): string {
  const id = requiredString(value, label)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id) || id.length > 128) {
    throw descriptorError(`${label} contains unsupported syntax`)
  }
  return id
}

function parsePipeline(value: unknown, index: number): RpRuntimePipelineSpec {
  const label = `Runtime pipeline ${index}`
  const record = strictRecord(value, ['id', 'kind', 'description', 'stages', 'budget'], label)
  const kind = requiredString(record.kind, `${label} kind`)
  if (!PIPELINE_KINDS.includes(kind as RpRuntimePipelineSpec['kind'])) {
    throw descriptorError(`${label} kind ${JSON.stringify(kind)} is unsupported`)
  }
  const stages = Object.freeze(arrayOf(record.stages, `${label} stages`).map((stage, stageIndex) => (
    parsePipelineStage(stage, stageIndex, label)
  )))
  if (stages.length === 0) throw descriptorError(`${label} must contain a stage`)
  assertUnique(stages.map(stage => stage.id), `${label} stage`)
  const parsed = Object.freeze({
    id: pipelineId(requiredString(record.id, `${label} id`)),
    kind: kind as RpRuntimePipelineSpec['kind'],
    description: requiredString(record.description, `${label} description`),
    stages,
    ...(record.budget === undefined ? {} : { budget: budgetOf(record.budget, label) }),
  })
  validatePipelineGraph(parsed, label)
  return parsed
}

function validatePipelineGraph(pipeline: RpRuntimePipelineSpec, label: string): void {
  const ids = new Set(pipeline.stages.map(stage => stage.id))
  const dependencies = new Map(pipeline.stages.map(stage => [stage.id, new Set(stage.after ?? [])]))
  for (const stage of pipeline.stages) {
    for (const dependency of stage.after ?? []) {
      if (!ids.has(dependency)) throw descriptorError(`${label} stage ${JSON.stringify(stage.id)} references missing after target ${JSON.stringify(dependency)}`)
    }
    for (const target of stage.before ?? []) {
      const targetDependencies = dependencies.get(target)
      if (targetDependencies === undefined) {
        throw descriptorError(`${label} stage ${JSON.stringify(stage.id)} references missing before target ${JSON.stringify(target)}`)
      }
      targetDependencies.add(stage.id)
    }
    if (stage.operation.kind === 'invoke-pipeline' && stage.operation.pipelineId === pipeline.id) {
      throw descriptorError(`${label} stage ${JSON.stringify(stage.id)} cannot invoke its own Pipeline`)
    }
  }
  const remaining = new Set(ids)
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => {
      const required = dependencies.get(id)
      return required !== undefined && [...required].every(dependency => !remaining.has(dependency))
    })
    if (ready.length === 0) throw descriptorError(`${label} contains a dependency cycle`)
    ready.forEach(id => remaining.delete(id))
  }
}

function parsePipelineStage(value: unknown, index: number, pipelineLabel: string): RpRuntimePipelineStageSpec {
  const label = `${pipelineLabel} stage ${index}`
  const record = strictRecord(value, [
    'id', 'operation', 'after', 'before', 'timeoutMs', 'retries', 'failure',
  ], label)
  const timeoutMs = optionalPositiveNumber(record.timeoutMs, `${label} timeoutMs`)
  const retries = optionalNonNegativeInteger(record.retries, `${label} retries`)
  const failure = record.failure === undefined ? undefined : requiredString(record.failure, `${label} failure`)
  if (failure !== undefined && failure !== 'fatal' && failure !== 'continue') {
    throw descriptorError(`${label} failure must be fatal or continue`)
  }
  return Object.freeze({
    id: requiredString(record.id, `${label} id`),
    operation: parsePipelineOperation(record.operation, label),
    ...optionalStrings(record, 'after', label),
    ...optionalStrings(record, 'before', label),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(retries === undefined ? {} : { retries }),
    ...(failure === undefined ? {} : { failure }),
  })
}

function parsePipelineOperation(value: unknown, label: string): RpRuntimePipelineStageOperation {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw descriptorError(`${label} operation must be an object with a kind`)
  }
  if (value.kind === 'invoke-capability') {
    const record = strictRecord(value, [
      'kind', 'capabilityId', 'inputKey', 'grantedPermissions', 'grantedTrust',
    ], `${label} operation`)
    const grantedTrust = optionalTrust(record.grantedTrust, `${label} operation grantedTrust`)
    return Object.freeze({
      kind: 'invoke-capability',
      capabilityId: requiredString(record.capabilityId, `${label} operation capabilityId`),
      ...(record.inputKey === undefined ? {} : { inputKey: requiredString(record.inputKey, `${label} operation inputKey`) }),
      ...optionalStrings(record, 'grantedPermissions', `${label} operation`),
      ...(grantedTrust === undefined ? {} : { grantedTrust }),
    })
  }
  if (value.kind === 'invoke-pipeline') {
    const record = strictRecord(value, ['kind', 'pipelineId', 'inputKey'], `${label} operation`)
    return Object.freeze({
      kind: 'invoke-pipeline',
      pipelineId: pipelineId(requiredString(record.pipelineId, `${label} operation pipelineId`)),
      ...(record.inputKey === undefined ? {} : { inputKey: requiredString(record.inputKey, `${label} operation inputKey`) }),
    })
  }
  if (value.kind === 'conditional') {
    const record = strictRecord(value, ['kind', 'valueKey', 'equals'], `${label} operation`)
    return Object.freeze({
      kind: 'conditional',
      valueKey: requiredString(record.valueKey, `${label} operation valueKey`),
      equals: jsonValue(record.equals, `${label} operation equals`),
    })
  }
  throw descriptorError(`${label} operation kind ${JSON.stringify(value.kind)} is unsupported`)
}

function assertPipelineDeclarations(
  capabilities: readonly RpRuntimeCapabilitySpec[],
  pipelines: readonly RpRuntimePipelineSpec[],
): void {
  const declared = capabilities
    .filter(capability => capability.kind === 'pipeline')
    .map(capability => String(capability.id))
    .sort()
  const graphs = pipelines.map(pipeline => String(pipeline.id)).sort()
  if (JSON.stringify(declared) !== JSON.stringify(graphs)) {
    throw mismatch('Runtime Pipeline graphs do not exactly match capabilities with kind pipeline')
  }
  const byId = new Map(capabilities.map(capability => [String(capability.id), capability]))
  for (const pipeline of pipelines) {
    const capability = byId.get(String(pipeline.id))
    if (capability?.implementation !== undefined) {
      throw descriptorError(`Runtime Pipeline capability ${JSON.stringify(pipeline.id)} must route through its graph`)
    }
    const declaredPermissions = new Set(capability?.permissions ?? [])
    for (const stage of pipeline.stages) {
      if (stage.operation.kind !== 'invoke-capability') continue
      const undeclared = stage.operation.grantedPermissions?.find(permission => !declaredPermissions.has(permission))
      if (undeclared !== undefined) {
        throw mismatch(
          `Runtime Pipeline ${JSON.stringify(pipeline.id)} stage ${JSON.stringify(stage.id)} requests undeclared capability permission ${JSON.stringify(undeclared)}`,
        )
      }
    }
  }
}

function parseComponent(value: unknown, index: number): RpRuntimeComponentSpec {
  const label = `Runtime component ${index}`
  const record = strictRecord(value, ['id', 'scopes', 'dependencies', 'provides', 'requires'], label)
  const scopes = scopesOf(record.scopes, label)
  const dependencies = record.dependencies === undefined
    ? undefined
    : arrayOf(record.dependencies, `${label} dependencies`).map((entry, dependencyIndex) => {
      const dependency = strictRecord(entry, ['id', 'version', 'optional'], `${label} dependency ${dependencyIndex}`)
      return Object.freeze({
        id: componentId(requiredString(dependency.id, `${label} dependency id`)),
        ...(dependency.version === undefined ? {} : { version: requiredString(dependency.version, `${label} dependency version`) }),
        ...(dependency.optional === undefined ? {} : { optional: requiredBoolean(dependency.optional, `${label} dependency optional`) }),
      })
    })
  return Object.freeze({
    id: componentId(requiredString(record.id, `${label} id`)),
    scopes,
    ...(dependencies === undefined ? {} : { dependencies: Object.freeze(dependencies) }),
    ...optionalStrings(record, 'provides', label),
    ...optionalStrings(record, 'requires', label),
  })
}

function parseCapability(
  value: unknown,
  index: number,
  files: ReadonlyMap<string, Uint8Array>,
): RpRuntimeCapabilitySpec {
  const label = `Runtime capability ${index}`
  const record = strictRecord(value, [
    'id', 'kind', 'title', 'description', 'scopes', 'permissions', 'budget',
    'inputSchema', 'outputSchema', 'tags', 'implementation',
  ], label)
  const kind = requiredString(record.kind, `${label} kind`)
  if (!CAPABILITY_KINDS.includes(kind as RpRuntimeCapabilitySpec['kind'])) {
    throw descriptorError(`${label} kind ${JSON.stringify(kind)} is unsupported`)
  }
  return Object.freeze({
    id: capabilityId(requiredString(record.id, `${label} id`)),
    kind: kind as RpRuntimeCapabilitySpec['kind'],
    title: requiredString(record.title, `${label} title`),
    description: requiredString(record.description, `${label} description`),
    scopes: scopesOf(record.scopes, label),
    ...optionalStrings(record, 'permissions', label),
    ...(record.budget === undefined ? {} : { budget: budgetOf(record.budget, label) }),
    ...(record.inputSchema === undefined ? {} : { inputSchema: jsonObject(record.inputSchema, `${label} inputSchema`) }),
    ...(record.outputSchema === undefined ? {} : { outputSchema: jsonObject(record.outputSchema, `${label} outputSchema`) }),
    ...optionalStrings(record, 'tags', label),
    ...(record.implementation === undefined ? {} : {
      implementation: implementationOf(record.implementation, label, files),
    }),
  })
}

function implementationOf(
  value: unknown,
  label: string,
  files: ReadonlyMap<string, Uint8Array>,
): RpRuntimeImplementation {
  if (!isRecord(value) || typeof value.kind !== 'string') throw descriptorError(`${label} implementation is invalid`)
  if (value.kind === 'expression') {
    const record = strictRecord(value, ['kind', 'expression'], `${label} expression implementation`)
    return Object.freeze({ kind: 'expression', expression: jsonValue(record.expression, `${label} expression`) })
  }
  if (value.kind === 'quickjs' || value.kind === 'native') {
    const record = strictRecord(value, ['kind', 'path'], `${label} ${value.kind} implementation`)
    const path = requiredArchiveFile(record.path, label, files)
    return Object.freeze({ kind: value.kind, path })
  }
  if (value.kind === 'wasm') {
    const record = strictRecord(value, ['kind', 'path', 'export'], `${label} wasm implementation`)
    return Object.freeze({
      kind: 'wasm',
      path: requiredArchiveFile(record.path, label, files),
      export: requiredString(record.export, `${label} wasm export`),
    })
  }
  throw descriptorError(`${label} implementation kind ${JSON.stringify(value.kind)} is unsupported`)
}

function assertManifestDeclarations(descriptor: RpRuntimeDescriptor, manifest: RpPackageManifest): void {
  const actualComponents = descriptor.components.map(item => String(item.id)).sort()
  const declaredComponents = manifest.components.map(String).sort()
  const actualCapabilities = descriptor.capabilities.map(item => String(item.id)).sort()
  const declaredCapabilities = manifest.capabilities.map(String).sort()
  const actualUiSlots = (descriptor.uiSlots ?? []).map(item => item.id).sort()
  const declaredUiSlots = [...manifest.uiSlots ?? []].sort()
  if (JSON.stringify(actualComponents) !== JSON.stringify(declaredComponents)) {
    throw mismatch('Runtime components do not exactly match Manifest components')
  }
  if (JSON.stringify(actualCapabilities) !== JSON.stringify(declaredCapabilities)) {
    throw mismatch('Runtime capabilities do not exactly match Manifest capabilities')
  }
  if (JSON.stringify(actualUiSlots) !== JSON.stringify(declaredUiSlots)) {
    throw mismatch('Runtime UI Slots do not exactly match Manifest uiSlots')
  }
  const manifestAssets = new Set(manifest.assets ?? [])
  for (const slot of descriptor.uiSlots ?? []) {
    const undeclared = slot.assets.find(path => !manifestAssets.has(path))
    if (undeclared !== undefined) {
      throw mismatch(`Runtime UI Slot ${JSON.stringify(slot.id)} uses undeclared Manifest asset ${JSON.stringify(undeclared)}`)
    }
  }
}

function assertTrustImplementations(descriptor: RpRuntimeDescriptor, manifest: RpPackageManifest): void {
  const allowed = manifest.trust === 'L0'
    ? new Set(['expression'])
    : manifest.trust === 'L1'
      ? new Set(['quickjs', 'wasm'])
      : new Set(['native'])
  for (const capability of descriptor.capabilities) {
    const kind = capability.implementation?.kind
    if (kind !== undefined && !allowed.has(kind)) {
      throw trustError(`Package trust ${manifest.trust} cannot activate ${kind} capability ${String(capability.id)}`)
    }
  }
  for (const pipeline of descriptor.pipelines ?? []) {
    for (const stage of pipeline.stages) {
      const requested = stage.operation.kind === 'invoke-capability' ? stage.operation.grantedTrust : undefined
      if (requested !== undefined && trustRank(requested) > trustRank(manifest.trust)) {
        throw trustError(`Package trust ${manifest.trust} cannot declare ${requested} stage authority in Pipeline ${String(pipeline.id)}`)
      }
    }
  }
  for (const slot of descriptor.uiSlots ?? []) {
    if (slot.script !== 'none') {
      throw trustError(`Runtime v1 UI Slot ${JSON.stringify(slot.id)} must be declarative; browser script is unavailable`)
    }
  }
}

function trustRank(value: RpTrustLevel): number {
  return TRUST_LEVELS.indexOf(value)
}

function requiredArchiveFile(value: unknown, label: string, files: ReadonlyMap<string, Uint8Array>): string {
  const path = safePath(requiredString(value, `${label} implementation path`), 'Implementation path')
  if (!files.has(path)) throw descriptorError(`${label} implementation file ${JSON.stringify(path)} is absent`)
  return path
}

function safePath(value: string, label: string): string {
  if (value === '' || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw archiveError(`${label} ${JSON.stringify(value)} is not a safe relative path`)
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..') || value.length > 512) {
    throw archiveError(`${label} ${JSON.stringify(value)} is not a safe relative path`)
  }
  return value
}

function validateLimits(limits: RpRuntimeArchiveLimits): void {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw limitError(`${key} must be a positive safe integer`)
  }
  if (limits.maxFileBytes > limits.maxUnpackedBytes) {
    throw limitError('maxFileBytes cannot exceed maxUnpackedBytes')
  }
}

function scopesOf(value: unknown, label: string): readonly RpScopeKind[] {
  const values = stringArray(value, `${label} scopes`)
  if (values.length === 0 || values.some(item => !SCOPE_KINDS.includes(item as RpScopeKind))) {
    throw descriptorError(`${label} scopes contain an unsupported value`)
  }
  return Object.freeze(values as RpScopeKind[])
}

function budgetOf(value: unknown, label: string): RpBudget {
  const record = strictRecord(value, BUDGET_KEYS, `${label} budget`)
  const budget: Record<string, number> = {}
  for (const [key, candidate] of Object.entries(record)) {
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
      throw descriptorError(`${label} budget ${key} must be positive`)
    }
    budget[key] = candidate
  }
  return Object.freeze(budget)
}

function optionalStrings(record: Record<string, unknown>, key: string, label: string): Record<string, readonly string[]> {
  return record[key] === undefined ? {} : { [key]: Object.freeze(stringArray(record[key], `${label} ${key}`)) }
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw descriptorError(`${label} must be an array`)
  const result = value.map((item, index) => requiredString(item, `${label} ${index}`))
  if (new Set(result).size !== result.length) throw descriptorError(`${label} contains duplicate values`)
  return result
}

function arrayOf(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw descriptorError(`${label} must be an array`)
  return value
}

function strictRecord(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) throw descriptorError(`${label} must be an object`)
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key)).sort()
  if (unexpected[0] !== undefined) throw descriptorError(`${label} contains unsupported field ${JSON.stringify(unexpected[0])}`)
  return value
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    throw descriptorError(`${label} must be a normalized non-empty string`)
  }
  return value
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw descriptorError(`${label} must be boolean`)
  return value
}

function optionalPositiveNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw descriptorError(`${label} must be positive`)
  }
  return value
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw descriptorError(`${label} must be a non-negative safe integer`)
  }
  return value as number
}

function optionalTrust(value: unknown, label: string): RpTrustLevel | undefined {
  if (value === undefined) return undefined
  if (!TRUST_LEVELS.includes(value as RpTrustLevel)) {
    throw descriptorError(`${label} must be L0, L1, or L2`)
  }
  return value as RpTrustLevel
}

function jsonObject(value: unknown, label: string): JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) throw descriptorError(`${label} must be a JSON object`)
  return freezeJson(structuredClone(value)) as JsonObject
}

function jsonValue(value: unknown, label: string): JsonValue {
  if (!isJsonValue(value)) throw descriptorError(`${label} must be finite JSON data`)
  return freezeJson(structuredClone(value))
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    value.forEach((child, index) => { value[index] = freezeJson(child) })
    Object.freeze(value)
    return value
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) value[key] = freezeJson(child)
    return Object.freeze(value)
  }
  return value
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw descriptorError(`Runtime descriptor contains duplicate ${label} ids`)
}

function decodeText(bytes: Uint8Array, label: string): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch (error: unknown) { throw descriptorError(`${label} is not UTF-8: ${renderError(error)}`) }
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

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`).join(',')}}`
}

function renderError(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error) }
  catch { return '[unrenderable archive error]' }
}

function archiveError(message: string): RpRuntimePackageError {
  return new RpRuntimePackageError(message, 'INVALID_ARCHIVE')
}
function limitError(message: string): RpRuntimePackageError {
  return new RpRuntimePackageError(message, 'LIMIT')
}
function descriptorError(message: string): RpRuntimePackageError {
  return new RpRuntimePackageError(message, 'INVALID_DESCRIPTOR')
}
function mismatch(message: string): RpRuntimePackageError {
  return new RpRuntimePackageError(message, 'DECLARATION_MISMATCH')
}
function trustError(message: string): RpRuntimePackageError {
  return new RpRuntimePackageError(message, 'TRUST')
}

const SCOPE_KINDS: readonly RpScopeKind[] = [
  'deployment', 'experience', 'profile', 'conversation', 'scene', 'turn', 'agent',
]
const CAPABILITY_KINDS: readonly RpRuntimeCapabilitySpec['kind'][] = [
  'tool', 'skill', 'subagent', 'agent', 'pipeline', 'memory', 'lore', 'media', 'rules',
]
const PIPELINE_KINDS: readonly RpRuntimePipelineSpec['kind'][] = ['turn', 'workflow', 'sidecar']
const UI_SLOT_PLACEMENTS: readonly RpUiSlotManifest['placement'][] = [
  'studio.overview', 'studio.creator', 'studio.inspector', 'conversation.sidebar', 'message.after',
]
const FORBIDDEN_UI_TAGS = new Set([
  'applet', 'base', 'embed', 'form', 'frame', 'frameset', 'iframe', 'math', 'object', 'portal', 'script', 'svg',
])
const FORBIDDEN_UI_ATTRIBUTES = new Set([
  'action', 'background', 'download', 'formaction', 'manifest', 'ping', 'srcdoc', 'target',
])
const UI_RESOURCE_ATTRIBUTES = new Set(['href', 'poster', 'src', 'srcset'])
const TRUST_LEVELS: readonly RpTrustLevel[] = ['L0', 'L1', 'L2']
const BUDGET_KEYS = ['timeoutMs', 'maxTokens', 'maxToolCalls', 'maxAgents', 'maxCostUsd'] as const
