import { createHash, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import RpComponentRegistry from '@dsh-rp/component-runtime'
import { RpCapabilityId, RpPackageId } from '@dsh-rp/contracts'
import { RP_RUNTIME_V1 } from '@dsh-rp/package-runtime'
import RpPipelineRuntime from '@dsh-rp/pipeline-runtime'
import RpUiSlotRegistry from '@dsh-rp/ui-slot-runtime'
import RpRegistry from '@dsh-rp/registry'
import {
  attachRpPackageSbom,
  createRpPackageSbom,
  createRpSigningKeyId,
  signRpPackageManifest,
} from '@dsh-rp/sdk'
import { createRpTestArchive } from '../../package-runtime/tests/archive-fixture.ts'
import * as LifecycleL2 from '../src/index.ts'

describe('@dsh-rp/lifecycle-l2', () => {
  it('activates signed native code only after install and releases it on uninstall', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRegistry)
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPipelineRuntime)
    await ctx.plugin(RpUiSlotRegistry)
    await ctx.plugin(RpRegistry)
    await ctx.plugin(LifecycleL2, { defaultTimeoutMs: 500, maxTimeoutMs: 1_000 })
    const id = RpCapabilityId('test.l2.native')
    const timeoutId = RpCapabilityId('test.l2.timeout')
    const invalidOutputId = RpCapabilityId('test.l2.invalid-output')
    const marker = '__dshRpL2PreparationMarker'
    Reflect.deleteProperty(globalThis, marker)
    const source = `(() => {
      globalThis.${marker} = (globalThis.${marker} ?? 0) + 1;
      return (input, authority) => ({ input, trust: authority.trust, permission: authority.permissions[0] });
    })()`
    const bytes = await createRpTestArchive([
      { name: 'native.js', body: source },
      { name: 'timeout.js', body: '() => new Promise(() => {})' },
      { name: 'invalid-output.js', body: '() => undefined' },
      { name: 'rp.runtime.json', body: JSON.stringify({
        schemaVersion: 1,
        components: [],
        capabilities: [{
          id: String(id), kind: 'tool', title: 'Native', description: 'Trusted native function.',
          scopes: ['conversation'], permissions: [LifecycleL2.L2_EXECUTION_PERMISSION],
          implementation: { kind: 'native', path: 'native.js' },
        }, {
          id: String(timeoutId), kind: 'tool', title: 'Timeout', description: 'Never settles.',
          scopes: ['conversation'], permissions: [LifecycleL2.L2_EXECUTION_PERMISSION],
          implementation: { kind: 'native', path: 'timeout.js' },
        }, {
          id: String(invalidOutputId), kind: 'tool', title: 'Invalid output', description: 'Returns undefined.',
          scopes: ['conversation'], permissions: [LifecycleL2.L2_EXECUTION_PERMISSION],
          implementation: { kind: 'native', path: 'invalid-output.js' },
        }],
      }) },
    ])
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const keyId = createRpSigningKeyId(publicKey)
    const base = {
      schemaVersion: 1 as const,
      id: RpPackageId('test-l2-package'),
      name: 'Test L2 package',
      version: '1.0.0',
      license: 'MIT' as const,
      trust: 'L2' as const,
      dependencies: [],
      components: [],
      capabilities: [String(id), String(timeoutId), String(invalidOutputId)],
      permissions: [LifecycleL2.L2_EXECUTION_PERMISSION],
      compatibility: { runtime: RP_RUNTIME_V1 },
      integrity: { sha256: createHash('sha256').update(bytes).digest('hex') },
    }
    const sbom = createRpPackageSbom(base)
    const manifest = signRpPackageManifest(attachRpPackageSbom(base, sbom), privateKey, keyId)
    ctx.rpRegistry.registerSigningKey(publicKey)
    ctx.rpRegistry.registerProvider({ kind: 'local', resolve: async sourceValue => ({
      source: sourceValue, manifest, bytes, sbom,
    }) })

    await ctx.rpRegistry.install({ kind: 'local', locator: 'test-l2-package' })
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined()
    await expect(ctx.rpCapabilities.invoke(id, {
      scope: { kind: 'conversation', id: 'conversation-1' },
      input: { answer: 42 },
      grantedPermissions: [LifecycleL2.L2_EXECUTION_PERMISSION],
      grantedTrust: 'L2',
      budget: { timeoutMs: 500 },
    })).resolves.toEqual({
      input: { answer: 42 }, trust: 'L2', permission: LifecycleL2.L2_EXECUTION_PERMISSION,
    })
    expect((globalThis as Record<string, unknown>)[marker]).toBe(1)
    const authority = {
      scope: { kind: 'conversation' as const, id: 'conversation-1' },
      input: null,
      grantedPermissions: [LifecycleL2.L2_EXECUTION_PERMISSION],
      grantedTrust: 'L2' as const,
      budget: { timeoutMs: 20 },
    }
    await expect(ctx.rpCapabilities.invoke(timeoutId, authority)).rejects.toMatchObject({ code: 'TIMEOUT' })
    await expect(ctx.rpCapabilities.invoke(invalidOutputId, authority)).rejects.toMatchObject({ code: 'OUTPUT' })

    await ctx.rpRegistry.uninstall(String(manifest.id))
    expect(ctx.rpCapabilities.get(id)).toBeUndefined()
    expect(ctx.rpCapabilities.get(timeoutId)).toBeUndefined()
    Reflect.deleteProperty(globalThis, marker)
    await ctx.fiber.dispose()
  })

  it('rejects native archives without trusted signature and hash-bound SBOM', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRegistry)
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPipelineRuntime)
    await ctx.plugin(RpUiSlotRegistry)
    await ctx.plugin(RpRegistry)
    await ctx.plugin(LifecycleL2, {})
    const id = RpCapabilityId('test.l2.unsigned')
    const bytes = await createRpTestArchive([
      { name: 'native.js', body: 'input => input' },
      { name: 'rp.runtime.json', body: JSON.stringify({
        schemaVersion: 1, components: [], capabilities: [{
          id: String(id), kind: 'tool', title: 'Unsigned', description: 'Must fail.', scopes: ['deployment'],
          permissions: [LifecycleL2.L2_EXECUTION_PERMISSION], implementation: { kind: 'native', path: 'native.js' },
        }],
      }) },
    ])
    const manifest = {
      schemaVersion: 1 as const, id: RpPackageId('unsigned-l2'), name: 'Unsigned L2', version: '1.0.0',
      license: 'MIT' as const, trust: 'L2' as const, dependencies: [], components: [], capabilities: [String(id)],
      permissions: [LifecycleL2.L2_EXECUTION_PERMISSION], compatibility: { runtime: RP_RUNTIME_V1 },
      integrity: { sha256: createHash('sha256').update(bytes).digest('hex') },
    }
    ctx.rpRegistry.registerProvider({ kind: 'local', resolve: async source => ({ source, manifest, bytes }) })
    await expect(ctx.rpRegistry.install({ kind: 'local', locator: 'unsigned-l2' }))
      .rejects.toMatchObject({ code: 'EVIDENCE' })
    expect(ctx.rpCapabilities.get(id)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
