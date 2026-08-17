/** Open, provider-driven RP package registry and deterministic dependency lock resolver. @module @dsh-rp/registry */

import { Buffer } from 'node:buffer'
import { createHash, createPublicKey } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { JsonValue, RpPackageManifest, RpTrustLevel } from '@dsh-rp/contracts'
import {
  createRpSigningKeyId, validateRpPackageManifest, verifyRpPackageIntegrity, verifyRpPackageSbom,
  verifyRpPackageSignature,
} from '@dsh-rp/sdk'
import type { RpKeyMaterial } from '@dsh-rp/sdk'

declare module '@deepseek-ai/cordis' {
  interface Context { rpRegistry: RpRegistry }
  interface Events {
    /**
     * Published releases changed for a package.
     * @param id - Package identity.
     * @mode emit
     */
    'rp/registry-changed'(id: string): void
    /**
     * One exact package lock entry was installed.
     * @param entry - Installed exact-version lock entry.
     * @mode emit
     */
    'rp/package-installed'(entry: RpPackageLockEntry): void
    /**
     * One exact package lock entry was removed from an installation.
     * @param entry - Removed exact-version lock entry.
     * @mode emit
     */
    'rp/package-uninstalled'(entry: RpPackageLockEntry): void
    /**
     * One root installation atomically changed lock graphs.
     * @param installation - New installed root state.
     * @param previousGraphHash - Replaced graph identity.
     * @mode emit
     */
    'rp/package-updated'(installation: RpPackageInstallation, previousGraphHash: string): void
    /**
     * A package or exact version was revoked.
     * @param record - Active revocation record.
     * @mode emit
     */
    'rp/package-revoked'(record: RpRevocationRecord): void
  }
}

/** Supported package acquisition mechanism. */
export type RpPackageSourceKind = 'local' | 'git' | 'npm' | 'registry'
/** Normalized package source selected for a release. */
export interface RpPackageSource {
  readonly kind: RpPackageSourceKind
  readonly locator: string
  readonly ref?: string
}
/** Untrusted package payload returned by one source Provider. */
export interface RpResolvedPackage {
  readonly manifest: unknown
  readonly source: RpPackageSource
  readonly bytes?: Uint8Array
  readonly sbom?: JsonValue
}
/** Reversible acquisition Provider for one source kind. */
export interface RpPackageSourceProvider {
  readonly kind: RpPackageSourceKind
  resolve(source: RpPackageSource, signal?: AbortSignal): Promise<RpResolvedPackage>
}
/** One immutable published package version. */
export interface RpRegistryRelease {
  readonly manifest: RpPackageManifest
  readonly source: RpPackageSource
  readonly manifestHash: string
  readonly publishedAt: number
  readonly evidenceVerified: boolean
}
/** Package-wide or version-specific revocation. */
export interface RpRevocationRecord {
  readonly id: string
  readonly version?: string
  readonly reason: string
  readonly revokedAt: number
}
/** One exact version in a dependency lock graph. */
export interface RpPackageLockEntry {
  readonly id: string
  readonly version: string
  readonly manifestHash: string
  readonly source: RpPackageSource
  readonly dependencies: readonly string[]
  readonly payloadSha256?: string
  readonly signingKeyId?: string
  readonly sbomSha256?: string
  readonly evidenceVerified: boolean
}
/** Deterministic install graph and its content hash. */
export interface RpPackageLock {
  readonly schemaVersion: 1
  readonly generatedAt: number
  readonly graphHash: string
  readonly packages: readonly RpPackageLockEntry[]
}

/** One committed root installation and its exact dependency graph. */
export interface RpPackageInstallation {
  readonly schemaVersion: 1
  readonly rootId: string
  readonly source: RpPackageSource
  readonly lock: RpPackageLock
  readonly installedAt: number
  readonly updatedAt: number
}

/** Input supplied to one package lifecycle adapter during transaction preparation. */
export interface RpPackageLifecycleRequest {
  readonly release: RpRegistryRelease
  readonly entry: RpPackageLockEntry
  readonly signal?: AbortSignal
  /** Detached, integrity-verified package archive bytes when supplied by the source or cache. */
  readonly payload?: Uint8Array
  /** Detached, hash-bound SBOM when supplied by the source. */
  readonly sbom?: JsonValue
}

/** Side-effect-free preparation whose activation must be synchronous and reversible. */
export interface RpPreparedPackageLifecycle {
  /** Atomically publish runtime registrations and return a total, non-throwing disposer. */
  activate(): () => void
  /** Release prepared resources when activation will not occur. */
  dispose(): void
}

/** Replaceable runtime adapter for one class of installed RP packages. */
export interface RpPackageLifecycleAdapter {
  readonly id: string
  readonly priority?: number
  supports(release: RpRegistryRelease): boolean
  prepare(request: RpPackageLifecycleRequest): Promise<RpPreparedPackageLifecycle>
}

/** Detached deployment state for one exact installed package. */
export interface RpActivePackageSummary {
  readonly id: string
  readonly version: string
  readonly owners: readonly string[]
  readonly runtimeActive: boolean
  readonly lifecycleAdapterId?: string
}

/** Durable commit boundary for root installation records. */
export interface RpRegistryInstallationStore {
  readonly id: string
  load(): Promise<readonly RpPackageInstallation[]>
  put(installation: RpPackageInstallation): Promise<void>
  delete(rootId: string): Promise<void>
}

/** Content-addressed cache for integrity-bound package archives. */
export interface RpPackageArtifactStore {
  readonly id: string
  get(sha256: string): Promise<Uint8Array | undefined>
  put(sha256: string, bytes: Uint8Array): Promise<void>
}

/** Conjunctive package-install policy registered by a deployment or product plugin. */
export interface RpRegistrySecurityPolicy {
  readonly id: string
  readonly appliesTo?: readonly RpTrustLevel[]
  readonly requirePayloadIntegrity?: boolean
  readonly requireSignature?: boolean
  readonly requireSbom?: boolean
}

/** Revocation for one publisher signing key. */
export interface RpSigningKeyRevocation {
  readonly keyId: string
  readonly reason: string
  readonly revokedAt: number
}

/** Registry validation, lookup, integrity, or dependency failure. */
export class RpRegistryError extends Error {
  constructor(
    message: string,
    readonly code: 'DUPLICATE' | 'INVALID' | 'NOT_FOUND' | 'REVOKED' | 'DEPENDENCY' | 'INTEGRITY'
      | 'SIGNATURE' | 'SBOM' | 'POLICY' | 'NO_PROVIDER' | 'NO_ACTIVATOR'
      | 'ALREADY_INSTALLED' | 'NOT_INSTALLED' | 'LIFECYCLE',
  ) {
    super(message); this.name = 'RpRegistryError'
  }
}

interface ActivePackageState {
  readonly entry: RpPackageLockEntry
  readonly release: RpRegistryRelease
  readonly owners: Set<string>
  readonly adapter?: RpPackageLifecycleAdapter
  readonly deactivate?: () => void
}

interface PreparedPackageState {
  readonly entry: RpPackageLockEntry
  readonly release: RpRegistryRelease
  readonly adapter?: RpPackageLifecycleAdapter
  readonly prepared?: RpPreparedPackageLifecycle
}

interface AcquiredRelease {
  readonly release: RpRegistryRelease
  readonly rollbackRelease?: () => void
}

interface VerifiedReleaseArtifact {
  readonly payload?: Uint8Array
  readonly sbom?: JsonValue
}

/** Provider-driven Registry with deterministic dependency lock resolution. */
export class RpRegistry extends Service {
  private readonly releases = new Map<string, Map<string, RpRegistryRelease>>()
  private readonly providers = new Map<RpPackageSourceKind, RpPackageSourceProvider>()
  private readonly revocations: RpRevocationRecord[] = []
  private readonly signingKeys = new Map<string, KeyObject>()
  private readonly signingKeyRevocations: RpSigningKeyRevocation[] = []
  private readonly securityPolicies = new Map<string, RpRegistrySecurityPolicy>()
  private readonly lifecycleAdapters = new Map<string, RpPackageLifecycleAdapter>()
  private readonly installations = new Map<string, RpPackageInstallation>()
  private readonly activePackages = new Map<string, ActivePackageState>()
  private readonly releaseArtifacts = new WeakMap<RpRegistryRelease, VerifiedReleaseArtifact>()
  private installationStore: RpRegistryInstallationStore | undefined
  private artifactStore: RpPackageArtifactStore | undefined
  private mutationActive = false

  constructor(ctx: Context) { super(ctx, 'rpRegistry') }

  /**
   * Register the deployment's single installation durability Provider.
   * @param store - Durable load, put, and delete boundary.
   * @returns Idempotent registration disposer.
   */
  registerInstallationStore(store: RpRegistryInstallationStore): () => void {
    if (store.id.trim() === '' || typeof store.load !== 'function'
      || typeof store.put !== 'function' || typeof store.delete !== 'function') {
      throw new RpRegistryError('Installation store id, load, put, and delete are required', 'INVALID')
    }
    if (this.installationStore !== undefined) {
      throw new RpRegistryError(`Installation store ${this.installationStore.id} already exists`, 'DUPLICATE')
    }
    const stored: RpRegistryInstallationStore = Object.freeze({
      id: store.id,
      load: store.load.bind(store),
      put: store.put.bind(store),
      delete: store.delete.bind(store),
    })
    this.installationStore = stored
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.installationStore === stored) this.installationStore = undefined
    }
  }

  /**
   * Report the active durability Provider without exposing storage handles.
   * @returns Store identity, or undefined when installation state is process-local.
   */
  getInstallationStore(): Readonly<Pick<RpRegistryInstallationStore, 'id'>> | undefined {
    return this.installationStore === undefined ? undefined : Object.freeze({ id: this.installationStore.id })
  }

  /**
   * Register the deployment's single content-addressed package archive cache.
   * @param store - Cache whose keys are verified lowercase SHA-256 digests.
   * @returns Idempotent registration disposer.
   */
  registerArtifactStore(store: RpPackageArtifactStore): () => void {
    if (store.id.trim() === '' || typeof store.get !== 'function' || typeof store.put !== 'function') {
      throw new RpRegistryError('Artifact store id, get, and put are required', 'INVALID')
    }
    if (this.artifactStore !== undefined) {
      throw new RpRegistryError(`Artifact store ${this.artifactStore.id} already exists`, 'DUPLICATE')
    }
    const stored: RpPackageArtifactStore = Object.freeze({
      id: store.id,
      get: store.get.bind(store),
      put: store.put.bind(store),
    })
    this.artifactStore = stored
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.artifactStore === stored) this.artifactStore = undefined
    }
  }

  /**
   * Report the active artifact cache without exposing storage handles.
   * @returns Store identity, or undefined when archives are source-only.
   */
  getArtifactStore(): Readonly<Pick<RpPackageArtifactStore, 'id'>> | undefined {
    return this.artifactStore === undefined ? undefined : Object.freeze({ id: this.artifactStore.id })
  }

  /**
   * Reacquire, verify, and activate every durable installation before serving mutations.
   * @param signal - Optional startup cancellation signal.
   * @returns Restored roots in deterministic identity order.
   */
  async restoreInstallations(signal?: AbortSignal): Promise<readonly RpPackageInstallation[]> {
    return await this.withMutation(async () => {
      const store = this.installationStore
      if (store === undefined) throw new RpRegistryError('No installation store is registered', 'NO_PROVIDER')
      const records = [...await store.load()].sort((left, right) => left.rootId.localeCompare(right.rootId))
      const restored: RpPackageInstallation[] = []
      try {
        for (const record of records) {
          if (this.installations.has(record.rootId)) {
            throw new RpRegistryError(`Package ${record.rootId} is already installed during restore`, 'ALREADY_INSTALLED')
          }
          restored.push(await this.restoreInstallation(record, signal))
        }
        return Object.freeze(restored)
      } catch (error) {
        for (const installation of [...restored].reverse()) await this.uninstallInternal(installation.rootId, false)
        throw error
      }
    })
  }

  /**
   * Register one reversible package lifecycle adapter.
   * @param adapter - Side-effect-free prepare and reversible activation contract.
   * @returns Idempotent registration disposer.
   */
  registerLifecycleAdapter(adapter: RpPackageLifecycleAdapter): () => void {
    if (adapter.id.trim() === '' || typeof adapter.supports !== 'function' || typeof adapter.prepare !== 'function') {
      throw new RpRegistryError('Lifecycle adapter id, supports, and prepare are required', 'INVALID')
    }
    if (this.lifecycleAdapters.has(adapter.id)) {
      throw new RpRegistryError(`Lifecycle adapter ${JSON.stringify(adapter.id)} already exists`, 'DUPLICATE')
    }
    const stored: RpPackageLifecycleAdapter = Object.freeze({
      id: adapter.id,
      ...(adapter.priority === undefined ? {} : { priority: adapter.priority }),
      supports: adapter.supports.bind(adapter),
      prepare: adapter.prepare.bind(adapter),
    })
    this.lifecycleAdapters.set(stored.id, stored)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.lifecycleAdapters.get(stored.id) === stored) this.lifecycleAdapters.delete(stored.id)
    }
  }

  /**
   * List lifecycle adapter metadata in deterministic selection order.
   * @returns Detached adapter identities and priorities.
   */
  listLifecycleAdapters(): readonly Readonly<Pick<RpPackageLifecycleAdapter, 'id' | 'priority'>>[] {
    return [...this.lifecycleAdapters.values()].sort(compareLifecycleAdapters).map(adapter => Object.freeze({
      id: adapter.id,
      ...(adapter.priority === undefined ? {} : { priority: adapter.priority }),
    }))
  }

  /**
   * List registered acquisition mechanisms without exposing Provider credentials or configuration.
   * @returns Sorted source kinds.
   */
  listSourceProviders(): readonly RpPackageSourceKind[] {
    return Object.freeze([...this.providers.keys()].sort())
  }

  /**
   * List detached conjunctive evidence policies for permission inspection.
   * @returns Policies sorted by identity.
   */
  listSecurityPolicies(): readonly RpRegistrySecurityPolicy[] {
    return [...this.securityPolicies.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(policy => Object.freeze({
        ...policy,
        ...(policy.appliesTo === undefined ? {} : { appliesTo: Object.freeze([...policy.appliesTo]) }),
      }))
  }

  /**
   * List committed root installations in deterministic id order.
   * @returns Immutable installation records.
   */
  listInstallations(): readonly RpPackageInstallation[] {
    return [...this.installations.values()].sort((left, right) => left.rootId.localeCompare(right.rootId))
  }

  /**
   * List exact active package ownership without exposing lifecycle handles.
   * @returns Detached active-package summaries.
   */
  listActivePackages(): readonly RpActivePackageSummary[] {
    return [...this.activePackages.values()]
      .sort((left, right) => left.entry.id.localeCompare(right.entry.id))
      .map(state => Object.freeze({
        id: state.entry.id,
        version: state.entry.version,
        owners: Object.freeze([...state.owners].sort()),
        runtimeActive: state.deactivate !== undefined,
        ...(state.adapter === undefined ? {} : { lifecycleAdapterId: state.adapter.id }),
      }))
  }

  /**
   * Register one source acquisition Provider.
   * @param provider - Source acquisition Provider.
   * @returns Idempotent registration disposer.
   */
  registerProvider(provider: RpPackageSourceProvider): () => void {
    if (this.providers.has(provider.kind)) {
      throw new RpRegistryError(`Source provider ${provider.kind} already exists`, 'DUPLICATE')
    }
    if (!isSourceKind(provider.kind) || typeof provider.resolve !== 'function') {
      throw new RpRegistryError('Source provider kind and resolve function are invalid', 'INVALID')
    }
    const stored: RpPackageSourceProvider = Object.freeze({
      kind: provider.kind,
      resolve: provider.resolve.bind(provider),
    })
    this.providers.set(stored.kind, stored)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.providers.get(stored.kind) === stored) this.providers.delete(stored.kind)
    }
  }

  /**
   * Register one trusted Ed25519 publisher key with reversible lifetime.
   * @param publicKey - Publisher public key material.
   * @param keyId - Required SHA-256 SPKI fingerprint, derived by default.
   * @returns Idempotent registration disposer.
   */
  registerSigningKey(publicKey: RpKeyMaterial, keyId: string = createRpSigningKeyId(publicKey)): () => void {
    if (keyId !== createRpSigningKeyId(publicKey)) {
      throw new RpRegistryError('Signing key id does not match its Ed25519 public key fingerprint', 'INVALID')
    }
    if (this.signingKeys.has(keyId)) throw new RpRegistryError(`Signing key ${keyId} already exists`, 'DUPLICATE')
    const storedKey = typeof publicKey === 'string' || Buffer.isBuffer(publicKey)
      ? createPublicKey(publicKey)
      : createPublicKey({ key: publicKey.export({ format: 'der', type: 'spki' }), format: 'der', type: 'spki' })
    this.signingKeys.set(keyId, storedKey)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.signingKeys.get(keyId) === storedKey) this.signingKeys.delete(keyId)
    }
  }

  /**
   * Register one conjunctive install policy with reversible lifetime.
   * @param policy - Trust-level filter and required package evidence.
   * @returns Idempotent registration disposer.
   */
  registerSecurityPolicy(policy: RpRegistrySecurityPolicy): () => void {
    if (policy.id.trim() === '') throw new RpRegistryError('Security policy id must be non-empty', 'INVALID')
    if (policy.appliesTo?.some(level => !['L0', 'L1', 'L2'].includes(level)) === true
      || [policy.requirePayloadIntegrity, policy.requireSignature, policy.requireSbom]
        .some(value => value !== undefined && typeof value !== 'boolean')) {
      throw new RpRegistryError(`Security policy ${policy.id} has invalid trust levels or evidence flags`, 'INVALID')
    }
    if (this.securityPolicies.has(policy.id)) throw new RpRegistryError(`Security policy ${policy.id} already exists`, 'DUPLICATE')
    const stored: RpRegistrySecurityPolicy = Object.freeze({
      ...policy,
      ...(policy.appliesTo === undefined ? {} : { appliesTo: Object.freeze([...policy.appliesTo]) }),
    })
    this.securityPolicies.set(policy.id, stored)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.securityPolicies.get(policy.id) === stored) this.securityPolicies.delete(policy.id)
    }
  }

  /**
   * Publish one validated immutable release.
   * @param manifestValue - Untrusted manifest input.
   * @param source - Normalized acquisition source.
   * @param publishedAt - Publication timestamp supplied by the owning clock.
   * @returns Idempotent release disposer.
   */
  publish(manifestValue: unknown, source: RpPackageSource, publishedAt: number = Date.now()): () => void {
    const validation = validateRpPackageManifest(manifestValue)
    if (!validation.valid || validation.manifest === undefined || validation.sha256 === undefined) {
      throw new RpRegistryError(
        validation.diagnostics.map(item => `${item.path}: ${item.message}`).join('; '),
        'INVALID',
      )
    }
    const manifest = validation.manifest
    if (this.requiresEvidence(manifest)) {
      throw new RpRegistryError('Active install policy requires package evidence; use install() instead of metadata-only publish()', 'POLICY')
    }
    return this.storeRelease(manifest, source, validation.sha256, publishedAt, false)
  }

  private storeRelease(
    manifest: RpPackageManifest,
    source: RpPackageSource,
    manifestHash: string,
    publishedAt: number,
    evidenceVerified: boolean,
  ): () => void {
    const storedManifest = freezeManifest(manifest)
    const versions = this.releases.get(String(storedManifest.id)) ?? new Map<string, RpRegistryRelease>()
    if (versions.has(storedManifest.version)) {
      throw new RpRegistryError(`${storedManifest.id}@${storedManifest.version} already exists`, 'DUPLICATE')
    }
    const release: RpRegistryRelease = Object.freeze({
      manifest: storedManifest,
      source: freezeSource(source),
      manifestHash,
      publishedAt,
      evidenceVerified,
    })
    versions.set(storedManifest.version, release)
    this.releases.set(String(storedManifest.id), versions)
    this.emitRegistryChanged(String(storedManifest.id))
    let active = true
    return () => {
      if (!active) return
      active = false
      if (versions.get(storedManifest.version) === release) versions.delete(storedManifest.version)
      if (versions.size === 0) this.releases.delete(String(storedManifest.id))
      this.emitRegistryChanged(String(storedManifest.id))
    }
  }

  /**
   * List releases in deterministic package and version order.
   * @param id - Optional package filter.
   * @returns Frozen matching releases.
   */
  list(id?: string): readonly RpRegistryRelease[] {
    const values = id === undefined
      ? [...this.releases.values()].flatMap(map => [...map.values()])
      : [...(this.releases.get(id)?.values() ?? [])]
    return values.sort((left, right) => String(left.manifest.id).localeCompare(String(right.manifest.id))
      || compareVersions(right.manifest.version, left.manifest.version))
  }

  /**
   * Add one package or version revocation.
   * @param record - Package or version revocation.
   * @returns Idempotent revocation disposer.
   */
  revoke(record: Omit<RpRevocationRecord, 'revokedAt'> & { readonly revokedAt?: number }): () => void {
    if (record.id.trim() === '' || record.reason.trim() === '') {
      throw new RpRegistryError('Revocation id and reason must be non-empty', 'INVALID')
    }
    const stored: RpRevocationRecord = Object.freeze({ ...record, revokedAt: record.revokedAt ?? Date.now() })
    this.revocations.push(stored)
    this.emitPackageRevoked(stored)
    let active = true
    return () => {
      if (!active) return
      active = false
      const index = this.revocations.indexOf(stored)
      if (index >= 0) this.revocations.splice(index, 1)
    }
  }

  /**
   * List detached package revocations for registry mirroring and audit UI.
   * @returns Active package revocations in registration order.
   */
  listRevocations(): readonly RpRevocationRecord[] { return this.revocations.map(item => Object.freeze({ ...item })) }

  /**
   * Revoke one publisher key; signed packages using it stop resolving immediately.
   * @param record - Key identity, audit reason, and optional owning timestamp.
   * @returns Idempotent revocation disposer.
   */
  revokeSigningKey(record: Omit<RpSigningKeyRevocation, 'revokedAt'> & { readonly revokedAt?: number }): () => void {
    if (record.keyId.trim() === '' || record.reason.trim() === '') {
      throw new RpRegistryError('Signing key revocation keyId and reason must be non-empty', 'INVALID')
    }
    const stored: RpSigningKeyRevocation = Object.freeze({ ...record, revokedAt: record.revokedAt ?? Date.now() })
    this.signingKeyRevocations.push(stored)
    let active = true
    return () => {
      if (!active) return
      active = false
      const index = this.signingKeyRevocations.indexOf(stored)
      if (index >= 0) this.signingKeyRevocations.splice(index, 1)
    }
  }

  /**
   * List detached signing-key revocations for registry mirroring and audit UI.
   * @returns Active signing-key revocations in registration order.
   */
  listSigningKeyRevocations(): readonly RpSigningKeyRevocation[] {
    return this.signingKeyRevocations.map(item => Object.freeze({ ...item }))
  }

  /**
   * Resolve the highest non-revoked matching release.
   * @param id - Package identity.
   * @param version - Exact or supported SemVer range.
   * @returns Highest non-revoked matching release.
   */
  resolve(id: string, version: string = '*'): RpRegistryRelease {
    const versions = this.releases.get(id)
    const candidates = [...(versions?.values() ?? [])]
      .filter(item => satisfies(item.manifest.version, version))
      .sort((a, b) => compareVersions(b.manifest.version, a.manifest.version))
    const release = candidates[0]
    if (release === undefined) throw new RpRegistryError(`Package ${id}@${version} not found`, 'NOT_FOUND')
    if (this.isRevoked(id, release.manifest.version)) {
      throw new RpRegistryError(`Package ${id}@${release.manifest.version} is revoked`, 'REVOKED')
    }
    const keyId = release.manifest.integrity?.keyId
    if (keyId !== undefined && this.isSigningKeyRevoked(keyId)) {
      throw new RpRegistryError(`Package ${id}@${release.manifest.version} uses revoked signing key ${keyId}`, 'REVOKED')
    }
    if (this.requiresEvidence(release.manifest) && !release.evidenceVerified) {
      throw new RpRegistryError(`Package ${id}@${release.manifest.version} has not passed required evidence verification`, 'POLICY')
    }
    return release
  }

  /**
   * Test whether an active revocation applies.
   * @param id - Package identity.
   * @param version - Exact package version.
   * @returns Whether an active revocation applies.
   */
  isRevoked(id: string, version: string): boolean {
    return this.revocations.some(item => item.id === id && (item.version === undefined || item.version === version))
  }

  /**
   * Test whether an active signing-key revocation applies.
   * @param keyId - Publisher key identity.
   * @returns Whether the key is actively revoked.
   */
  isSigningKeyRevoked(keyId: string): boolean {
    return this.signingKeyRevocations.some(item => item.keyId === keyId)
  }

  /**
   * Resolve a complete deterministic dependency graph.
   * @param id - Root package identity.
   * @param version - Root exact or supported SemVer range.
   * @param generatedAt - Lock timestamp supplied by the owning clock.
   * @returns Frozen exact-version dependency lock.
   */
  lock(id: string, version: string = '*', generatedAt: number = Date.now()): RpPackageLock {
    const ordered: RpPackageLockEntry[] = []
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (packageId: string, range: string): void => {
      const release = this.resolve(packageId, range)
      const key = `${release.manifest.id}@${release.manifest.version}`
      if (visiting.has(key)) throw new RpRegistryError(`Dependency cycle at ${key}`, 'DEPENDENCY')
      if (visited.has(key)) return
      visiting.add(key)
      const dependencies = [...release.manifest.dependencies]
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      for (const dependency of dependencies) {
        try {
          visit(String(dependency.id), dependency.version)
        } catch (error) {
          if (dependency.optional !== true) throw error
        }
      }
      visiting.delete(key)
      visited.add(key)
      ordered.push(Object.freeze({
        id: String(release.manifest.id),
        version: release.manifest.version,
        manifestHash: release.manifestHash,
        source: release.source,
        dependencies: Object.freeze(release.manifest.dependencies.map(item => String(item.id)).sort()),
        ...(release.manifest.integrity?.sha256 === undefined ? {} : { payloadSha256: release.manifest.integrity.sha256 }),
        ...(release.manifest.integrity?.keyId === undefined ? {} : { signingKeyId: release.manifest.integrity.keyId }),
        ...(release.manifest.integrity?.sbom === undefined ? {} : { sbomSha256: release.manifest.integrity.sbom }),
        evidenceVerified: release.evidenceVerified,
      }))
    }
    visit(id, version)
    const graphHash = createHash('sha256').update(canonical(ordered as unknown as JsonValue)).digest('hex')
    return Object.freeze({ schemaVersion: 1, generatedAt, graphHash, packages: Object.freeze(ordered) })
  }

  /**
   * Acquire, validate, publish, and lock one package source.
   * @param source - Normalized source locator.
   * @param signal - Optional acquisition cancellation signal.
   * @returns Frozen dependency lock.
   */
  async install(source: RpPackageSource, signal?: AbortSignal): Promise<RpPackageLock> {
    return await this.withMutation(async () => {
      const acquired = await this.acquireRelease(source, signal)
      const rootId = String(acquired.release.manifest.id)
      let committed = false
      try {
        const lock = this.lock(rootId, acquired.release.manifest.version)
        assertUniqueLockVersions(lock)
        const existing = this.installations.get(rootId)
        if (existing !== undefined) {
          if (existing.lock.graphHash === lock.graphHash) return existing.lock
          throw new RpRegistryError(
            `Package ${rootId} is already installed; use update() to replace its lock graph`,
            'ALREADY_INSTALLED',
          )
        }
        this.assertInstallConflicts(lock)
        const newEntries = lock.packages.filter((entry) => {
          const active = this.activePackages.get(entry.id)
          return active === undefined || active.entry.version !== entry.version
        })
        const prepared = await this.prepareEntries(newEntries, signal)
        const activated = this.activatePrepared(prepared)
        const now = Date.now()
        const installation = freezeInstallation({
          schemaVersion: 1,
          rootId,
          source: acquired.release.source,
          lock,
          installedAt: now,
          updatedAt: now,
        })
        assertActivatedEntries(newEntries, activated)
        try {
          await this.installationStore?.put(installation)
        } catch (error) {
          deactivateActivated(activated)
          throw new RpRegistryError(`Installation persistence failed: ${renderError(error)}`, 'LIFECYCLE')
        }
        for (const entry of lock.packages) {
          const current = this.activePackages.get(entry.id)
          if (current !== undefined && current.entry.version === entry.version) {
            current.owners.add(rootId)
            continue
          }
          const state = activated.get(entry.id)
          if (state === undefined) throw new RpRegistryError(`Package ${entry.id} activation disappeared`, 'LIFECYCLE')
          this.activePackages.set(entry.id, { ...state, owners: new Set([rootId]) })
        }
        this.installations.set(rootId, installation)
        committed = true
        for (const entry of lock.packages) this.emitLifecycle('rp/package-installed', entry)
        return lock
      } catch (error) {
        if (!committed) acquired.rollbackRelease?.()
        throw error
      }
    })
  }

  /**
   * Atomically replace one installed root with a newly acquired exact graph.
   * @param source - Source resolving to the same root package id.
   * @param signal - Optional acquisition and preparation cancellation.
   * @returns New frozen dependency lock.
   */
  async update(source: RpPackageSource, signal?: AbortSignal): Promise<RpPackageLock> {
    return await this.withMutation(async () => {
      const acquired = await this.acquireRelease(source, signal)
      const rootId = String(acquired.release.manifest.id)
      const previous = this.installations.get(rootId)
      if (previous === undefined) {
        acquired.rollbackRelease?.()
        throw new RpRegistryError(`Package ${rootId} is not installed`, 'NOT_INSTALLED')
      }
      let committed = false
      try {
        const lock = this.lock(rootId, acquired.release.manifest.version)
        assertUniqueLockVersions(lock)
        if (lock.graphHash === previous.lock.graphHash) return previous.lock
        this.assertInstallConflicts(lock, rootId)
        const proposed = new Map(lock.packages.map(entry => [entry.id, entry]))
        const newEntries = lock.packages.filter((entry) => {
          const active = this.activePackages.get(entry.id)
          return active === undefined || active.entry.version !== entry.version
        })
        const obsolete = previous.lock.packages
          .filter((entry) => {
            const replacement = proposed.get(entry.id)
            const active = this.activePackages.get(entry.id)
            return active?.owners.has(rootId) === true
              && active.owners.size === 1
              && (replacement === undefined || replacement.version !== entry.version)
          })
          .map(entry => this.requiredActiveState(entry.id))
        const preparedNew = await this.prepareEntries(newEntries, signal)
        let preparedRestore: readonly PreparedPackageState[] = []
        try {
          preparedRestore = await this.prepareExistingStates(obsolete, signal)
        } catch (error) {
          disposePrepared(preparedNew)
          throw error
        }
        try {
          const deactivationFailures = deactivateStates([...obsolete].reverse())
          if (deactivationFailures.length > 0) {
            throw new RpRegistryError(
              `Previous package lifecycle could not be released: ${deactivationFailures.join('; ')}`,
              'LIFECYCLE',
            )
          }
          const activated = this.activatePrepared(preparedNew)
          assertActivatedEntries(newEntries, activated)
          const installation = freezeInstallation({
            schemaVersion: 1,
            rootId,
            source: acquired.release.source,
            lock,
            installedAt: previous.installedAt,
            updatedAt: Date.now(),
          })
          try {
            await this.installationStore?.put(installation)
          } catch (error) {
            deactivateActivated(activated)
            throw new RpRegistryError(`Installation persistence failed: ${renderError(error)}`, 'LIFECYCLE')
          }
          for (const state of this.activePackages.values()) state.owners.delete(rootId)
          for (const [id, state] of this.activePackages) {
            if (state.owners.size === 0) this.activePackages.delete(id)
          }
          for (const entry of lock.packages) {
            const current = this.activePackages.get(entry.id)
            if (current !== undefined && current.entry.version === entry.version) {
              current.owners.add(rootId)
              continue
            }
            const state = activated.get(entry.id)
            if (state === undefined) throw new RpRegistryError(`Package ${entry.id} activation disappeared`, 'LIFECYCLE')
            this.activePackages.set(entry.id, { ...state, owners: new Set([rootId]) })
          }
          this.installations.set(rootId, installation)
          disposePrepared(preparedRestore)
          committed = true

          for (const entry of previous.lock.packages) {
            const replacement = proposed.get(entry.id)
            if (replacement === undefined || replacement.version !== entry.version) {
              this.emitLifecycle('rp/package-uninstalled', entry)
            }
          }
          const old = new Map(previous.lock.packages.map(entry => [entry.id, entry.version]))
          for (const entry of lock.packages) {
            if (old.get(entry.id) !== entry.version) this.emitLifecycle('rp/package-installed', entry)
          }
          this.emitLifecycle('rp/package-updated', installation, previous.lock.graphHash)
          return lock
        } catch (error) {
          if (!committed) {
            const restored = this.restorePrepared(preparedRestore, obsolete)
            for (const [id, state] of restored) this.activePackages.set(id, state)
          }
          throw error
        }
      } catch (error) {
        acquired.rollbackRelease?.()
        throw error
      }
    })
  }

  /**
   * Uninstall one root and release packages no longer owned by another root.
   * @param rootId - Installed root package id.
   * @returns Removed immutable installation.
   */
  async uninstall(rootId: string): Promise<RpPackageInstallation> {
    return await this.withMutation(async () => await this.uninstallInternal(rootId, true))
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.mutationActive) throw new RpRegistryError('Another package lifecycle transaction is active', 'LIFECYCLE')
    this.mutationActive = true
    try { return await operation() }
    finally { this.mutationActive = false }
  }

  private async uninstallInternal(rootId: string, persist: boolean): Promise<RpPackageInstallation> {
    const installation = this.installations.get(rootId)
    if (installation === undefined) throw new RpRegistryError(`Package ${rootId} is not installed`, 'NOT_INSTALLED')
    const exclusive = installation.lock.packages
      .map(entry => this.requiredActiveState(entry.id))
      .filter(state => state.owners.size === 1 && state.owners.has(rootId))
    const preparedRestore = await this.prepareExistingStates(exclusive)
    const restore = (): void => {
      const restored = this.restorePrepared(preparedRestore, exclusive)
      for (const [id, state] of restored) this.activePackages.set(id, state)
    }
    const failures = deactivateStates([...exclusive].reverse())
    if (failures.length > 0) {
      restore()
      throw new RpRegistryError(`Package ${rootId} could not be released: ${failures.join('; ')}`, 'LIFECYCLE')
    }
    try {
      if (persist) await this.installationStore?.delete(rootId)
    } catch (error) {
      restore()
      throw new RpRegistryError(`Installation persistence failed: ${renderError(error)}`, 'LIFECYCLE')
    }
    disposePrepared(preparedRestore)
    for (const state of this.activePackages.values()) state.owners.delete(rootId)
    for (const [id, state] of this.activePackages) {
      if (state.owners.size === 0) this.activePackages.delete(id)
    }
    this.installations.delete(rootId)
    for (const entry of installation.lock.packages) this.emitLifecycle('rp/package-uninstalled', entry)
    return installation
  }

  private emitLifecycle(event: 'rp/package-installed' | 'rp/package-uninstalled', entry: RpPackageLockEntry): void
  private emitLifecycle(event: 'rp/package-updated', installation: RpPackageInstallation, previousGraphHash: string): void
  private emitLifecycle(
    event: 'rp/package-installed' | 'rp/package-uninstalled' | 'rp/package-updated',
    value: RpPackageLockEntry | RpPackageInstallation,
    previousGraphHash?: string,
  ): void {
    try {
      if (event === 'rp/package-updated') {
        this.ctx.emit(event, value as RpPackageInstallation, previousGraphHash ?? '')
      } else {
        this.ctx.emit(event, value as RpPackageLockEntry)
      }
    } catch (error: unknown) {
      this.ctx.logger.warn(`RP Registry observer ${event} failed after commit: ${renderError(error)}`)
    }
  }

  private emitRegistryChanged(id: string): void {
    try { this.ctx.emit('rp/registry-changed', id) }
    catch (error: unknown) {
      this.ctx.logger.warn(`RP Registry observer rp/registry-changed failed after commit: ${renderError(error)}`)
    }
  }

  private emitPackageRevoked(record: RpRevocationRecord): void {
    try { this.ctx.emit('rp/package-revoked', record) }
    catch (error: unknown) {
      this.ctx.logger.warn(`RP Registry observer rp/package-revoked failed after commit: ${renderError(error)}`)
    }
  }

  private async acquireRelease(source: RpPackageSource, signal?: AbortSignal): Promise<AcquiredRelease> {
    const requested = freezeSource(source)
    const provider = this.providers.get(requested.kind)
    if (provider === undefined) throw new RpRegistryError(`No source provider for ${requested.kind}`, 'NO_PROVIDER')
    const resolved = await provider.resolve(requested, signal)
    const returnedSource = freezeSource(resolved.source)
    if (returnedSource.kind !== requested.kind || returnedSource.locator !== requested.locator
      || returnedSource.ref !== requested.ref) {
      throw new RpRegistryError('Source provider changed the requested package source', 'INVALID')
    }
    const validation = validateRpPackageManifest(resolved.manifest)
    if (!validation.valid || validation.manifest === undefined || validation.sha256 === undefined) {
      throw new RpRegistryError('Source returned an invalid manifest', 'INVALID')
    }
    let payload = resolved.bytes?.slice()
    const sbom = resolved.sbom === undefined ? undefined : structuredClone(resolved.sbom)
    const payloadSha256 = validation.manifest.integrity?.sha256
    if (payload === undefined && payloadSha256 !== undefined && this.artifactStore !== undefined) {
      payload = (await this.artifactStore.get(payloadSha256))?.slice()
    }
    const verified = Object.freeze({
      ...resolved,
      ...(payload === undefined ? {} : { bytes: payload }),
      ...(sbom === undefined ? {} : { sbom }),
    })
    const evidenceVerified = this.verifyResolvedPackage(verified, validation.manifest)
    if (payload !== undefined && payloadSha256 !== undefined && this.artifactStore !== undefined) {
      try { await this.artifactStore.put(payloadSha256, payload.slice()) }
      catch (error: unknown) {
        throw new RpRegistryError(`Package artifact cache failed: ${renderError(error)}`, 'LIFECYCLE')
      }
    }
    const artifact = freezeVerifiedArtifact(payload, sbom)
    const id = String(validation.manifest.id)
    const current = this.releases.get(id)?.get(validation.manifest.version)
    if (current !== undefined) {
      if (current.manifestHash !== validation.sha256) {
        throw new RpRegistryError(`${id}@${validation.manifest.version} changed immutable manifest content`, 'DUPLICATE')
      }
      if (!current.evidenceVerified && evidenceVerified) {
        const promoted = Object.freeze({ ...current, evidenceVerified: true })
        this.releases.get(id)?.set(validation.manifest.version, promoted)
        this.releaseArtifacts.set(promoted, artifact ?? this.releaseArtifacts.get(current) ?? Object.freeze({}))
        this.emitRegistryChanged(id)
        return { release: promoted }
      }
      if (artifact !== undefined) this.releaseArtifacts.set(current, artifact)
      return { release: current }
    }
    const rollbackRelease = this.storeRelease(
      validation.manifest, resolved.source, validation.sha256, Date.now(), evidenceVerified,
    )
    const release = this.releases.get(id)?.get(validation.manifest.version)
    if (release === undefined) throw new RpRegistryError(`Package ${id} release disappeared after publication`, 'LIFECYCLE')
    if (artifact !== undefined) this.releaseArtifacts.set(release, artifact)
    return { release, rollbackRelease }
  }

  private async restoreInstallation(
    value: RpPackageInstallation,
    signal?: AbortSignal,
  ): Promise<RpPackageInstallation> {
    const installation = validateInstallation(value)
    assertUniqueLockVersions(installation.lock)
    this.assertInstallConflicts(installation.lock)
    const acquired: AcquiredRelease[] = []
    let activated: Map<string, Omit<ActivePackageState, 'owners'>> | undefined
    try {
      for (const entry of installation.lock.packages) {
        const result = await this.acquireRelease(entry.source, signal)
        acquired.push(result)
        if (String(result.release.manifest.id) !== entry.id
          || result.release.manifest.version !== entry.version
          || result.release.manifestHash !== entry.manifestHash
          || (entry.evidenceVerified && !result.release.evidenceVerified)) {
          throw new RpRegistryError(`Durable lock entry ${entry.id}@${entry.version} no longer matches its source`, 'INTEGRITY')
        }
      }
      const newEntries = installation.lock.packages.filter((entry) => {
        const active = this.activePackages.get(entry.id)
        return active === undefined || active.entry.version !== entry.version
      })
      const prepared = await this.prepareEntries(newEntries, signal)
      activated = this.activatePrepared(prepared)
      assertActivatedEntries(newEntries, activated)
      for (const entry of installation.lock.packages) {
        const current = this.activePackages.get(entry.id)
        if (current !== undefined && current.entry.version === entry.version) {
          current.owners.add(installation.rootId)
          continue
        }
        const state = activated.get(entry.id)
        if (state === undefined) throw new RpRegistryError(`Package ${entry.id} activation disappeared`, 'LIFECYCLE')
        this.activePackages.set(entry.id, { ...state, owners: new Set([installation.rootId]) })
      }
      this.installations.set(installation.rootId, installation)
      for (const entry of installation.lock.packages) this.emitLifecycle('rp/package-installed', entry)
      return installation
    } catch (error) {
      if (activated !== undefined) deactivateActivated(activated)
      for (const result of [...acquired].reverse()) result.rollbackRelease?.()
      throw error
    }
  }

  private assertInstallConflicts(lock: RpPackageLock, replacingRoot?: string): void {
    for (const entry of lock.packages) {
      const active = this.activePackages.get(entry.id)
      if (active === undefined || active.entry.version === entry.version) continue
      const otherOwners = [...active.owners].filter(owner => owner !== replacingRoot)
      if (otherOwners.length > 0 || replacingRoot === undefined || !active.owners.has(replacingRoot)) {
        throw new RpRegistryError(
          `Package ${entry.id}@${entry.version} conflicts with active ${active.entry.version} owned by ${[...active.owners].sort().join(', ')}`,
          'DEPENDENCY',
        )
      }
    }
  }

  private async prepareEntries(
    entries: readonly RpPackageLockEntry[],
    signal?: AbortSignal,
  ): Promise<readonly PreparedPackageState[]> {
    const prepared: PreparedPackageState[] = []
    try {
      for (const entry of entries) {
        if (signal?.aborted === true) throw signal.reason ?? new Error('RP package preparation aborted')
        const release = this.resolve(entry.id, entry.version)
        const adapter = [...this.lifecycleAdapters.values()]
          .sort(compareLifecycleAdapters)
          .find(candidate => candidate.supports(release))
        if (adapter === undefined) {
          if (release.manifest.trust !== 'L0') {
            throw new RpRegistryError(
              `Package ${entry.id}@${entry.version} requires ${release.manifest.trust} execution but no lifecycle adapter supports it`,
              'NO_ACTIVATOR',
            )
          }
          prepared.push({ entry, release })
          continue
        }
        const lifecycle = await adapter.prepare({
          release,
          entry,
          ...(signal === undefined ? {} : { signal }),
          ...cloneVerifiedArtifact(this.releaseArtifacts.get(release)),
        })
        if (typeof lifecycle.activate !== 'function' || typeof lifecycle.dispose !== 'function') {
          throw new RpRegistryError(`Lifecycle adapter ${adapter.id} returned an invalid preparation`, 'LIFECYCLE')
        }
        prepared.push({ entry, release, adapter, prepared: lifecycle })
      }
      return Object.freeze(prepared)
    } catch (error) {
      disposePrepared(prepared)
      throw error
    }
  }

  private async prepareExistingStates(
    states: readonly ActivePackageState[],
    signal?: AbortSignal,
  ): Promise<readonly PreparedPackageState[]> {
    const prepared: PreparedPackageState[] = []
    try {
      for (const state of states) {
        if (state.adapter === undefined || state.deactivate === undefined) continue
        const lifecycle = await state.adapter.prepare({
          release: state.release,
          entry: state.entry,
          ...(signal === undefined ? {} : { signal }),
          ...cloneVerifiedArtifact(this.releaseArtifacts.get(state.release)),
        })
        prepared.push({ entry: state.entry, release: state.release, adapter: state.adapter, prepared: lifecycle })
      }
      return Object.freeze(prepared)
    } catch (error) {
      disposePrepared(prepared)
      throw error
    }
  }

  private activatePrepared(prepared: readonly PreparedPackageState[]): Map<string, Omit<ActivePackageState, 'owners'>> {
    const active = new Map<string, Omit<ActivePackageState, 'owners'>>()
    const activated: ActivePackageState[] = []
    let index = 0
    try {
      for (; index < prepared.length; index += 1) {
        const state = prepared[index]
        if (state === undefined) continue
        if (state.prepared === undefined) {
          active.set(state.entry.id, { entry: state.entry, release: state.release })
          continue
        }
        const deactivate = state.prepared.activate()
        if (typeof deactivate !== 'function') {
          throw new RpRegistryError(`Lifecycle adapter ${state.adapter?.id ?? 'unknown'} returned no disposer`, 'LIFECYCLE')
        }
        const activatedState: ActivePackageState = {
          entry: state.entry,
          release: state.release,
          owners: new Set(),
          ...(state.adapter === undefined ? {} : { adapter: state.adapter }),
          deactivate,
        }
        activated.push(activatedState)
        active.set(state.entry.id, {
          entry: state.entry,
          release: state.release,
          ...(state.adapter === undefined ? {} : { adapter: state.adapter }),
          deactivate,
        })
      }
      return active
    } catch (error) {
      deactivateStates([...activated].reverse())
      disposePrepared(prepared.slice(index))
      throw error instanceof RpRegistryError
        ? error
        : new RpRegistryError(`Package lifecycle activation failed: ${renderError(error)}`, 'LIFECYCLE')
    }
  }

  private restorePrepared(
    prepared: readonly PreparedPackageState[],
    obsolete: readonly ActivePackageState[],
  ): Map<string, ActivePackageState> {
    try {
      const restored = this.activatePrepared(prepared)
      const result = new Map<string, ActivePackageState>()
      for (const previous of obsolete) {
        const active = restored.get(previous.entry.id)
        result.set(previous.entry.id, active === undefined
          ? previous
          : { ...active, owners: previous.owners })
      }
      return result
    } catch (error) {
      throw new RpRegistryError(
        `Package update failed and previous lifecycle could not be restored: ${renderError(error)}`,
        'LIFECYCLE',
      )
    }
  }

  private requiredActiveState(id: string): ActivePackageState {
    const state = this.activePackages.get(id)
    if (state === undefined) throw new RpRegistryError(`Installed package ${id} has no active state`, 'LIFECYCLE')
    return state
  }


  private verifyResolvedPackage(resolved: RpResolvedPackage, manifest: RpPackageManifest): boolean {
    const policies = this.securityPoliciesFor(manifest)
    const sha256 = manifest.integrity?.sha256
    if (sha256 !== undefined && resolved.bytes === undefined) {
      throw new RpRegistryError('Package declares SHA-256 but source returned no payload bytes', 'INTEGRITY')
    }
    if (resolved.bytes !== undefined && sha256 !== undefined && !verifyRpPackageIntegrity(resolved.bytes, manifest)) {
      throw new RpRegistryError('Package SHA-256 mismatch', 'INTEGRITY')
    }
    if (policies.some(policy => policy.requirePayloadIntegrity === true) && (resolved.bytes === undefined || sha256 === undefined)) {
      throw new RpRegistryError('Package install policy requires payload SHA-256 integrity', 'POLICY')
    }

    const signature = manifest.integrity?.signature
    const keyId = manifest.integrity?.keyId
    if (signature !== undefined && keyId !== undefined) {
      if (this.isSigningKeyRevoked(keyId)) throw new RpRegistryError(`Signing key ${keyId} is revoked`, 'SIGNATURE')
      const publicKey = this.signingKeys.get(keyId)
      if (publicKey === undefined) throw new RpRegistryError(`Signing key ${keyId} is not trusted`, 'SIGNATURE')
      if (!verifyRpPackageSignature(manifest, publicKey)) throw new RpRegistryError('Package signature is invalid', 'SIGNATURE')
    } else if (policies.some(policy => policy.requireSignature === true)) {
      throw new RpRegistryError('Package install policy requires a trusted Ed25519 signature', 'POLICY')
    }

    const sbomHash = manifest.integrity?.sbom
    if (sbomHash !== undefined && resolved.sbom === undefined) {
      throw new RpRegistryError('Package declares an SBOM hash but source returned no SBOM', 'SBOM')
    }
    if (resolved.sbom !== undefined && (sbomHash === undefined || !verifyRpPackageSbom(resolved.sbom, manifest))) {
      throw new RpRegistryError('Package SBOM is unbound or does not match its declared hash', 'SBOM')
    }
    if (policies.some(policy => policy.requireSbom === true) && (resolved.sbom === undefined || sbomHash === undefined)) {
      throw new RpRegistryError('Package install policy requires a hash-bound SBOM', 'POLICY')
    }
    return sha256 !== undefined || signature !== undefined || sbomHash !== undefined
  }

  private securityPoliciesFor(manifest: RpPackageManifest): readonly RpRegistrySecurityPolicy[] {
    return [...this.securityPolicies.values()].filter(policy => policy.appliesTo?.includes(manifest.trust) ?? true)
  }

  private requiresEvidence(manifest: RpPackageManifest): boolean {
    return this.securityPoliciesFor(manifest).some(policy => policy.requirePayloadIntegrity === true
      || policy.requireSignature === true || policy.requireSbom === true)
  }

}

/**
 * Parse a CLI package spec without acquiring or executing it.
 * @param spec - Local path or prefixed Git, npm, or Registry locator.
 * @returns Normalized source descriptor.
 */
export function parseRpPackageSource(spec: string): RpPackageSource {
  const value = spec.trim()
  if (value === '') throw new RpRegistryError('Package source cannot be empty', 'INVALID')
  if (value.startsWith('git+')) {
    const [locator, ref] = value.slice(4).split('#', 2)
    if (locator === undefined || locator === '') throw new RpRegistryError('Git package locator cannot be empty', 'INVALID')
    return freezeSource({ kind: 'git', locator, ...(ref === undefined ? {} : { ref }) })
  }
  if (value.startsWith('npm:')) return parseNpmSource(value.slice(4))
  if (value.startsWith('registry:')) return freezeSource({ kind: 'registry', locator: value.slice(9) })
  return freezeSource({ kind: 'local', locator: value })
}

function parseNpmSource(value: string): RpPackageSource {
  const separator = value.lastIndexOf('@')
  const scopedPrefix = value.startsWith('@')
  const hasExactRef = separator > (scopedPrefix ? value.indexOf('/') : 0)
  return freezeSource({
    kind: 'npm',
    locator: hasExactRef ? value.slice(0, separator) : value,
    ...(hasExactRef ? { ref: value.slice(separator + 1) } : {}),
  })
}

function freezeSource(source: RpPackageSource): RpPackageSource {
  if (!isSourceKind(source.kind)) throw new RpRegistryError(`Unsupported package source kind ${JSON.stringify(source.kind)}`, 'INVALID')
  if (source.locator.trim() === '') throw new RpRegistryError('Package source locator cannot be empty', 'INVALID')
  if (source.ref !== undefined && source.ref.trim() === '') {
    throw new RpRegistryError('Package source ref cannot be empty', 'INVALID')
  }
  return Object.freeze({
    kind: source.kind,
    locator: source.locator,
    ...(source.ref === undefined ? {} : { ref: source.ref }),
  })
}
function isSourceKind(value: unknown): value is RpPackageSourceKind {
  return value === 'local' || value === 'git' || value === 'npm' || value === 'registry'
}
function freezeManifest(manifest: RpPackageManifest): RpPackageManifest {
  return Object.freeze({
    ...manifest,
    dependencies: Object.freeze(manifest.dependencies.map(item => Object.freeze({ ...item }))),
    components: Object.freeze([...manifest.components]),
    capabilities: Object.freeze([...manifest.capabilities]),
    ...(manifest.uiSlots === undefined ? {} : { uiSlots: Object.freeze([...manifest.uiSlots]) }),
    ...(manifest.permissions === undefined ? {} : { permissions: Object.freeze([...manifest.permissions]) }),
    ...(manifest.networkDomains === undefined ? {} : { networkDomains: Object.freeze([...manifest.networkDomains]) }),
    ...(manifest.fileRoots === undefined ? {} : { fileRoots: Object.freeze([...manifest.fileRoots]) }),
    ...(manifest.integrity === undefined ? {} : { integrity: Object.freeze({ ...manifest.integrity }) }),
    ...(manifest.assets === undefined ? {} : { assets: Object.freeze([...manifest.assets]) }),
    ...(manifest.compatibility === undefined ? {} : { compatibility: Object.freeze({ ...manifest.compatibility }) }),
  })
}

function freezeInstallation(installation: RpPackageInstallation): RpPackageInstallation {
  return Object.freeze({
    ...installation,
    source: freezeSource(installation.source),
    lock: installation.lock,
  })
}

function freezeVerifiedArtifact(
  payload: Uint8Array | undefined,
  sbom: JsonValue | undefined,
): VerifiedReleaseArtifact | undefined {
  if (payload === undefined && sbom === undefined) return undefined
  return Object.freeze({
    ...(payload === undefined ? {} : { payload: payload.slice() }),
    ...(sbom === undefined ? {} : { sbom: structuredClone(sbom) }),
  })
}

function cloneVerifiedArtifact(artifact: VerifiedReleaseArtifact | undefined): VerifiedReleaseArtifact {
  return artifact === undefined
    ? Object.freeze({})
    : Object.freeze({
      ...(artifact.payload === undefined ? {} : { payload: artifact.payload.slice() }),
      ...(artifact.sbom === undefined ? {} : { sbom: structuredClone(artifact.sbom) }),
    })
}

function validateInstallation(value: unknown): RpPackageInstallation {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.lock)) {
    throw new RpRegistryError('Durable installation must be a schemaVersion 1 object with a lock', 'INVALID')
  }
  const rootId = requiredString(value.rootId, 'installation rootId')
  const source = parseStoredSource(value.source)
  const installedAt = requiredTimestamp(value.installedAt, 'installedAt')
  const updatedAt = requiredTimestamp(value.updatedAt, 'updatedAt')
  if (updatedAt < installedAt) throw new RpRegistryError('Installation updatedAt precedes installedAt', 'INVALID')
  const lockValue = value.lock
  if (lockValue.schemaVersion !== 1 || !Array.isArray(lockValue.packages) || lockValue.packages.length === 0) {
    throw new RpRegistryError('Durable installation lock must contain packages', 'INVALID')
  }
  const generatedAt = requiredTimestamp(lockValue.generatedAt, 'lock generatedAt')
  const packages = Object.freeze(lockValue.packages.map((item, index) => parseLockEntry(item, index)))
  const graphHash = requiredSha256(lockValue.graphHash, 'lock graphHash')
  const computed = createHash('sha256').update(canonical(packages as unknown as JsonValue)).digest('hex')
  if (computed !== graphHash) throw new RpRegistryError('Durable installation graph hash is invalid', 'INTEGRITY')
  if (packages.at(-1)?.id !== rootId) {
    throw new RpRegistryError(`Durable installation root ${rootId} is not the final lock entry`, 'INVALID')
  }
  return freezeInstallation({
    schemaVersion: 1,
    rootId,
    source,
    lock: Object.freeze({ schemaVersion: 1, generatedAt, graphHash, packages }),
    installedAt,
    updatedAt,
  })
}

function parseLockEntry(value: unknown, index: number): RpPackageLockEntry {
  if (!isRecord(value) || !Array.isArray(value.dependencies) || typeof value.evidenceVerified !== 'boolean') {
    throw new RpRegistryError(`Durable lock entry ${index} is invalid`, 'INVALID')
  }
  const id = requiredString(value.id, `lock entry ${index} id`)
  const version = requiredString(value.version, `lock entry ${index} version`)
  if (parseVersion(version) === undefined) throw new RpRegistryError(`Lock entry ${id} has invalid SemVer`, 'INVALID')
  const dependencies = Object.freeze(value.dependencies.map((dependency, dependencyIndex) =>
    requiredString(dependency, `lock entry ${index} dependency ${dependencyIndex}`)).sort())
  return Object.freeze({
    id,
    version,
    manifestHash: requiredSha256(value.manifestHash, `lock entry ${index} manifestHash`),
    source: parseStoredSource(value.source),
    dependencies,
    ...(value.payloadSha256 === undefined ? {} : {
      payloadSha256: requiredSha256(value.payloadSha256, `lock entry ${index} payloadSha256`),
    }),
    ...(value.signingKeyId === undefined ? {} : {
      signingKeyId: requiredString(value.signingKeyId, `lock entry ${index} signingKeyId`),
    }),
    ...(value.sbomSha256 === undefined ? {} : {
      sbomSha256: requiredSha256(value.sbomSha256, `lock entry ${index} sbomSha256`),
    }),
    evidenceVerified: value.evidenceVerified,
  })
}

function parseStoredSource(value: unknown): RpPackageSource {
  if (!isRecord(value) || !isSourceKind(value.kind) || typeof value.locator !== 'string'
    || (value.ref !== undefined && typeof value.ref !== 'string')) {
    throw new RpRegistryError('Durable package source is invalid', 'INVALID')
  }
  return freezeSource({
    kind: value.kind,
    locator: value.locator,
    ...(value.ref === undefined ? {} : { ref: value.ref }),
  })
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new RpRegistryError(`${field} is invalid`, 'INVALID')
  return value
}

function requiredSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new RpRegistryError(`${field} must be lowercase SHA-256`, 'INVALID')
  }
  return value
}

function requiredTimestamp(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RpRegistryError(`${field} must be a non-negative safe integer`, 'INVALID')
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareLifecycleAdapters(left: RpPackageLifecycleAdapter, right: RpPackageLifecycleAdapter): number {
  return (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id)
}

function assertUniqueLockVersions(lock: RpPackageLock): void {
  const versions = new Map<string, string>()
  for (const entry of lock.packages) {
    const current = versions.get(entry.id)
    if (current !== undefined && current !== entry.version) {
      throw new RpRegistryError(
        `Dependency graph requires incompatible versions ${entry.id}@${current} and ${entry.version}`,
        'DEPENDENCY',
      )
    }
    versions.set(entry.id, entry.version)
  }
}

function assertActivatedEntries(
  entries: readonly RpPackageLockEntry[],
  active: ReadonlyMap<string, Omit<ActivePackageState, 'owners'>>,
): void {
  for (const entry of entries) {
    if (!active.has(entry.id)) throw new RpRegistryError(`Package ${entry.id} activation disappeared`, 'LIFECYCLE')
  }
}

function deactivateActivated(active: ReadonlyMap<string, Omit<ActivePackageState, 'owners'>>): void {
  const states = [...active.values()].map(state => ({ ...state, owners: new Set<string>() }))
  const failures = deactivateStates(states.reverse())
  if (failures.length > 0) throw new RpRegistryError(`Activated package rollback failed: ${failures.join('; ')}`, 'LIFECYCLE')
}

function disposePrepared(prepared: readonly PreparedPackageState[]): void {
  for (const state of [...prepared].reverse()) {
    try { state.prepared?.dispose() }
    catch { /* Preparation cleanup is best-effort; no runtime registration was published. */ }
  }
}

function deactivateStates(states: readonly ActivePackageState[]): string[] {
  const failures: string[] = []
  for (const state of states) {
    try { state.deactivate?.() }
    catch (error: unknown) { failures.push(`${state.entry.id}@${state.entry.version}: ${renderError(error)}`) }
  }
  return failures
}

function renderError(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error) }
  catch { return '[unrenderable lifecycle error]' }
}

function satisfies(version: string, range: string): boolean {
  if (range === '*') return true
  if (!range.startsWith('^') && !range.startsWith('~')) return version === range
  const candidate = parseVersion(version)
  const base = parseVersion(range.slice(1))
  if (candidate === undefined || base === undefined || compareParsedVersions(candidate, base) < 0) return false
  if (range.startsWith('~')) return candidate.major === base.major && candidate.minor === base.minor
  if (base.major > 0) return candidate.major === base.major
  if (base.minor > 0) return candidate.major === 0 && candidate.minor === base.minor
  return candidate.major === 0 && candidate.minor === 0 && candidate.patch === base.patch
}
function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) return left.localeCompare(right)
  return compareParsedVersions(a, b)
}

interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(value)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return undefined
  return {
    major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  }
}

function compareParsedVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1
  }
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const a = left.prerelease[index]
    const b = right.prerelease[index]
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1
    if (a === b) continue
    const numericA = /^\d+$/u.test(a)
    const numericB = /^\d+$/u.test(b)
    if (numericA && numericB) return Number(a) - Number(b)
    if (numericA !== numericB) return numericA ? -1 : 1
    return a.localeCompare(b)
  }
  return 0
}
function canonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key] as JsonValue)}`)
    .join(',')}}`
}

export default RpRegistry
