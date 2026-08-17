import { Buffer } from 'node:buffer'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { RpCapabilityId, RpPackageId } from '@dsh-rp/contracts'
import type { RpPackageManifest } from '@dsh-rp/contracts'
import type { RpRuntimeDescriptor } from '@dsh-rp/package-runtime'
import { createRegistrySourceProviders } from '@dsh-rp/registry-sources'
import {
  attachRpPackageSbom,
  buildRpPackage,
  createRpSigningKeyId,
  type RpPackageBuild,
} from '@dsh-rp/sdk'
import {
  createRpRegistryNodeHandler,
  RpReferenceRegistry,
  type RpRegistryPublisherKey,
} from '../src/index.ts'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    await new Promise<void>((resolveClose) => { server.close(() => { resolveClose() }) })
  }))
  await Promise.all(roots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }) }))
})

describe('@dsh-rp/registry-server', () => {
  it('atomically publishes, persists, orders, and idempotently resolves immutable releases', async () => {
    const root = await tempRoot()
    const registry = new RpReferenceRegistry({
      root, publicOrigin: 'http://127.0.0.1:3090', clock: () => 42,
    })
    const first = await packageBuild('example.actor', '1.0.0', 'first')
    const next = await packageBuild('example.actor', '1.1.0-rc.10', 'next')
    const olderPrerelease = await packageBuild('example.actor', '1.1.0-rc.2', 'older')

    await expect(registry.publish(first)).resolves.toMatchObject({ created: true })
    await expect(registry.publish(first)).resolves.toMatchObject({ created: false })
    await registry.publish(olderPrerelease)
    await registry.publish(next)

    const restarted = new RpReferenceRegistry({ root, publicOrigin: 'http://127.0.0.1:3090' })
    await expect(restarted.list()).resolves.toMatchObject([
      { id: 'example.actor', version: '1.1.0-rc.10', publishedAt: 42 },
      { id: 'example.actor', version: '1.1.0-rc.2', publishedAt: 42 },
      { id: 'example.actor', version: '1.0.0', publishedAt: 42 },
    ])
    await expect(restarted.releaseEnvelope('example.actor')).resolves.toMatchObject({
      manifest: { id: 'example.actor', version: '1.1.0-rc.10' },
      payloadUrl: 'http://127.0.0.1:3090/api/rp/v1/packages/example.actor/1.1.0-rc.10/payload',
      sbomUrl: 'http://127.0.0.1:3090/api/rp/v1/packages/example.actor/1.1.0-rc.10/sbom',
    })
    await expect(restarted.readPayload('example.actor', '1.0.0')).resolves.toEqual(first.archive)
    await expect(restarted.readSbom('example.actor', '1.0.0')).resolves.toEqual(first.sbom)
  })

  it('serializes concurrent idempotent writers without duplicate catalog rows', async () => {
    const root = await tempRoot()
    const registry = new RpReferenceRegistry({ root, publicOrigin: 'http://127.0.0.1:3090' })
    const release = await packageBuild('example.concurrent', '1.0.0', 'concurrent')
    const results = await Promise.all([registry.publish(release), registry.publish(release)])
    expect(results.map(result => result.created).sort()).toEqual([false, true])
    await expect(registry.list()).resolves.toHaveLength(1)
  })

  it('fails closed on conflicting identities, tampered evidence, and stored corruption', async () => {
    const root = await tempRoot()
    const registry = new RpReferenceRegistry({ root, publicOrigin: 'http://127.0.0.1:3090' })
    const release = await packageBuild('example.guard', '1.0.0', 'one')
    const conflict = await packageBuild('example.guard', '1.0.0', 'two')
    await registry.publish(release)
    await expect(registry.publish(conflict)).rejects.toMatchObject({ code: 'CONFLICT' })

    const tampered = release.archive.slice()
    tampered[0] = (tampered[0] ?? 0) ^ 1
    await expect(registry.publish({ ...release, archive: tampered }))
      .rejects.toMatchObject({ code: 'INTEGRITY' })
    const oversizedSbom = `x${'x'.repeat(4 * 1024 * 1024)}`
    await expect(registry.publish({
      manifest: attachRpPackageSbom(release.manifest, oversizedSbom),
      archive: release.archive,
      sbom: oversizedSbom,
    })).rejects.toMatchObject({ code: 'INVALID' })

    const catalog = await registry.list()
    const sha = catalog[0]?.payloadSha256
    expect(sha).toBeTypeOf('string')
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as {
      releases: Array<{ manifest: { id: string; version: string } }>
    }
    const idHash = await import('node:crypto').then(({ createHash }) => (
      createHash('sha256').update(index.releases[0]?.manifest.id ?? '').digest('hex')
    ))
    const payloadPath = join(root, 'releases', idHash, '1.0.0', 'rp.package.tgz')
    await writeFile(payloadPath, Buffer.from('corrupt'))
    await expect(registry.resolveRelease('example.guard', '1.0.0'))
      .rejects.toMatchObject({ code: 'CORRUPT' })
  })

  it('requires trusted Ed25519 evidence for L2 and enforces append-only revocations', async () => {
    const root = await tempRoot()
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const keyId = createRpSigningKeyId(publicKey)
    const publisherKeys: RpRegistryPublisherKey[] = [{ keyId, publicKey: publicKey.export({ type: 'spki', format: 'pem' }) }]
    const release = await packageBuild('example.native', '1.0.0', 'native', 'L2', { privateKey, keyId })
    const registry = new RpReferenceRegistry({
      root, publicOrigin: 'http://127.0.0.1:3090', publisherKeys, clock: () => 77,
    })
    await expect(registry.publish(release)).resolves.toMatchObject({ created: true })
    const lostTrust = new RpReferenceRegistry({ root, publicOrigin: 'http://127.0.0.1:3090' })
    await expect(lostTrust.resolveRelease('example.native', '1.0.0'))
      .rejects.toMatchObject({ code: 'CORRUPT' })
    await expect(registry.revokeKey({ keyId, reason: 'compromised' })).resolves.toEqual({
      keyId, reason: 'compromised', revokedAt: 77,
    })
    await expect(registry.resolveRelease('example.native', '1.0.0')).rejects.toMatchObject({ code: 'REVOKED' })
    await expect(registry.revokeKey({ keyId, reason: 'changed' })).rejects.toMatchObject({ code: 'CONFLICT' })

    const untrusted = new RpReferenceRegistry({
      root: await tempRoot(), publicOrigin: 'http://127.0.0.1:3090',
    })
    await expect(untrusted.publish(release)).rejects.toMatchObject({ code: 'INTEGRITY' })
  })

  it('serves authenticated publication, a CSP catalog, revocation, and real RegistrySources evidence', async () => {
    const root = await tempRoot()
    const server = createServer()
    servers.push(server)
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address() as AddressInfo
    const origin = `http://127.0.0.1:${address.port}`
    const registry = new RpReferenceRegistry({ root, publicOrigin: origin, clock: () => 99 })
    server.on('request', createRpRegistryNodeHandler(registry, { publishToken: 'test-token' }))
    const release = await packageBuild('@example/http-agent', '1.0.0', 'http')
    const publishUrl = `${origin}/api/rp/v1/releases`
    const body = JSON.stringify({
      manifest: release.manifest,
      payloadBase64: Buffer.from(release.archive).toString('base64'),
      sbom: release.sbom,
    })

    await expect(fetch(publishUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      .then(async response => ({ status: response.status, body: await response.json() as unknown })))
      .resolves.toMatchObject({ status: 401, body: { code: 'AUTH' } })
    await expect(fetch(publishUrl, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: '{invalid',
    }).then(response => response.status)).resolves.toBe(400)
    await expect(fetch(publishUrl, {
      method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body,
    }).then(async response => ({ status: response.status, body: await response.json() as unknown })))
      .resolves.toMatchObject({ status: 201, body: { created: true } })

    const encodedId = encodeURIComponent(String(release.manifest.id))
    const locator = `${origin}/api/rp/v1/packages/${encodedId}/1.0.0`
    const provider = createRegistrySourceProviders({ registryOrigins: [origin] })
      .find(candidate => candidate.kind === 'registry')
    await expect(provider?.resolve({ kind: 'registry', locator })).resolves.toMatchObject({
      manifest: release.manifest, bytes: release.archive, sbom: release.sbom,
    })
    const page = await fetch(origin)
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(await page.text()).toContain('@example/http-agent')

    await expect(fetch(`${origin}/api/rp/v1/revocations/packages`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ id: '@example/http-agent', version: '1.0.0', reason: 'malicious' }),
    }).then(response => response.status)).resolves.toBe(201)
    await expect(fetch(locator).then(response => response.status)).resolves.toBe(410)
    await expect(provider?.resolve({ kind: 'registry', locator })).rejects.toThrow('HTTP 410')
  })
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-rp-registry-server-'))
  roots.push(root)
  return root
}

async function packageBuild(
  id: string,
  version: string,
  marker: string,
  trust: RpPackageManifest['trust'] = 'L0',
  signing?: NonNullable<Parameters<typeof buildRpPackage>[1]>['signing'],
): Promise<RpPackageBuild> {
  const capability = RpCapabilityId(`${id}.echo`)
  const manifest: RpPackageManifest = {
    schemaVersion: 1,
    id: RpPackageId(id),
    name: id,
    version,
    license: 'MIT',
    trust,
    dependencies: [],
    components: [],
    capabilities: [capability],
    ...(trust === 'L2' ? { permissions: ['native.execute'] } : {}),
    compatibility: { runtime: 'dsh-rp-runtime-v1' },
  }
  const descriptor: RpRuntimeDescriptor = {
    schemaVersion: 1,
    components: [],
    capabilities: [{
      id: capability,
      kind: 'tool',
      title: marker,
      description: marker,
      scopes: ['conversation'],
      ...(trust === 'L2'
        ? { permissions: ['native.execute'], implementation: { kind: 'native', path: 'runtime/index.js' } as const }
        : { implementation: { kind: 'expression', expression: { op: 'literal', value: marker } } as const }),
    }],
  }
  return await buildRpPackage({
    manifest,
    descriptor,
    ...(trust === 'L2' ? { files: [{ path: 'runtime/index.js', bytes: new TextEncoder().encode('export default input => input\n') }] } : {}),
  }, signing === undefined ? {} : { signing })
}
