import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runRpCli } from '../src/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('@dsh-rp/cli', () => {
  it('reports the independently published package version', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(await runRpCli(['--version'])).toBe(0)
    expect(output).toHaveBeenCalledWith(`${manifest.version}\n`)
  })

  it('scaffolds, validates, inspects, packs, and revalidates an executable package', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'dsh-rp-')), 'story-kit')
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await runRpCli(['init', dir])).toBe(0)
    expect(await runRpCli(['validate', dir])).toBe(0)
    expect(await runRpCli(['inspect', dir])).toBe(0)
    expect(await runRpCli(['sbom', dir])).toBe(0)
    expect(await runRpCli(['pack', dir])).toBe(0)
    expect(await runRpCli(['pack', dir])).toBe(0)
    const release = join(dir, 'dist', 'rp-release')
    expect(existsSync(join(release, 'rp.package.tgz'))).toBe(true)
    expect(readdirSync(join(dir, 'dist')).filter(name => name.startsWith('.rp-release-stage-'))).toEqual([])
    expect(await runRpCli(['validate', release])).toBe(0)
    const packed = JSON.parse(readFileSync(join(release, 'rp.package.json'), 'utf8')) as {
      integrity?: { sha256?: string; sbom?: string }
    }
    expect(packed.integrity?.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(packed.integrity?.sbom).toMatch(/^[a-f0-9]{64}$/u)
    const manifest = JSON.parse(readFileSync(join(dir, 'rp.package.json'), 'utf8')) as { trust: string }
    expect(manifest.trust).toBe('L0')
    expect(output.mock.calls.flat().join('')).toContain('sha256:')
    expect(output.mock.calls.flat().join('')).toContain('CycloneDX')
  })

  it('runs bounded golden Session replay before the package test script', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'dsh-rp-eval-')), 'story-kit')
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await runRpCli(['init', dir])).toBe(0)
    const evalPath = join(dir, 'rp.eval.json')
    const suite = {
      schemaVersion: 1,
      scenarios: [{
        schemaVersion: 1,
        id: 'completed-sidecar',
        events: [
          {
            type: 'rp/pipeline-started', seq: 0, time: 0,
            data: { turnId: 'turn-eval', pipelineId: 'sidecar.eval', snapshotHash: 'e'.repeat(64), kind: 'sidecar' },
          },
          {
            type: 'rp/pipeline-completed', seq: 1, time: 1,
            data: { turnId: 'turn-eval', pipelineId: 'sidecar.eval', snapshotHash: 'e'.repeat(64), kind: 'sidecar' },
          },
        ],
        expected: { counts: { pipelines: 1, turns: 0 }, settled: true },
      }],
    }
    writeFileSync(evalPath, JSON.stringify(suite))
    expect(await runRpCli(['test', dir])).toBe(0)
    expect(output.mock.calls.flat().join('')).toContain('RP eval: 1 scenario(s) passed')

    suite.scenarios[0]!.events[1]!.seq = 3
    writeFileSync(evalPath, JSON.stringify(suite))
    expect(await runRpCli(['test', dir])).toBe(1)
  })

  it('prints migration by default and only overwrites with --write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-rp-'))
    const path = join(dir, 'rp.package.json')
    writeFileSync(path, JSON.stringify({ id: 'legacy' }))
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await runRpCli(['migrate', path])).toBe(0)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ id: 'legacy' })
    expect(await runRpCli(['migrate', path, '--write'])).toBe(0)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ schemaVersion: 1, trust: 'L0' })
  })

  it('scaffolds orchestration, QuickJS, and sandboxed UI package templates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rp-templates-'))
    const orchestration = join(root, 'orchestration')
    const critic = join(root, 'critic')
    const ui = join(root, 'ui')
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await runRpCli(['init', orchestration, '--template', 'orchestration'])).toBe(0)
    expect(await runRpCli(['validate', orchestration])).toBe(0)
    expect(await runRpCli(['pack', orchestration])).toBe(0)
    const orchestrationDescriptor = JSON.parse(readFileSync(join(orchestration, 'rp.runtime.json'), 'utf8')) as {
      pipelines?: unknown[]
      capabilities: Array<{ kind: string }>
    }
    expect(orchestrationDescriptor.pipelines).toHaveLength(1)
    expect(orchestrationDescriptor.capabilities.map(item => item.kind)).toEqual(['agent', 'memory', 'pipeline'])

    expect(await runRpCli(['init', critic, '--template', 'quickjs-critic'])).toBe(0)
    expect(existsSync(join(critic, 'runtime', 'critic.js'))).toBe(true)
    expect(await runRpCli(['validate', critic])).toBe(0)
    expect(await runRpCli(['pack', critic])).toBe(0)
    const criticManifest = JSON.parse(readFileSync(join(critic, 'rp.package.json'), 'utf8')) as {
      trust: string
      permissions: string[]
    }
    expect(criticManifest).toMatchObject({ trust: 'L1', permissions: ['script.execute'] })

    expect(await runRpCli(['init', ui, '--template', 'ui-panel'])).toBe(0)
    expect(existsSync(join(ui, 'ui', 'index.html'))).toBe(true)
    expect(await runRpCli(['validate', ui])).toBe(0)
    expect(await runRpCli(['pack', ui])).toBe(0)
    const uiManifest = JSON.parse(readFileSync(join(ui, 'rp.package.json'), 'utf8')) as {
      trust: string
      uiSlots?: string[]
      assets?: string[]
    }
    expect(uiManifest).toMatchObject({
      trust: 'L0', uiSlots: ['overview-panel'], assets: ['ui/index.html', 'ui/styles.css'],
    })
  })

  it('routes install and uninstall through the Host Registry transaction API', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Registry request body must be JSON text')
      const request = JSON.parse(init.body) as { action: string }
      return new Response(JSON.stringify({
        schemaVersion: 1,
        action: request.action,
        rootId: 'story-kit',
        graphHash: 'a'.repeat(64),
        installed: request.action !== 'uninstall',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await runRpCli(['install', 'npm:story-kit@1.0.0'])).toBe(0)
    expect(await runRpCli(['uninstall', 'story-kit'])).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL('http://127.0.0.1:3080/api/rp/v1/registry'))
    expect(output.mock.calls.flat().join('')).toContain('graphHash')
  })

  it('publishes the verified release envelope to a self-hosted RP Registry', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'dsh-rp-publish-')), 'story-kit')
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.stubEnv('DSH_RP_REGISTRY_TOKEN', 'publisher-token')
    expect(await runRpCli(['init', dir, '--template', 'orchestration'])).toBe(0)
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer publisher-token' })
      if (typeof init?.body !== 'string') throw new Error('Registry publication body must be JSON text')
      const body = JSON.parse(init.body) as {
        manifest: { id: string; integrity?: { sha256?: string; sbom?: string } }
        payloadBase64: string
        sbom: unknown
      }
      expect(body.manifest.id).toBe('story-kit')
      expect(body.manifest.integrity?.sha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(body.manifest.integrity?.sbom).toMatch(/^[a-f0-9]{64}$/u)
      expect(Buffer.from(body.payloadBase64, 'base64').byteLength).toBeGreaterThan(0)
      expect(body.sbom).toMatchObject({ bomFormat: 'CycloneDX' })
      return new Response(JSON.stringify({ created: true, entry: { id: 'story-kit', version: '0.1.0' } }), {
        status: 201, headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await runRpCli(['publish', dir, '--registry', 'http://127.0.0.1:3090'])).toBe(0)
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:3090/api/rp/v1/releases'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('refuses plaintext non-loopback Host Registry origins', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await runRpCli(['install', 'npm:story-kit@1.0.0', '--host', 'http://example.com'])).toBe(1)
  })

  it('refuses release output outside the package project', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'dsh-rp-')), 'story-kit')
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await runRpCli(['init', dir])).toBe(0)
    expect(await runRpCli(['pack', dir, '--out', '..'])).toBe(1)
  })

  it('requires signing and an explicit verification key for L2 releases', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'dsh-rp-')), 'native-kit')
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await runRpCli(['init', dir])).toBe(0)
    const manifestPath = join(dir, 'rp.package.json')
    const descriptorPath = join(dir, 'rp.runtime.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      trust: string
      permissions?: string[]
    }
    manifest.trust = 'L2'
    manifest.permissions = ['native.execute']
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as {
      capabilities: Array<{ permissions?: string[]; implementation?: unknown }>
    }
    const capability = descriptor.capabilities[0]
    if (capability === undefined) throw new Error('scaffold capability is missing')
    capability.permissions = ['native.execute']
    capability.implementation = { kind: 'native', path: 'main.js' }
    writeFileSync(descriptorPath, `${JSON.stringify(descriptor, undefined, 2)}\n`)
    writeFileSync(join(dir, 'main.js'), '(input) => input\n')
    expect(await runRpCli(['pack', dir])).toBe(1)

    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const privatePath = join(dir, 'private.pem')
    const publicPath = join(dir, 'public.pem')
    writeFileSync(privatePath, privateKey.export({ format: 'pem', type: 'pkcs8' }))
    writeFileSync(publicPath, publicKey.export({ format: 'pem', type: 'spki' }))
    expect(await runRpCli(['validate', dir, '--sign-key', privatePath])).toBe(0)
    expect(await runRpCli(['pack', dir, '--sign-key', privatePath])).toBe(0)
    const release = join(dir, 'dist', 'rp-release')
    expect(await runRpCli(['validate', release])).toBe(1)
    expect(await runRpCli(['validate', release, '--verify-key', publicPath])).toBe(0)
  })
})
