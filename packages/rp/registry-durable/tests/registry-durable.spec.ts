import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { RpPackageId } from '@dsh-rp/contracts'
import RpRegistry from '@dsh-rp/registry'
import * as RegistryArtifactsLocal from '@dsh-rp/registry-artifacts-local'
import {
  attachRpPackageSbom, createRpPackageSbom, createRpSigningKeyId, signRpPackageManifest,
} from '@dsh-rp/sdk'
import { afterEach, describe, expect, it } from 'vitest'
import * as RegistryDurable from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const manifest = {
  schemaVersion: 1 as const,
  id: RpPackageId('restart-safe'),
  name: 'Restart safe',
  version: '1.0.0',
  license: 'MIT' as const,
  trust: 'L0' as const,
  dependencies: [],
  components: [],
  capabilities: [],
}

async function createRuntime(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(RpRegistry)
  ctx.rpRegistry.registerProvider({
    kind: 'local', resolve: async source => ({ source, manifest }),
  })
  await ctx.plugin(RegistryDurable)
  return ctx
}

describe('@dsh-rp/registry-durable', () => {
  it('restores and verifies one committed exact lock after a Host restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-registry-'))
    roots.push(root)
    const first = await createRuntime(root)
    const installed = await first.rpRegistry.install({ kind: 'local', locator: 'restart-safe' })
    expect(first.rpRegistry.getInstallationStore()).toEqual({ id: 'storage-domain-v1' })
    await first.fiber.dispose()

    const second = await createRuntime(root)
    expect(second.rpRegistry.listInstallations()).toMatchObject([{
      rootId: 'restart-safe', lock: { graphHash: installed.graphHash },
    }])
    await second.rpRegistry.uninstall('restart-safe')
    await second.fiber.dispose()

    const third = await createRuntime(root)
    expect(third.rpRegistry.listInstallations()).toEqual([])
    await third.fiber.dispose()
  })

  it('restores signed locks whose key identity uses the sha256 fingerprint prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-registry-signed-'))
    roots.push(root)
    const bytes = new TextEncoder().encode('restart-safe signed archive')
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const keyId = createRpSigningKeyId(publicKey)
    const payloadBound = {
      ...manifest,
      id: RpPackageId('signed-restart-safe'),
      integrity: { sha256: createHash('sha256').update(bytes).digest('hex') },
    }
    const sbom = createRpPackageSbom(payloadBound)
    const signed = signRpPackageManifest(attachRpPackageSbom(payloadBound, sbom), privateKey, keyId)
    const createSignedRuntime = async (): Promise<Context> => {
      const ctx = new Context()
      await ctx.plugin(Storage)
      await ctx.plugin(StorageJson, { root })
      await ctx.plugin(StorageDomain, { backend: 'json' })
      await ctx.plugin(RpRegistry)
      ctx.rpRegistry.registerSigningKey(publicKey)
      ctx.rpRegistry.registerProvider({
        kind: 'local', resolve: async source => ({ source, manifest: signed, bytes, sbom }),
      })
      await ctx.plugin(RegistryDurable)
      return ctx
    }

    const first = await createSignedRuntime()
    await first.rpRegistry.install({ kind: 'local', locator: 'signed-restart-safe' })
    await first.fiber.dispose()
    const restarted = await createSignedRuntime()
    expect(restarted.rpRegistry.listInstallations()).toMatchObject([{
      rootId: 'signed-restart-safe', lock: { packages: [{ signingKeyId: keyId }] },
    }])
    await restarted.fiber.dispose()
  })

  it('restores a payload from the durable content-addressed cache after source archive loss', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-registry-cached-'))
    const artifactRoot = await mkdtemp(join(tmpdir(), 'dsh-rp-artifacts-cached-'))
    roots.push(root, artifactRoot)
    const bytes = new TextEncoder().encode('cached restart archive')
    const cachedManifest = {
      ...manifest,
      id: RpPackageId('cached-restart-safe'),
      integrity: { sha256: createHash('sha256').update(bytes).digest('hex') },
    }
    const createCachedRuntime = async (sourceHasArchive: boolean): Promise<Context> => {
      const ctx = new Context()
      await ctx.plugin(Storage)
      await ctx.plugin(StorageJson, { root })
      await ctx.plugin(StorageDomain, { backend: 'json' })
      await ctx.plugin(RpRegistry)
      ctx.rpRegistry.registerProvider({
        kind: 'local',
        resolve: async source => ({
          source, manifest: cachedManifest, ...(sourceHasArchive ? { bytes } : {}),
        }),
      })
      await ctx.plugin(RegistryArtifactsLocal, { root: artifactRoot, maxBytes: 1024 })
      await ctx.plugin(RegistryDurable)
      return ctx
    }

    const first = await createCachedRuntime(true)
    await first.rpRegistry.install({ kind: 'local', locator: 'cached-restart-safe' })
    await first.fiber.dispose()
    const restarted = await createCachedRuntime(false)
    expect(restarted.rpRegistry.listInstallations()).toMatchObject([{ rootId: 'cached-restart-safe' }])
    await restarted.fiber.dispose()
  })
})
