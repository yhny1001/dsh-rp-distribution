import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RpPackageId, type RpPackageManifest } from '@dsh-rp/contracts'
import RpRegistry from '@dsh-rp/registry'
import { createRpNpmReleaseEnvelope } from '@dsh-rp/package-runtime'
import * as RegistrySources from '../src/index.ts'

const manifest = {
  schemaVersion: 1,
  id: 'fixture',
  name: 'Fixture',
  version: '1.0.0',
  license: 'MIT',
  trust: 'L0',
  dependencies: [],
  components: [],
  capabilities: [],
}

describe('RP Registry sources', () => {
  it('reads only allowlisted local manifests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-registry-'))
    try {
      const path = join(root, 'rp.package.json')
      await writeFile(path, JSON.stringify(manifest))
      const local = RegistrySources.createRegistrySourceProviders({ localRoots: [root] }).find(item => item.kind === 'local')
      await expect(local?.resolve({ kind: 'local', locator: root })).resolves.toMatchObject({ manifest })
      const denied = RegistrySources.createRegistrySourceProviders({ localRoots: [] }).find(item => item.kind === 'local')
      await expect(denied?.resolve({ kind: 'local', locator: root })).rejects.toThrow('disabled')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('acquires integrity-bound local archives and SBOMs without executing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-registry-evidence-'))
    const bytes = new TextEncoder().encode('local archive')
    const sbom = 'fixture-sbom'
    const evidenced = {
      ...manifest,
      integrity: {
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sbom: createHash('sha256').update(JSON.stringify(sbom)).digest('hex'),
      },
    }
    try {
      await writeFile(join(root, 'rp.package.json'), JSON.stringify(evidenced))
      await writeFile(join(root, 'rp.package.tgz'), bytes)
      await writeFile(join(root, 'rp.sbom.json'), JSON.stringify(sbom))
      const local = RegistrySources.createRegistrySourceProviders({ localRoots: [root] })
        .find(item => item.kind === 'local')
      const resolved = await local?.resolve({ kind: 'local', locator: root })
      expect(resolved?.bytes).toEqual(bytes)
      expect(resolved?.sbom).toBe(sbom)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('maps pinned GitHub and GitLab repositories to inert raw manifests', () => {
    expect(RegistrySources.gitManifestUrl(
      { kind: 'git', locator: 'https://github.com/acme/plugin.git', ref: 'abc123' },
      ['github.com'],
    ).href).toBe('https://raw.githubusercontent.com/acme/plugin/abc123/rp.package.json')
    expect(RegistrySources.gitManifestUrl(
      { kind: 'git', locator: 'https://gitlab.com/acme/plugin', ref: 'v1.0.0' },
      ['gitlab.com'],
    ).href).toBe('https://gitlab.com/acme/plugin/-/raw/v1.0.0/rp.package.json')
  })

  it('keeps network sources denied until an origin is configured', async () => {
    const providers = RegistrySources.createRegistrySourceProviders({})
    const registry = providers.find(item => item.kind === 'registry')
    await expect(registry?.resolve({ kind: 'registry', locator: 'https://example.com/plugin' }))
      .rejects.toThrow('not allowed')
  })

  it('reads exact npm metadata and open Registry manifests without loading package code', async () => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(request.url === '/fixture'
        ? { versions: { '1.0.0': { dshRp: manifest } } }
        : { manifest }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    const origin = `http://127.0.0.1:${address.port}`
    try {
      const providers = RegistrySources.createRegistrySourceProviders({
        npmRegistries: [origin],
        registryOrigins: [origin],
      })
      const npm = providers.find(item => item.kind === 'npm')
      const registry = providers.find(item => item.kind === 'registry')
      await expect(npm?.resolve({ kind: 'npm', locator: 'fixture', ref: '1.0.0' }))
        .resolves.toMatchObject({ manifest })
      await expect(registry?.resolve({ kind: 'registry', locator: `${origin}/registry/fixture` }))
        .resolves.toMatchObject({ manifest })
    } finally {
      const closed = once(server, 'close')
      server.close()
      await closed
    }
  })

  it('downloads bounded npm and Registry evidence only from authorized origins', async () => {
    const bytes = new TextEncoder().encode('remote archive')
    const sbom = 'remote-sbom'
    const evidenced = {
      ...manifest,
      integrity: {
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sbom: createHash('sha256').update(JSON.stringify(sbom)).digest('hex'),
      },
    }
    const envelopeManifest = {
      ...evidenced,
      schemaVersion: 1,
      id: RpPackageId(evidenced.id),
      license: 'MIT',
      trust: 'L0',
    } satisfies RpPackageManifest
    const npmTarball = await createRpNpmReleaseEnvelope(
      envelopeManifest, bytes, sbom, {
        maxUnpackedBytes: 1024 * 1024, maxFiles: 16, maxFileBytes: 512 * 1024,
      },
    )
    const server = createServer((request, response) => {
      const origin = `http://${request.headers.host}`
      if (request.url === '/fixture.tgz') {
        response.end(npmTarball)
        return
      }
      if (request.url === '/registry/fixture.tgz') {
        response.end(bytes)
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(request.url === '/fixture'
        ? { versions: { '1.0.0': { dshRp: evidenced, dist: { tarball: `${origin}/fixture.tgz` } } } }
        : { manifest: evidenced, payloadUrl: `${origin}/registry/fixture.tgz`, sbom }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    const origin = `http://127.0.0.1:${address.port}`
    try {
      const providers = RegistrySources.createRegistrySourceProviders({
        npmRegistries: [origin], registryOrigins: [origin], maxArtifactBytes: npmTarball.byteLength,
      })
      const npm = await providers.find(item => item.kind === 'npm')
        ?.resolve({ kind: 'npm', locator: 'fixture', ref: '1.0.0' })
      const registry = await providers.find(item => item.kind === 'registry')
        ?.resolve({ kind: 'registry', locator: `${origin}/registry/fixture` })
      expect(npm).toMatchObject({ manifest: evidenced, sbom })
      expect(npm?.bytes).toEqual(bytes)
      expect(registry).toMatchObject({ manifest: evidenced, sbom })
      expect(registry?.bytes).toEqual(bytes)

      const bounded = RegistrySources.createRegistrySourceProviders({
        npmRegistries: [origin], maxArtifactBytes: npmTarball.byteLength - 1,
      }).find(item => item.kind === 'npm')
      await expect(bounded?.resolve({ kind: 'npm', locator: 'fixture', ref: '1.0.0' }))
        .rejects.toThrow('size limit')
    } finally {
      const closed = once(server, 'close')
      server.close()
      await closed
    }
  })

  it('releases every source Provider with its Cordis plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(RpRegistry)
    const fiber = await ctx.plugin(RegistrySources, {})
    await expect(ctx.rpRegistry.install({ kind: 'local', locator: '.' })).rejects.toThrow('disabled')
    await fiber.dispose()
    await expect(ctx.rpRegistry.install({ kind: 'local', locator: '.' })).rejects.toThrow('No source provider')
    await ctx.fiber.dispose()
  })
})
