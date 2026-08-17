import { createHash, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RpPackageId } from '@dsh-rp/contracts'
import {
  attachRpPackageSbom, createRpPackageSbom, createRpSigningKeyId, signRpPackageManifest,
} from '@dsh-rp/sdk'
import { RpRegistry, parseRpPackageSource, type RpPackageInstallation } from '../src/index.ts'

const manifest = (id: string, version: string, dependencies: { id: ReturnType<typeof RpPackageId>; version: string }[] = []) => ({ schemaVersion: 1 as const, id: RpPackageId(id), name: id, version, license: 'MIT' as const, trust: 'L0' as const, dependencies, components: [], capabilities: [] })

describe('RP registry', () => {
  it('resolves a deterministic dependency graph and hash', () => {
    const registry = new RpRegistry(new Context())
    registry.publish(manifest('memory', '1.0.0'), parseRpPackageSource('npm:memory@1.0.0'), 1)
    registry.publish(manifest('world', '1.0.0', [{ id: RpPackageId('memory'), version: '^1.0.0' }]), parseRpPackageSource('git+https://example.test/world.git#v1'), 1)
    const first = registry.lock('world', '*', 10); const second = registry.lock('world', '*', 20)
    expect(first.packages.map(item => item.id)).toEqual(['memory', 'world'])
    expect(first.graphHash).toBe(second.graphHash)
    expect(() => (registry.resolve('memory').manifest.capabilities as string[]).push('mutate'))
      .toThrow(TypeError)
  })

  it('orders stable releases above prereleases and respects zero-major caret boundaries', () => {
    const registry = new RpRegistry(new Context())
    registry.publish(manifest('versioned', '1.0.0-beta.2'), parseRpPackageSource('npm:versioned@beta'), 1)
    registry.publish(manifest('versioned', '1.0.0'), parseRpPackageSource('npm:versioned@1'), 1)
    registry.publish(manifest('zero', '0.2.9'), parseRpPackageSource('npm:zero@0.2.9'), 1)
    registry.publish(manifest('zero', '0.3.0'), parseRpPackageSource('npm:zero@0.3.0'), 1)
    expect(registry.resolve('versioned').manifest.version).toBe('1.0.0')
    expect(registry.resolve('zero', '^0.2.0').manifest.version).toBe('0.2.9')
  })

  it('fails closed for revocations and supports reversible providers', async () => {
    const registry = new RpRegistry(new Context()); const value = manifest('card', '1.0.0')
    const release = registry.registerProvider({ kind: 'local', resolve: async source => ({ source, manifest: value }) })
    await expect(registry.install(parseRpPackageSource('./card'))).resolves.toMatchObject({
      schemaVersion: 1, packages: [{ evidenceVerified: false }],
    })
    registry.revoke({ id: 'card', version: '1.0.0', reason: 'test' })
    expect(() => registry.resolve('card')).toThrow(/revoked/u)
    release(); await expect(registry.install(parseRpPackageSource('./other'))).rejects.toMatchObject({ code: 'NO_PROVIDER' })
  })

  it('enforces payload, SBOM, trusted Ed25519 signing, key revocation, and lock provenance', async () => {
    const registry = new RpRegistry(new Context())
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const keyId = createRpSigningKeyId(publicKey)
    const bytes = new TextEncoder().encode('signed package')
    const base = {
      ...manifest('signed', '1.0.0'),
      integrity: { sha256: createHash('sha256').update(bytes).digest('hex') },
    }
    const sbom = createRpPackageSbom(base)
    const signed = signRpPackageManifest(attachRpPackageSbom(base, sbom), privateKey, keyId)
    registry.registerSigningKey(publicKey)
    registry.registerSecurityPolicy({
      id: 'public-release', requirePayloadIntegrity: true, requireSignature: true, requireSbom: true,
    })
    registry.registerProvider({ kind: 'registry', resolve: async source => ({ source, manifest: signed, bytes, sbom }) })
    const lock = await registry.install(parseRpPackageSource('registry:signed@1.0.0'))
    expect(lock.packages[0]).toMatchObject({
      id: 'signed', payloadSha256: signed.integrity?.sha256, signingKeyId: keyId,
      sbomSha256: signed.integrity?.sbom, evidenceVerified: true,
    })
    registry.revokeSigningKey({ keyId, reason: 'publisher key compromised', revokedAt: 2 })
    expect(() => registry.resolve('signed')).toThrow(/revoked signing key/u)
    expect(registry.listSigningKeyRevocations()).toEqual([{ keyId, reason: 'publisher key compromised', revokedAt: 2 }])
  })

  it('caches artifacts by verified digest and gives lifecycle adapters detached bytes', async () => {
    const bytes = new TextEncoder().encode('verified lifecycle archive')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const value = { ...manifest('artifact-runtime', '1.0.0'), trust: 'L1' as const, integrity: { sha256 } }
    class ArtifactCache {
      readonly id = 'class-cache'
      readonly values = new Map<string, Uint8Array>()
      async get(key: string): Promise<Uint8Array | undefined> { return this.values.get(key)?.slice() }
      async put(key: string, payload: Uint8Array): Promise<void> { this.values.set(key, payload.slice()) }
    }
    const cache = new ArtifactCache()
    const create = (fromSource: boolean): { registry: RpRegistry; seen: number[] } => {
      const registry = new RpRegistry(new Context())
      const seen: number[] = []
      registry.registerArtifactStore(cache)
      registry.registerProvider({
        kind: 'local', resolve: async source => ({ source, manifest: value, ...(fromSource ? { bytes } : {}) }),
      })
      registry.registerLifecycleAdapter({
        id: 'artifact-adapter',
        supports: release => release.manifest.trust === 'L1',
        prepare: async ({ payload }) => {
          if (payload === undefined) throw new Error('missing verified payload')
          seen.push(payload[0] ?? -1)
          payload[0] = 0
          return { activate: () => () => {}, dispose() {} }
        },
      })
      return { registry, seen }
    }
    const first = create(true)
    await first.registry.install({ kind: 'local', locator: 'artifact-runtime' })
    expect(cache.values.get(sha256)).toEqual(bytes)
    expect(first.seen).toEqual([bytes[0]])

    const second = create(false)
    await second.registry.install({ kind: 'local', locator: 'artifact-runtime' })
    expect(second.seen).toEqual([bytes[0]])
  })

  it('rejects corrupt cached archives and cache publication failures before activation', async () => {
    const bytes = new TextEncoder().encode('expected archive')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const value = { ...manifest('cache-guard', '1.0.0'), integrity: { sha256 } }
    const corrupt = new RpRegistry(new Context())
    corrupt.registerArtifactStore({
      id: 'corrupt-cache',
      get: async () => new TextEncoder().encode('different archive'),
      put: async () => {},
    })
    corrupt.registerProvider({ kind: 'local', resolve: async source => ({ source, manifest: value }) })
    await expect(corrupt.install({ kind: 'local', locator: 'cache-guard' }))
      .rejects.toMatchObject({ code: 'INTEGRITY' })
    expect(corrupt.list()).toEqual([])

    const unavailable = new RpRegistry(new Context())
    unavailable.registerArtifactStore({
      id: 'unavailable-cache', get: async () => undefined,
      put: async () => { throw new Error('cache disk unavailable') },
    })
    unavailable.registerProvider({
      kind: 'local', resolve: async source => ({ source, manifest: value, bytes }),
    })
    await expect(unavailable.install({ kind: 'local', locator: 'cache-guard' }))
      .rejects.toMatchObject({ code: 'LIFECYCLE' })
    expect(unavailable.list()).toEqual([])
  })

  it('rejects unsigned packages under a signature policy without publishing partial state', async () => {
    const registry = new RpRegistry(new Context())
    registry.registerSecurityPolicy({ id: 'signed-only', requireSignature: true })
    registry.registerProvider({
      kind: 'local', resolve: async source => ({ source, manifest: manifest('unsigned', '1.0.0') }),
    })
    await expect(registry.install(parseRpPackageSource('./unsigned'))).rejects.toMatchObject({ code: 'POLICY' })
    expect(registry.list('unsigned')).toEqual([])
  })

  it('does not treat metadata-only publication as verified package evidence', () => {
    const registry = new RpRegistry(new Context())
    registry.publish(manifest('metadata', '1.0.0'), parseRpPackageSource('registry:metadata'), 1)
    expect(registry.resolve('metadata').evidenceVerified).toBe(false)
    registry.registerSecurityPolicy({ id: 'integrity-required', requirePayloadIntegrity: true })
    expect(() => registry.resolve('metadata')).toThrow(/evidence verification/u)
    expect(() => registry.publish(manifest('later', '1.0.0'), parseRpPackageSource('registry:later'), 1))
      .toThrow(/use install/u)
  })

  it('parses exact unscoped and scoped npm sources without losing package identity', () => {
    expect(parseRpPackageSource('npm:story-kit@1.2.3')).toEqual({
      kind: 'npm', locator: 'story-kit', ref: '1.2.3',
    })
    expect(parseRpPackageSource('npm:@acme/story-kit@1.2.3-beta.1')).toEqual({
      kind: 'npm', locator: '@acme/story-kit', ref: '1.2.3-beta.1',
    })
    expect(() => parseRpPackageSource('npm:story-kit@')).toThrow(/ref cannot be empty/u)
    expect(() => parseRpPackageSource('git+https:\/\/example.test\/story-kit.git#')).toThrow(/ref cannot be empty/u)
  })

  it('serializes lifecycle mutations while a provider is resolving', async () => {
    const registry = new RpRegistry(new Context())
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    registry.registerProvider({
      kind: 'local',
      resolve: async (source) => {
        await waiting
        return { source, manifest: manifest('serialized', '1.0.0') }
      },
    })
    const installing = registry.install({ kind: 'local', locator: 'serialized' })
    await expect(registry.install({ kind: 'local', locator: 'second' }))
      .rejects.toMatchObject({ code: 'LIFECYCLE' })
    await expect(registry.uninstall('serialized')).rejects.toThrow(/transaction is active/u)
    release()
    await expect(installing).resolves.toMatchObject({ packages: [{ id: 'serialized' }] })
  })

  it('does not reinterpret committed state when an observer throws', async () => {
    const ctx = new Context()
    const registry = new RpRegistry(ctx)
    ctx.on('rp/registry-changed', () => { throw new Error('observer failed') })
    ctx.on('rp/package-installed', () => { throw new Error('observer failed') })
    registry.registerProvider({
      kind: 'local', resolve: async source => ({ source, manifest: manifest('observed', '1.0.0') }),
    })
    await expect(registry.install({ kind: 'local', locator: 'observed' }))
      .resolves.toMatchObject({ packages: [{ id: 'observed' }] })
    expect(registry.listInstallations()).toHaveLength(1)
    expect(registry.list('observed')).toHaveLength(1)
  })

  it('persists exact installations and restores them through verified sources after restart', async () => {
    const records = new Map<string, RpPackageInstallation>()
    const store = {
      id: 'memory-durable-fixture',
      load: async () => [...records.values()].map(record => structuredClone(record)),
      put: async (record: RpPackageInstallation) => {
        records.set(record.rootId, structuredClone(record))
      },
      delete: async (rootId: string) => { records.delete(rootId) },
    }
    const first = new RpRegistry(new Context())
    first.registerInstallationStore(store)
    first.registerProvider({
      kind: 'local', resolve: async source => ({ source, manifest: manifest('durable-root', '1.0.0') }),
    })
    const lock = await first.install({ kind: 'local', locator: 'durable-root' })
    expect(records.get('durable-root')?.lock.graphHash).toBe(lock.graphHash)

    const restarted = new RpRegistry(new Context())
    restarted.registerInstallationStore(store)
    restarted.registerProvider({
      kind: 'local', resolve: async source => ({ source, manifest: manifest('durable-root', '1.0.0') }),
    })
    await expect(restarted.restoreInstallations()).resolves.toMatchObject([{ rootId: 'durable-root' }])
    expect(restarted.listActivePackages()).toMatchObject([{ id: 'durable-root', owners: ['durable-root'] }])
    await restarted.uninstall('durable-root')
    expect(records.size).toBe(0)
  })

  it('rolls runtime activation back when durable commit fails', async () => {
    const registry = new RpRegistry(new Context())
    registry.registerInstallationStore({
      id: 'failing-store', load: async () => [],
      put: async () => { throw new Error('disk full') },
      delete: async () => {},
    })
    registry.registerProvider({
      kind: 'local', resolve: async source => ({
        source, manifest: { ...manifest('durability-required', '1.0.0'), trust: 'L1' },
      }),
    })
    const active = new Set<string>()
    registry.registerLifecycleAdapter({
      id: 'durable-runtime',
      supports: release => release.manifest.trust === 'L1',
      prepare: async ({ entry }) => ({
        activate() {
          active.add(entry.id)
          return () => { active.delete(entry.id) }
        },
        dispose() {},
      }),
    })
    await expect(registry.install({ kind: 'local', locator: 'durability-required' }))
      .rejects.toThrow(/disk full/u)
    expect(active).toEqual(new Set())
    expect(registry.listInstallations()).toEqual([])
  })

  it('restores the previous runtime when durable update or delete fails', async () => {
    const registry = new RpRegistry(new Context())
    let durable: RpPackageInstallation | undefined
    let failPut = false
    let failDelete = false
    registry.registerInstallationStore({
      id: 'controlled-store',
      load: async () => durable === undefined ? [] : [durable],
      put: async (record) => {
        if (failPut) throw new Error('put rejected')
        durable = structuredClone(record)
      },
      delete: async () => {
        if (failDelete) throw new Error('delete rejected')
        durable = undefined
      },
    })
    registry.registerProvider({
      kind: 'npm', resolve: async source => ({
        source, manifest: { ...manifest('durable-runtime', source.ref ?? '1.0.0'), trust: 'L1' },
      }),
    })
    const active = new Set<string>()
    registry.registerLifecycleAdapter({
      id: 'controlled-runtime',
      supports: release => release.manifest.trust === 'L1',
      prepare: async ({ entry }) => ({
        activate() {
          active.add(entry.version)
          return () => { active.delete(entry.version) }
        },
        dispose() {},
      }),
    })
    await registry.install(parseRpPackageSource('npm:durable-runtime@1.0.0'))
    failPut = true
    await expect(registry.update(parseRpPackageSource('npm:durable-runtime@2.0.0')))
      .rejects.toThrow(/put rejected/u)
    expect(active).toEqual(new Set(['1.0.0']))
    expect(registry.listInstallations()).toMatchObject([{ lock: { packages: [{ version: '1.0.0' }] } }])
    failPut = false
    failDelete = true
    await expect(registry.uninstall('durable-runtime')).rejects.toThrow(/delete rejected/u)
    expect(active).toEqual(new Set(['1.0.0']))
    expect(registry.listInstallations()).toHaveLength(1)
  })

  it('rolls back dependency activation when a later package fails', async () => {
    const registry = new RpRegistry(new Context())
    registry.publish({ ...manifest('runtime-dependency', '1.0.0'), trust: 'L1' }, parseRpPackageSource('npm:runtime-dependency@1.0.0'), 1)
    const root = {
      ...manifest('runtime-root', '1.0.0', [{ id: RpPackageId('runtime-dependency'), version: '1.0.0' }]),
      trust: 'L1' as const,
    }
    registry.registerProvider({ kind: 'local', resolve: async source => ({ source, manifest: root }) })
    const trace: string[] = []
    registry.registerLifecycleAdapter({
      id: 'fixture-native',
      supports: release => release.manifest.trust === 'L1',
      prepare: async ({ entry }) => ({
        activate() {
          trace.push(`activate:${entry.id}`)
          if (entry.id === 'runtime-root') throw new Error('root activation failed')
          return () => { trace.push(`deactivate:${entry.id}`) }
        },
        dispose() { trace.push(`dispose:${entry.id}`) },
      }),
    })
    await expect(registry.install(parseRpPackageSource('./runtime-root')))
      .rejects.toThrow('root activation failed')
    expect(trace).toEqual([
      'activate:runtime-dependency', 'activate:runtime-root',
      'deactivate:runtime-dependency', 'dispose:runtime-root',
    ])
    expect(registry.listInstallations()).toEqual([])
    expect(registry.listActivePackages()).toEqual([])
    expect(registry.list('runtime-root')).toEqual([])
  })

  it('reference-counts shared dependencies across root uninstall', async () => {
    const registry = new RpRegistry(new Context())
    registry.publish(manifest('shared-data', '1.0.0'), parseRpPackageSource('npm:shared-data@1.0.0'), 1)
    const roots = new Map([
      ['root-a', manifest('root-a', '1.0.0', [{ id: RpPackageId('shared-data'), version: '1.0.0' }])],
      ['root-b', manifest('root-b', '1.0.0', [{ id: RpPackageId('shared-data'), version: '1.0.0' }])],
    ])
    registry.registerProvider({
      kind: 'local',
      resolve: async source => ({ source, manifest: roots.get(source.locator) }),
    })
    await registry.install({ kind: 'local', locator: 'root-a' })
    await registry.install({ kind: 'local', locator: 'root-b' })
    expect(registry.listActivePackages().find(item => item.id === 'shared-data')?.owners)
      .toEqual(['root-a', 'root-b'])
    await registry.uninstall('root-a')
    expect(registry.listActivePackages().find(item => item.id === 'shared-data')?.owners).toEqual(['root-b'])
    await registry.uninstall('root-b')
    expect(registry.listInstallations()).toEqual([])
    expect(registry.listActivePackages()).toEqual([])
  })

  it('updates a runtime package atomically and restores the prior version on failure', async () => {
    const registry = new RpRegistry(new Context())
    registry.registerProvider({
      kind: 'npm',
      resolve: async source => ({
        source,
        manifest: { ...manifest('live-runtime', source.ref ?? '1.0.0'), trust: 'L1' },
      }),
    })
    const active = new Set<string>()
    registry.registerLifecycleAdapter({
      id: 'live-runtime-adapter', priority: 10,
      supports: release => release.manifest.trust === 'L1',
      prepare: async ({ entry }) => ({
        activate() {
          if (entry.version === '3.0.0') throw new Error('v3 rejected')
          active.add(entry.version)
          return () => { active.delete(entry.version) }
        },
        dispose() {},
      }),
    })
    await registry.install(parseRpPackageSource('npm:live-runtime@1.0.0'))
    await expect(registry.update(parseRpPackageSource('npm:live-runtime@2.0.0')))
      .resolves.toMatchObject({ packages: [{ version: '2.0.0' }] })
    expect(active).toEqual(new Set(['2.0.0']))
    await expect(registry.update(parseRpPackageSource('npm:live-runtime@3.0.0')))
      .rejects.toThrow('v3 rejected')
    expect(registry.listInstallations()[0]?.lock.packages).toMatchObject([{ version: '2.0.0' }])
    expect(registry.listActivePackages()).toMatchObject([{
      id: 'live-runtime', version: '2.0.0', runtimeActive: true,
      lifecycleAdapterId: 'live-runtime-adapter',
    }])
    expect(active).toEqual(new Set(['2.0.0']))
  })

  it('fails closed when executable trust has no lifecycle adapter', async () => {
    const registry = new RpRegistry(new Context())
    registry.registerProvider({
      kind: 'local', resolve: async source => ({
        source, manifest: { ...manifest('native-without-adapter', '1.0.0'), trust: 'L2' },
      }),
    })
    await expect(registry.install({ kind: 'local', locator: 'native-without-adapter' }))
      .rejects.toMatchObject({ code: 'NO_ACTIVATOR' })
    expect(registry.list('native-without-adapter')).toEqual([])
  })
})
