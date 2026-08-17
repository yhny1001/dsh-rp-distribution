import { describe, expect, it } from 'vitest'
import {
  RpCapabilityId,
  RpComponentId,
  RpPackageId,
  RpPipelineId,
  type RpPackageManifest,
} from '@dsh-rp/contracts'
import {
  createRpNpmReleaseEnvelope,
  createRpRuntimeArchive,
  extractRpNpmReleaseEnvelope,
  parseRpRuntimeArchive,
  RP_RUNTIME_V1,
  RpRuntimePackageError,
  type RpRuntimeDescriptor,
} from '../src/index.ts'
import { createRpTestArchive as archive } from './archive-fixture.ts'

const limits = { maxUnpackedBytes: 1024 * 1024, maxFiles: 16, maxFileBytes: 256 * 1024 }

function manifest(
  trust: 'L0' | 'L1' | 'L2',
  components: readonly string[],
  capabilities: readonly string[],
): RpPackageManifest {
  return {
    schemaVersion: 1,
    id: RpPackageId(`runtime-${trust.toLowerCase()}`),
    name: `Runtime ${trust}`,
    version: '1.0.0',
    license: 'MIT',
    trust,
    dependencies: [],
    components: components.map(RpComponentId),
    capabilities,
    compatibility: { runtime: RP_RUNTIME_V1 },
  }
}

function descriptor(value: RpRuntimeDescriptor): string {
  return JSON.stringify(value)
}

describe('@dsh-rp/package-runtime', () => {
  it('round-trips a deterministic npm envelope without confusing outer and inner archives', async () => {
    const owner = manifest('L0', [], [])
    const inner = await createRpRuntimeArchive({
      descriptor: { schemaVersion: 1, components: [], capabilities: [] },
    }, owner, limits)
    const sbom = { bomFormat: 'CycloneDX', version: 1 }
    const first = await createRpNpmReleaseEnvelope(owner, inner, sbom, limits)
    const second = await createRpNpmReleaseEnvelope(owner, inner, sbom, limits)
    expect(first).toEqual(second)
    const envelope = await extractRpNpmReleaseEnvelope(first, owner, limits)
    expect(envelope.archive).toEqual(inner)
    expect(envelope.sbom).toEqual(sbom)
    await expect(extractRpNpmReleaseEnvelope(first, { ...owner, version: '1.0.1' }, limits))
      .rejects.toMatchObject({ code: 'DECLARATION_MISMATCH' })
  })

  it('writes byte-identical archives with sorted files and canonical descriptor JSON', async () => {
    const value: RpRuntimeDescriptor = {
      schemaVersion: 1,
      components: [],
      capabilities: [{
        id: RpCapabilityId('capability.echo'),
        kind: 'tool', title: 'Echo', description: 'Returns its input.', scopes: ['conversation'],
        inputSchema: { required: ['value'], type: 'object' },
        implementation: { kind: 'expression', expression: { op: 'input' } },
      }],
    }
    const owner = manifest('L0', [], ['capability.echo'])
    const first = await createRpRuntimeArchive({
      descriptor: value,
      files: [
        { path: 'z-last.txt', bytes: new TextEncoder().encode('last') },
        { path: 'a-first.txt', bytes: new TextEncoder().encode('first') },
      ],
    }, owner, limits)
    const second = await createRpRuntimeArchive({
      descriptor: value,
      files: [
        { path: 'a-first.txt', bytes: new TextEncoder().encode('first') },
        { path: 'z-last.txt', bytes: new TextEncoder().encode('last') },
      ],
    }, owner, limits)
    expect(first).toEqual(second)
    const parsed = await parseRpRuntimeArchive(first, owner, limits)
    expect(parsed.files).toEqual(['a-first.txt', 'rp.runtime.json', 'z-last.txt'])
  })

  it('refuses unsafe, duplicate, reserved, or oversized writer inputs', async () => {
    const value: RpRuntimeDescriptor = { schemaVersion: 1, components: [], capabilities: [] }
    const owner = manifest('L0', [], [])
    await expect(createRpRuntimeArchive({
      descriptor: value,
      files: [{ path: '../escape', bytes: new Uint8Array() }],
    }, owner, limits)).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
    await expect(createRpRuntimeArchive({
      descriptor: value,
      files: [{ path: 'rp.runtime.json', bytes: new Uint8Array() }],
    }, owner, limits)).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
    await expect(createRpRuntimeArchive({
      descriptor: value,
      files: [{ path: 'large.bin', bytes: new Uint8Array(32) }],
    }, owner, { ...limits, maxFileBytes: 16 })).rejects.toMatchObject({ code: 'LIMIT' })
  })

  it('parses an L0 archive and returns detached bytes', async () => {
    const value: RpRuntimeDescriptor = {
      schemaVersion: 1,
      components: [{ id: RpComponentId('component.echo'), scopes: ['conversation'], provides: ['echo'] }],
      capabilities: [{
        id: RpCapabilityId('capability.echo'),
        kind: 'tool', title: 'Echo', description: 'Returns its input.', scopes: ['conversation'],
        implementation: { kind: 'expression', expression: { op: 'input' } },
      }],
    }
    const parsed = await parseRpRuntimeArchive(await archive([
      { name: 'rp.runtime.json', body: descriptor(value) },
      { name: 'assets/readme.txt', body: 'hello' },
    ]), { ...manifest('L0', ['component.echo'], ['capability.echo']), assets: ['assets/readme.txt'] }, limits)

    expect(parsed.descriptor).toEqual(value)
    expect(() => ((parsed.descriptor.capabilities[0]?.implementation as unknown) as {
      expression: { op: string }
    }).expression.op = 'changed')
      .toThrow(TypeError)
    const first = parsed.bytes('assets/readme.txt')
    first[0] = 0
    expect(parsed.text('assets/readme.txt')).toBe('hello')
    expect(parsed.files).toEqual(['assets/readme.txt', 'rp.runtime.json'])
  })

  it('parses code-free Pipeline DAGs bound to Pipeline capability declarations', async () => {
    const pipeline = RpPipelineId('pipeline.package.turn')
    const value: RpRuntimeDescriptor = {
      schemaVersion: 1,
      components: [],
      capabilities: [{
        id: RpCapabilityId(String(pipeline)), kind: 'pipeline', title: 'Package turn',
        description: 'Runs an installable graph.', scopes: ['conversation'],
      }],
      pipelines: [{
        id: pipeline,
        kind: 'turn',
        description: 'One conditional stage followed by a nested capability.',
        stages: [
          { id: 'admit', operation: { kind: 'conditional', valueKey: 'missing', equals: null } },
          {
            id: 'actor', after: ['admit'], timeoutMs: 500, retries: 1, failure: 'fatal',
            operation: {
              kind: 'invoke-capability', capabilityId: 'actor.echo',
              grantedPermissions: [], grantedTrust: 'L0',
            },
          },
        ],
      }],
    }
    const owner = manifest('L0', [], [String(pipeline)])
    const parsed = await parseRpRuntimeArchive(await createRpRuntimeArchive({ descriptor: value }, owner, limits), owner, limits)
    expect(parsed.descriptor).toEqual(value)
  })

  it('binds UI Slot ids and resources to the Manifest and enforces script trust', async () => {
    const html = { path: 'ui/index.html', bytes: new TextEncoder().encode('<h1>Panel</h1>') }
    const value: RpRuntimeDescriptor = {
      schemaVersion: 1,
      components: [],
      capabilities: [],
      uiSlots: [{
        schemaVersion: 1, id: 'panel', title: 'Panel', placement: 'studio.overview',
        entry: html.path, assets: [html.path], script: 'none', height: 240,
      }],
    }
    const owner = { ...manifest('L0', [], []), uiSlots: ['panel'], assets: [html.path] }
    const parsed = await parseRpRuntimeArchive(
      await createRpRuntimeArchive({ descriptor: value, files: [html] }, owner, limits), owner, limits,
    )
    expect(parsed.descriptor.uiSlots).toEqual(value.uiSlots)

    await expect(createRpRuntimeArchive({
      descriptor: { ...value, uiSlots: [{ ...value.uiSlots?.[0] as NonNullable<typeof value.uiSlots>[number], script: 'sandbox' }] },
      files: [html],
    }, owner, limits)).rejects.toMatchObject({ code: 'TRUST' })
    await expect(createRpRuntimeArchive({ descriptor: value, files: [html] }, {
      ...owner, assets: [],
    }, limits)).rejects.toMatchObject({ code: 'DECLARATION_MISMATCH' })

    for (const hostile of [
      '<script>location="https://forbidden.example"</script>',
      '<meta http-equiv="refresh" content="0;url=https://forbidden.example">',
      '<a href="https://forbidden.example">leave</a>',
      '<img src="missing.png">',
      '<div onclick="alert(1)">click</div>',
    ]) {
      await expect(createRpRuntimeArchive({
        descriptor: value,
        files: [{ path: html.path, bytes: new TextEncoder().encode(hostile) }],
      }, owner, limits)).rejects.toBeInstanceOf(RpRuntimePackageError)
    }

    const secondary = { path: 'ui/detail.html', bytes: new TextEncoder().encode('<script>alert(1)</script>') }
    await expect(createRpRuntimeArchive({
      descriptor: {
        ...value,
        uiSlots: [{
          ...value.uiSlots?.[0] as NonNullable<typeof value.uiSlots>[number],
          assets: [html.path, secondary.path],
        }],
      },
      files: [
        { path: html.path, bytes: new TextEncoder().encode('<a href="detail.html">detail</a>') },
        secondary,
      ],
    }, { ...owner, assets: [html.path, secondary.path] }, limits)).rejects.toMatchObject({ code: 'INVALID_DESCRIPTOR' })
  })

  it('normalizes the npm package prefix', async () => {
    const value: RpRuntimeDescriptor = { schemaVersion: 1, components: [], capabilities: [] }
    const parsed = await parseRpRuntimeArchive(await archive([
      { name: 'package/rp.runtime.json', body: descriptor(value) },
      { name: 'package/module.js', body: 'input => input' },
    ]), manifest('L0', [], []), limits)
    expect(parsed.files).toEqual(['module.js', 'rp.runtime.json'])
  })

  it('rejects traversal, links, and extraction limit violations', async () => {
    const value = descriptor({ schemaVersion: 1, components: [], capabilities: [] })
    await expect(parseRpRuntimeArchive(await archive([
      { name: '../rp.runtime.json', body: value },
    ]), manifest('L0', [], []), limits)).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
    await expect(parseRpRuntimeArchive(await archive([
      { name: 'rp.runtime.json', body: value },
      { name: 'link', type: 'symlink' },
    ]), manifest('L0', [], []), limits)).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
    await expect(parseRpRuntimeArchive(await archive([
      { name: 'rp.runtime.json', body: value },
    ]), manifest('L0', [], []), { ...limits, maxFileBytes: 8 })).rejects.toMatchObject({ code: 'LIMIT' })
  })

  it('requires exact signed declarations and trust-compatible implementations', async () => {
    const declaration = descriptor({
      schemaVersion: 1,
      components: [{ id: RpComponentId('undeclared'), scopes: ['deployment'] }],
      capabilities: [],
    })
    await expect(parseRpRuntimeArchive(await archive([
      { name: 'rp.runtime.json', body: declaration },
    ]), manifest('L0', [], []), limits)).rejects.toMatchObject({ code: 'DECLARATION_MISMATCH' })

    const executable = descriptor({
      schemaVersion: 1,
      components: [],
      capabilities: [{
        id: RpCapabilityId('native.wrong-trust'),
        kind: 'tool', title: 'Wrong trust', description: 'Must not activate.', scopes: ['deployment'],
        implementation: { kind: 'native', path: 'main.js' },
      }],
    })
    await expect(parseRpRuntimeArchive(await archive([
      { name: 'rp.runtime.json', body: executable }, { name: 'main.js', body: '() => null' },
    ]), manifest('L0', [], ['native.wrong-trust']), limits)).rejects.toMatchObject({ code: 'TRUST' })
  })

  it('rejects unknown descriptor fields and absent implementation assets', async () => {
    await expect(parseRpRuntimeArchive(await archive([{ name: 'rp.runtime.json', body: JSON.stringify({
      schemaVersion: 1, components: [], capabilities: [], ambientAuthority: true,
    }) }]), manifest('L0', [], []), limits)).rejects.toMatchObject({ code: 'INVALID_DESCRIPTOR' })
    await expect(parseRpRuntimeArchive(await archive([{ name: 'rp.runtime.json', body: JSON.stringify({
      schemaVersion: 1,
      components: [],
      capabilities: [{
        id: 'missing.source', kind: 'tool', title: 'Missing', description: 'Missing.', scopes: ['deployment'],
        implementation: { kind: 'quickjs', path: 'missing.js' },
      }],
    }) }]), manifest('L1', [], ['missing.source']), limits)).rejects.toMatchObject({ code: 'INVALID_DESCRIPTOR' })
    await expect(parseRpRuntimeArchive(await archive([{ name: 'rp.runtime.json', body: JSON.stringify({
      schemaVersion: 1,
      components: [],
      capabilities: [{
        id: 'missing.graph', kind: 'pipeline', title: 'Missing graph', description: 'Missing.', scopes: ['deployment'],
      }],
    }) }]), manifest('L0', [], ['missing.graph']), limits)).rejects.toMatchObject({ code: 'DECLARATION_MISMATCH' })
    await expect(parseRpRuntimeArchive(await archive([{ name: 'rp.runtime.json', body: JSON.stringify({
      schemaVersion: 1,
      components: [],
      capabilities: [{
        id: 'cyclic.graph', kind: 'pipeline', title: 'Cyclic graph', description: 'Cyclic.', scopes: ['deployment'],
      }],
      pipelines: [{
        id: 'cyclic.graph', kind: 'turn', description: 'Cyclic.', stages: [
          { id: 'a', after: ['b'], operation: { kind: 'conditional', valueKey: 'a', equals: null } },
          { id: 'b', after: ['a'], operation: { kind: 'conditional', valueKey: 'b', equals: null } },
        ],
      }],
    }) }]), manifest('L0', [], ['cyclic.graph']), limits)).rejects.toMatchObject({ code: 'INVALID_DESCRIPTOR' })
    await expect(parseRpRuntimeArchive(await archive([{ name: 'rp.runtime.json', body: JSON.stringify({
      schemaVersion: 1,
      components: [],
      capabilities: [{
        id: 'escalating.graph', kind: 'pipeline', title: 'Escalating graph', description: 'Escalating.', scopes: ['deployment'],
      }],
      pipelines: [{
        id: 'escalating.graph', kind: 'turn', description: 'Escalating.', stages: [{
          id: 'native',
          operation: { kind: 'invoke-capability', capabilityId: 'native.target', grantedTrust: 'L2' },
        }],
      }],
    }) }]), manifest('L0', [], ['escalating.graph']), limits)).rejects.toMatchObject({ code: 'TRUST' })
    await expect(parseRpRuntimeArchive(await archive([{ name: 'rp.runtime.json', body: JSON.stringify({
      schemaVersion: 1,
      components: [],
      capabilities: [{
        id: 'permission.graph', kind: 'pipeline', title: 'Permission graph', description: 'Permission.', scopes: ['deployment'],
      }],
      pipelines: [{
        id: 'permission.graph', kind: 'turn', description: 'Permission.', stages: [{
          id: 'script',
          operation: {
            kind: 'invoke-capability', capabilityId: 'script.target', grantedPermissions: ['script.execute'],
          },
        }],
      }],
    }) }]), manifest('L0', [], ['permission.graph']), limits)).rejects.toMatchObject({ code: 'DECLARATION_MISMATCH' })
  })
})
