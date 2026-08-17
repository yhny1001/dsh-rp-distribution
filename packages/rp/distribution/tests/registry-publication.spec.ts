import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runRpCli } from '@dsh-rp/cli'
import { createRegistrySourceProviders } from '@dsh-rp/registry-sources'
import { createRpRegistryNodeHandler, RpReferenceRegistry } from '@dsh-rp/registry-server'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(async (server) => {
    await new Promise<void>((resolveClose) => { server.close(() => { resolveClose() }) })
  }))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('RP Registry publication distribution path', () => {
  it('runs CLI init, pack, HTTP publish, catalog resolve, and source download as one real path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rp-registry-e2e-'))
    roots.push(root)
    const server = createServer()
    servers.push(server)
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address() as AddressInfo
    const origin = `http://127.0.0.1:${address.port}`
    const registry = new RpReferenceRegistry({
      root: join(root, 'registry'), publicOrigin: origin,
    })
    server.on('request', createRpRegistryNodeHandler(registry, { publishToken: 'distribution-token' }))
    vi.stubEnv('DSH_RP_REGISTRY_TOKEN', 'distribution-token')
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    const project = join(root, 'distribution-agent')
    expect(await runRpCli(['init', project, '--template', 'orchestration'])).toBe(0)
    expect(await runRpCli(['publish', project, '--registry', origin])).toBe(0)

    const [entry] = await registry.list()
    expect(entry).toMatchObject({ id: 'distribution-agent', version: '0.1.0', revoked: false })
    const provider = createRegistrySourceProviders({ registryOrigins: [origin] })
      .find(candidate => candidate.kind === 'registry')
    const resolved = await provider?.resolve({ kind: 'registry', locator: entry?.manifestUrl ?? '' })
    expect(resolved).toMatchObject({ manifest: { id: 'distribution-agent', version: '0.1.0' } })
    expect(resolved?.bytes?.byteLength).toBeGreaterThan(0)
    expect(resolved?.sbom).toMatchObject({ bomFormat: 'CycloneDX' })
  })
})
