import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { RpCapabilityId } from '@dsh-rp/contracts'
import { parseRpRuntimeArchive, RP_RUNTIME_V1, type RpRuntimeDescriptor } from '@dsh-rp/package-runtime'
import {
  attachRpPackageSbom, buildRpPackage, createRpPackageManifest, createRpPackageSbom, createRpSigningKeyId,
  DEFAULT_RP_RUNTIME_ARCHIVE_LIMITS,
  migrateRpPackageManifest, signRpPackageManifest, validateRpPackageManifest, verifyRpPackageIntegrity,
  verifyRpPackageSbom, verifyRpPackageSignature,
} from '../src/index.ts'

describe('RP SDK', () => {
  it('builds deterministic Registry artifacts and verifies them through the runtime boundary', async () => {
    const manifest = {
      ...createRpPackageManifest('runtime-plugin'),
      capabilities: [RpCapabilityId('runtime-plugin.echo')],
      compatibility: { runtime: RP_RUNTIME_V1 },
      integrity: { sha256: '0'.repeat(64) },
    }
    const descriptor: RpRuntimeDescriptor = {
      schemaVersion: 1,
      components: [],
      capabilities: [{
        id: RpCapabilityId('runtime-plugin.echo'), kind: 'tool', title: 'Echo',
        description: 'Returns its input.', scopes: ['conversation'],
        implementation: { kind: 'expression', expression: { op: 'input' } },
      }],
    }
    const first = await buildRpPackage({ manifest, descriptor })
    const second = await buildRpPackage({ manifest, descriptor })
    expect(first.archive).toEqual(second.archive)
    expect(first.manifest.integrity?.sha256).not.toBe('0'.repeat(64))
    expect(verifyRpPackageIntegrity(first.archive, first.manifest)).toBe(true)
    expect(verifyRpPackageSbom(first.sbom, first.manifest)).toBe(true)
    expect((await parseRpRuntimeArchive(
      first.archive, first.manifest, DEFAULT_RP_RUNTIME_ARCHIVE_LIMITS,
    )).descriptor).toEqual(descriptor)
  })

  it('rejects executable trust packages without the lifecycle permission contract or L2 signature', async () => {
    const l1Manifest = {
      ...createRpPackageManifest('script-plugin'),
      trust: 'L1' as const,
      capabilities: [RpCapabilityId('script.run')],
      compatibility: { runtime: RP_RUNTIME_V1 },
    }
    const l1Descriptor: RpRuntimeDescriptor = {
      schemaVersion: 1, components: [],
      capabilities: [{
        id: RpCapabilityId('script.run'), kind: 'tool', title: 'Run', description: 'Runs script.',
        scopes: ['conversation'], implementation: { kind: 'quickjs', path: 'main.js' },
      }],
    }
    await expect(buildRpPackage({
      manifest: l1Manifest,
      descriptor: l1Descriptor,
      files: [{ path: 'main.js', bytes: new TextEncoder().encode('input => input') }],
    })).rejects.toThrow(/script\.execute/u)

    await expect(buildRpPackage({
      manifest: { ...l1Manifest, trust: 'L2' as const },
      descriptor: { schemaVersion: 1, components: [], capabilities: [] },
    })).rejects.toThrow(/Ed25519 signing authority/u)
  })

  it('creates a safe L0 manifest with a stable hash', () => {
    const manifest = createRpPackageManifest('@example/story-kit')
    const first = validateRpPackageManifest(manifest)
    const second = validateRpPackageManifest({ ...manifest })
    expect(first.valid).toBe(true)
    expect(first.sha256).toBe(second.sha256)
    expect(first.manifest?.trust).toBe('L0')
  })

  it('validates integrity metadata, verifies bytes, and emits a deterministic SBOM', () => {
    const data = new TextEncoder().encode('plugin')
    const manifest = { ...createRpPackageManifest('plugin'), integrity: { sha256: '5e689e2b01672bf33996e75d5e372ff60c536ce1599a1458e867cd8f4bef5160' } }
    expect(validateRpPackageManifest(manifest).valid).toBe(true)
    expect(verifyRpPackageIntegrity(data, manifest)).toBe(true)
    expect(createRpPackageSbom(manifest)).toMatchObject({ bomFormat: 'CycloneDX', specVersion: '1.5' })
  })

  it('binds payload and SBOM integrity into a canonical Ed25519 signature', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const data = new TextEncoder().encode('plugin')
    const sbom = createRpPackageSbom(createRpPackageManifest('signed-plugin'))
    const withIntegrity = attachRpPackageSbom({
      ...createRpPackageManifest('signed-plugin'),
      integrity: { sha256: '5e689e2b01672bf33996e75d5e372ff60c536ce1599a1458e867cd8f4bef5160' },
    }, sbom)
    const signed = signRpPackageManifest(withIntegrity, privateKey, createRpSigningKeyId(publicKey))
    expect(verifyRpPackageIntegrity(data, signed)).toBe(true)
    expect(verifyRpPackageSbom(sbom, signed)).toBe(true)
    expect(verifyRpPackageSignature(signed, publicKey)).toBe(true)
    expect(verifyRpPackageSignature({ ...signed, version: '1.0.1' }, publicKey)).toBe(false)
    expect(validateRpPackageManifest({ ...signed, integrity: { ...signed.integrity, signature: 'not-base64' } }).valid).toBe(false)
  })

  it('reports all structural errors without loading code', () => {
    const result = validateRpPackageManifest({ schemaVersion: 2, id: '', license: 'GPL', trust: 'root' })
    expect(result.valid).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(5)
  })

  it('preserves validated optional dependency semantics', () => {
    const result = validateRpPackageManifest({
      ...createRpPackageManifest('optional-host'),
      dependencies: [{ id: 'optional-provider', version: '^1.0.0', optional: true }],
    })
    expect(result.manifest?.dependencies).toEqual([{
      id: 'optional-provider', version: '^1.0.0', optional: true,
    }])
  })

  it('preserves signed UI Slot and asset declarations during normalization', () => {
    const result = validateRpPackageManifest({
      ...createRpPackageManifest('ui-host'),
      uiSlots: ['overview'],
      assets: ['ui/index.html', 'ui/styles.css'],
    })
    expect(result.manifest).toMatchObject({
      uiSlots: ['overview'], assets: ['ui/index.html', 'ui/styles.css'],
    })
  })

  it('migrates the explicit legacy shape and rejects arbitrary versions', () => {
    expect(migrateRpPackageManifest({ id: 'legacy', components: ['actor'] })).toMatchObject({
      schemaVersion: 1, id: 'legacy', license: 'MIT', trust: 'L0', components: ['actor'],
    })
    expect(() => migrateRpPackageManifest({ schemaVersion: 99, id: 'future' })).toThrow(/schemaVersion 0 or 1/)
  })
})
