/** Deterministic package tooling shared by the RP CLI and registry. @module @dsh-rp/sdk */

import { Buffer } from 'node:buffer'
import {
  createHash, createPrivateKey, createPublicKey, sign as signBytes, verify as verifyBytes,
} from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import type { JsonValue, RpPackageManifest, RpTrustLevel } from '@dsh-rp/contracts'
import { RpComponentId, RpPackageId } from '@dsh-rp/contracts'
import {
  createRpRuntimeArchive,
  parseRpRuntimeArchive,
  type RpRuntimeArchiveFile,
  type RpRuntimeArchiveLimits,
  type RpRuntimeDescriptor,
} from '@dsh-rp/package-runtime'

/** One validation diagnostic suitable for a CLI or registry response. */
export interface RpManifestDiagnostic {
  readonly path: string
  readonly message: string
}

/** Result of validating one installable manifest. */
export interface RpManifestValidation {
  readonly valid: boolean
  readonly diagnostics: readonly RpManifestDiagnostic[]
  readonly manifest?: RpPackageManifest
  readonly sha256?: string
}

/** Minimal legacy manifest accepted by the explicit v0 migration. */
export interface RpLegacyManifestV0 {
  readonly schemaVersion?: 0
  readonly id: string
  readonly name?: string
  readonly version?: string
  readonly components?: readonly string[]
  readonly capabilities?: readonly string[]
}

/** PEM text, DER Buffer, or parsed Node key accepted by signing helpers. */
export type RpKeyMaterial = string | Buffer | KeyObject

/** Conservative SDK defaults aligned with the first-party lifecycle adapters. */
export const DEFAULT_RP_RUNTIME_ARCHIVE_LIMITS: RpRuntimeArchiveLimits = Object.freeze({
  maxUnpackedBytes: 128 * 1024 * 1024,
  maxFiles: 512,
  maxFileBytes: 16 * 1024 * 1024,
})

/** In-memory input for a complete Registry-compatible RP release. */
export interface RpPackageBuildInput {
  readonly manifest: RpPackageManifest
  readonly descriptor: RpRuntimeDescriptor
  readonly files?: readonly RpRuntimeArchiveFile[]
}

/** Optional signing authority and archive limits for one build. */
export interface RpPackageBuildOptions {
  readonly limits?: RpRuntimeArchiveLimits
  readonly signing?: {
    readonly privateKey: RpKeyMaterial
    readonly keyId: string
  }
}

/** Three release artifacts consumed by local, Git, npm, and Registry source adapters. */
export interface RpPackageBuild {
  readonly manifest: RpPackageManifest
  readonly archive: Uint8Array
  readonly sbom: JsonValue
}

/**
 * Build, hash, SBOM-bind, optionally sign, and strict-reader-verify one complete RP release.
 * @param input - Manifest, runtime descriptor, and inert implementation or asset files.
 * @param options - Optional deployment limits and Ed25519 signing authority.
 * @returns Registry-compatible Manifest, `rp.package.tgz`, and SBOM values.
 */
export async function buildRpPackage(
  input: RpPackageBuildInput,
  options: RpPackageBuildOptions = {},
): Promise<RpPackageBuild> {
  const validation = validateRpPackageManifest(input.manifest)
  if (!validation.valid || validation.manifest === undefined) {
    throw new Error(validation.diagnostics.map(item => `${item.path}: ${item.message}`).join('; '))
  }
  const { integrity: _staleIntegrity, ...base } = validation.manifest
  const manifest = base as RpPackageManifest
  if (manifest.trust === 'L2' && options.signing === undefined) {
    throw new Error('Trust L2 RP packages require an Ed25519 signing authority')
  }
  const limits = options.limits ?? DEFAULT_RP_RUNTIME_ARCHIVE_LIMITS
  const archive = await createRpRuntimeArchive({
    descriptor: input.descriptor,
    ...(input.files === undefined ? {} : { files: input.files }),
  }, manifest, limits)
  const payloadBound: RpPackageManifest = {
    ...manifest,
    integrity: { sha256: createHash('sha256').update(archive).digest('hex') },
  }
  const sbom = createRpPackageSbom(payloadBound)
  const evidenceBound = attachRpPackageSbom(payloadBound, sbom)
  const finalized = options.signing === undefined
    ? evidenceBound
    : signRpPackageManifest(evidenceBound, options.signing.privateKey, options.signing.keyId)
  if (options.signing !== undefined
    && !verifyRpPackageSignature(finalized, createPublicKey(asPrivateKey(options.signing.privateKey)))) {
    throw new Error('RP package signature did not verify against the signing key')
  }
  const finalValidation = validateRpPackageManifest(finalized)
  if (!finalValidation.valid || finalValidation.manifest === undefined) {
    throw new Error(finalValidation.diagnostics.map(item => `${item.path}: ${item.message}`).join('; '))
  }
  const runtime = await parseRpRuntimeArchive(archive, finalValidation.manifest, limits)
  assertRuntimePermissions(runtime.descriptor, finalValidation.manifest)
  return Object.freeze({
    manifest: finalValidation.manifest,
    archive: archive.slice(),
    sbom: structuredClone(sbom),
  })
}

function assertRuntimePermissions(descriptor: RpRuntimeDescriptor, manifest: RpPackageManifest): void {
  const declared = new Set(manifest.permissions ?? [])
  const executablePermission = manifest.trust === 'L1'
    ? 'script.execute'
    : manifest.trust === 'L2' ? 'native.execute' : undefined
  for (const capability of descriptor.capabilities) {
    for (const permission of capability.permissions ?? []) {
      if (!declared.has(permission)) {
        throw new Error(`Capability ${String(capability.id)} requests undeclared Manifest permission ${JSON.stringify(permission)}`)
      }
    }
    if (capability.implementation !== undefined && executablePermission !== undefined
      && (!declared.has(executablePermission) || !capability.permissions?.includes(executablePermission))) {
      throw new Error(`Executable capability ${String(capability.id)} must declare ${executablePermission} in both Manifest and descriptor`)
    }
  }
}

/**
 * Validate untrusted JSON without executing unknown fields.
 * @param value - Untrusted manifest candidate.
 * @returns Diagnostics, normalized manifest, and hash when valid.
 */
export function validateRpPackageManifest(value: unknown): RpManifestValidation {
  const diagnostics: RpManifestDiagnostic[] = []
  if (!isRecord(value)) return invalid([{ path: '$', message: 'manifest must be an object' }])

  exact(value.schemaVersion, 1, '$.schemaVersion', diagnostics)
  const id = nonEmpty(value.id, '$.id', diagnostics)
  const name = nonEmpty(value.name, '$.name', diagnostics)
  const version = semver(value.version, '$.version', diagnostics)
  exact(value.license, 'MIT', '$.license', diagnostics)
  const trust = trustLevel(value.trust, '$.trust', diagnostics)
  const dependencies = dependenciesOf(value.dependencies, diagnostics)
  const components = stringsOf(value.components, '$.components', diagnostics)
  const capabilities = stringsOf(value.capabilities, '$.capabilities', diagnostics)
  const uiSlots = value.uiSlots === undefined ? undefined : stringsOf(value.uiSlots, '$.uiSlots', diagnostics)
  const permissions = value.permissions === undefined ? undefined : stringsOf(value.permissions, '$.permissions', diagnostics)
  const networkDomains = value.networkDomains === undefined ? undefined : stringsOf(value.networkDomains, '$.networkDomains', diagnostics)
  const fileRoots = value.fileRoots === undefined ? undefined : stringsOf(value.fileRoots, '$.fileRoots', diagnostics)
  const integrity = value.integrity === undefined ? undefined : integrityOf(value.integrity, diagnostics)
  const assets = value.assets === undefined ? undefined : stringsOf(value.assets, '$.assets', diagnostics)
  const compatibility = value.compatibility === undefined
    ? undefined
    : stringRecord(value.compatibility, '$.compatibility', diagnostics)

  if (diagnostics.length > 0 || id === undefined || name === undefined || version === undefined || trust === undefined) {
    return invalid(diagnostics)
  }
  const manifest: RpPackageManifest = {
    schemaVersion: 1,
    id: RpPackageId(id),
    name,
    version,
    license: 'MIT',
    trust,
    dependencies,
    components: components.map(RpComponentId),
    capabilities,
    ...(uiSlots === undefined ? {} : { uiSlots }),
    ...(permissions === undefined ? {} : { permissions }),
    ...(networkDomains === undefined ? {} : { networkDomains }),
    ...(fileRoots === undefined ? {} : { fileRoots }),
    ...(integrity === undefined ? {} : { integrity }),
    ...(assets === undefined ? {} : { assets }),
    ...(compatibility === undefined ? {} : { compatibility }),
  }
  return { valid: true, diagnostics: [], manifest, sha256: hashRpPackageManifest(manifest) }
}

/**
 * Verify a package byte stream against its declared SHA-256 integrity.
 * @param data - Exact package payload bytes.
 * @param manifest - Validated manifest carrying the expected digest.
 * @returns Whether the payload matches a valid declared digest.
 */
export function verifyRpPackageIntegrity(data: Uint8Array, manifest: RpPackageManifest): boolean {
  const expected = manifest.integrity?.sha256
  return expected !== undefined && /^[a-f0-9]{64}$/u.test(expected)
    && createHash('sha256').update(data).digest('hex') === expected
}

/**
 * Produce a deterministic CycloneDX-style minimal SBOM for registry and release output.
 * @param manifest - Validated package manifest.
 * @returns JSON-serializable CycloneDX-style component inventory.
 */
export function createRpPackageSbom(manifest: RpPackageManifest): JsonValue {
  return {
    bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    metadata: { component: { type: 'application', name: manifest.name, version: manifest.version, licenses: [{ license: { id: 'MIT' } }] } },
    components: manifest.dependencies.map(dependency => ({
      type: 'library', name: String(dependency.id), version: dependency.version,
      properties: dependency.optional === true ? [{ name: 'optional', value: 'true' }] : [],
    })),
  }
}

/**
 * Hash a JSON SBOM with the same stable key ordering used by package identities.
 * @param sbom - Finite JSON SBOM value.
 * @returns Lowercase SHA-256 digest.
 */
export function hashRpPackageSbom(sbom: JsonValue): string {
  return createHash('sha256').update(canonicalJson(sbom)).digest('hex')
}

/**
 * Verify an externally supplied SBOM against the digest bound into the manifest.
 * @param sbom - Exact JSON SBOM distributed with the package.
 * @param manifest - Manifest carrying the expected SBOM digest.
 * @returns Whether the canonical SBOM digest matches.
 */
export function verifyRpPackageSbom(sbom: JsonValue, manifest: RpPackageManifest): boolean {
  const expected = manifest.integrity?.sbom
  return expected !== undefined && /^[a-f0-9]{64}$/u.test(expected) && hashRpPackageSbom(sbom) === expected
}

/**
 * Return a manifest with an SBOM digest attached, ready for optional signing.
 * @param manifest - Source manifest.
 * @param sbom - Exact JSON SBOM distributed with the package.
 * @returns Detached manifest with stable SBOM integrity.
 */
export function attachRpPackageSbom(manifest: RpPackageManifest, sbom: JsonValue): RpPackageManifest {
  return {
    ...manifest,
    integrity: {
      ...(manifest.integrity?.sha256 === undefined ? {} : { sha256: manifest.integrity.sha256 }),
      sbom: hashRpPackageSbom(sbom),
    },
  }
}

/**
 * Produce the canonical bytes signed by Ed25519. The signature field itself is omitted.
 * @param manifest - Manifest carrying the key id and package integrity metadata.
 * @returns Stable UTF-8 signing payload.
 */
export function createRpPackageSigningPayload(manifest: RpPackageManifest): Uint8Array {
  const integrity = manifest.integrity
  const unsigned: RpPackageManifest = {
    ...manifest,
    ...(integrity === undefined ? {} : {
      integrity: {
        ...(integrity.sha256 === undefined ? {} : { sha256: integrity.sha256 }),
        ...(integrity.keyId === undefined ? {} : { keyId: integrity.keyId }),
        ...(integrity.sbom === undefined ? {} : { sbom: integrity.sbom }),
      },
    }),
  }
  return new TextEncoder().encode(canonicalJson(unsigned as unknown as JsonValue))
}

/**
 * Sign a manifest with an Ed25519 private key and bind the supplied key id.
 * @param manifest - Manifest whose integrity metadata will be signed.
 * @param privateKey - Ed25519 private key.
 * @param keyId - Deployment or publisher key identity.
 * @returns Detached signed manifest with canonical base64 signature.
 */
export function signRpPackageManifest(
  manifest: RpPackageManifest,
  privateKey: RpKeyMaterial,
  keyId: string,
): RpPackageManifest {
  if (keyId.trim() === '') throw new Error('RP signing key id must be non-empty')
  const key = asPrivateKey(privateKey)
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') throw new Error('RP package signing requires an Ed25519 private key')
  const candidate: RpPackageManifest = {
    ...manifest,
    integrity: { ...manifest.integrity, keyId },
  }
  const signature = signBytes(null, createRpPackageSigningPayload(candidate), key).toString('base64')
  const signed: RpPackageManifest = { ...candidate, integrity: { ...candidate.integrity, signature } }
  const validation = validateRpPackageManifest(signed)
  if (!validation.valid || validation.manifest === undefined) {
    throw new Error(validation.diagnostics.map(item => `${item.path}: ${item.message}`).join('; '))
  }
  return validation.manifest
}

/**
 * Verify a manifest's canonical Ed25519 signature against one public key.
 * @param manifest - Signed package manifest.
 * @param publicKey - Expected publisher Ed25519 public key.
 * @returns Whether the signature is valid for the canonical payload.
 */
export function verifyRpPackageSignature(manifest: RpPackageManifest, publicKey: RpKeyMaterial): boolean {
  const encoded = manifest.integrity?.signature
  if (encoded === undefined || manifest.integrity?.keyId === undefined || !isCanonicalBase64(encoded)) return false
  try {
    const key = asPublicKey(publicKey)
    return key.type === 'public' && key.asymmetricKeyType === 'ed25519'
      && verifyBytes(null, createRpPackageSigningPayload(manifest), key, Buffer.from(encoded, 'base64'))
  } catch { return false }
}

/**
 * Derive a stable `sha256:` key id from an Ed25519 public key.
 * @param publicKey - Publisher Ed25519 public key.
 * @returns SHA-256 SPKI fingerprint key identity.
 */
export function createRpSigningKeyId(publicKey: RpKeyMaterial): string {
  const key = asPublicKey(publicKey)
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') throw new Error('RP package trust requires an Ed25519 public key')
  const der = key.export({ format: 'der', type: 'spki' })
  return `sha256:${createHash('sha256').update(der).digest('hex')}`
}

/**
 * Produce the content hash used by registry metadata and lock files.
 * @param manifest - Validated package manifest.
 * @returns Lowercase SHA-256 digest.
 */
export function hashRpPackageManifest(manifest: RpPackageManifest): string {
  return createHash('sha256').update(canonicalJson(manifest as unknown as JsonValue)).digest('hex')
}

/**
 * Migrate the only supported legacy shape.
 * @param value - Version-zero or current manifest.
 * @returns Validated version-one manifest.
 */
export function migrateRpPackageManifest(value: unknown): RpPackageManifest {
  const current = validateRpPackageManifest(value)
  if (current.valid && current.manifest !== undefined) return current.manifest
  if (!isRecord(value) || (value.schemaVersion !== undefined && value.schemaVersion !== 0)) {
    throw new Error('Only RP package schemaVersion 0 or 1 can be migrated')
  }
  const legacy = value as unknown as RpLegacyManifestV0
  if (typeof legacy.id !== 'string' || legacy.id.trim() === '') throw new Error('Legacy RP package id must be non-empty')
  const candidate = {
    schemaVersion: 1,
    id: legacy.id,
    name: legacy.name ?? legacy.id,
    version: legacy.version ?? '0.1.0',
    license: 'MIT',
    trust: 'L0',
    dependencies: [],
    components: legacy.components ?? [],
    capabilities: legacy.capabilities ?? [],
  }
  const migrated = validateRpPackageManifest(candidate)
  if (!migrated.valid || migrated.manifest === undefined) {
    throw new Error(migrated.diagnostics.map(item => `${item.path}: ${item.message}`).join('; '))
  }
  return migrated.manifest
}

/**
 * Create a declaration-only starter manifest.
 * @param id - npm-style package identity.
 * @returns Safe trust-L0 manifest.
 */
export function createRpPackageManifest(id: string): RpPackageManifest {
  const normalized = id.trim()
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error(`Invalid package id ${JSON.stringify(id)}`)
  }
  return {
    schemaVersion: 1,
    id: RpPackageId(normalized),
    name: normalized,
    version: '0.1.0',
    license: 'MIT',
    trust: 'L0',
    dependencies: [],
    components: [],
    capabilities: [],
  }
}

function invalid(diagnostics: readonly RpManifestDiagnostic[]): RpManifestValidation {
  return { valid: false, diagnostics: [...diagnostics] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exact(value: unknown, expected: unknown, path: string, diagnostics: RpManifestDiagnostic[]): void {
  if (value !== expected) diagnostics.push({ path, message: `must equal ${JSON.stringify(expected)}` })
}

function nonEmpty(value: unknown, path: string, diagnostics: RpManifestDiagnostic[]): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    diagnostics.push({ path, message: 'must be a non-empty string' })
    return undefined
  }
  return value
}

function semver(value: unknown, path: string, diagnostics: RpManifestDiagnostic[]): string | undefined {
  const text = nonEmpty(value, path, diagnostics)
  if (text !== undefined && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(text)) {
    diagnostics.push({ path, message: 'must be a SemVer version' })
    return undefined
  }
  return text
}

function trustLevel(value: unknown, path: string, diagnostics: RpManifestDiagnostic[]): RpTrustLevel | undefined {
  if (value === 'L0' || value === 'L1' || value === 'L2') return value
  diagnostics.push({ path, message: 'must be L0, L1, or L2' })
  return undefined
}

function stringsOf(value: unknown, path: string, diagnostics: RpManifestDiagnostic[]): string[] {
  if (!Array.isArray(value)) {
    diagnostics.push({ path, message: 'must be an array' })
    return []
  }
  const strings: string[] = []
  for (const [index, item] of value.entries()) {
    const text = nonEmpty(item, `${path}[${index}]`, diagnostics)
    if (text !== undefined) strings.push(text)
  }
  if (new Set(strings).size !== strings.length) diagnostics.push({ path, message: 'must not contain duplicates' })
  return strings
}

function dependenciesOf(value: unknown, diagnostics: RpManifestDiagnostic[]): RpPackageManifest['dependencies'] {
  if (!Array.isArray(value)) {
    diagnostics.push({ path: '$.dependencies', message: 'must be an array' })
    return []
  }
  return value.flatMap((item, index) => {
    if (!isRecord(item)) {
      diagnostics.push({ path: `$.dependencies[${index}]`, message: 'must be an object' })
      return []
    }
    const id = nonEmpty(item.id, `$.dependencies[${index}].id`, diagnostics)
    const version = nonEmpty(item.version, `$.dependencies[${index}].version`, diagnostics)
    if (version !== undefined && !isSupportedVersionRange(version)) {
      diagnostics.push({ path: `$.dependencies[${index}].version`, message: 'must be *, an exact SemVer, ^SemVer, or ~SemVer' })
    }
    if (item.optional !== undefined && typeof item.optional !== 'boolean') {
      diagnostics.push({ path: `$.dependencies[${index}].optional`, message: 'must be a boolean' })
    }
    return id === undefined || version === undefined ? [] : [{
      id: RpPackageId(id), version,
      ...(item.optional === true ? { optional: true } : {}),
    }]
  })
}

function stringRecord(value: unknown, path: string, diagnostics: RpManifestDiagnostic[]): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    diagnostics.push({ path, message: 'must be an object of strings' })
    return {}
  }
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') diagnostics.push({ path: `${path}.${key}`, message: 'must be a string' })
    else result[key] = entry
  }
  return result
}

function integrityOf(value: unknown, diagnostics: RpManifestDiagnostic[]): NonNullable<RpPackageManifest['integrity']> {
  if (!isRecord(value)) { diagnostics.push({ path: '$.integrity', message: 'must be an object' }); return {} }
  const result: { sha256?: string; signature?: string; keyId?: string; sbom?: string } = {}
  for (const key of ['sha256', 'signature', 'keyId', 'sbom'] as const) {
    const entry = value[key]
    if (entry === undefined) continue
    if (typeof entry !== 'string' || entry.length === 0) diagnostics.push({ path: `$.integrity.${key}`, message: 'must be a non-empty string' })
    else result[key] = entry
  }
  if (result.sha256 !== undefined && !/^[a-f0-9]{64}$/u.test(result.sha256)) diagnostics.push({ path: '$.integrity.sha256', message: 'must be a lowercase SHA-256 digest' })
  if (result.sbom !== undefined && !/^[a-f0-9]{64}$/u.test(result.sbom)) diagnostics.push({ path: '$.integrity.sbom', message: 'must be a lowercase SHA-256 digest' })
  if (result.signature !== undefined && !isCanonicalBase64(result.signature)) diagnostics.push({ path: '$.integrity.signature', message: 'must be canonical base64' })
  if ((result.signature === undefined) !== (result.keyId === undefined)) diagnostics.push({ path: '$.integrity', message: 'signature and keyId must be supplied together' })
  return result
}

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) return false
  return Buffer.from(value, 'base64').toString('base64') === value
}

function asPrivateKey(value: RpKeyMaterial): KeyObject {
  if (typeof value === 'string' || Buffer.isBuffer(value)) return createPrivateKey(value)
  return value
}

function asPublicKey(value: RpKeyMaterial): KeyObject {
  if (typeof value === 'string' || Buffer.isBuffer(value)) return createPublicKey(value)
  return value
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`).join(',')}}`
}

function isSupportedVersionRange(value: string): boolean {
  return value === '*' || /^(?:\^|~)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)
}
