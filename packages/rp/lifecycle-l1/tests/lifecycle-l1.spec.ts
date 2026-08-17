import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import RpComponentRegistry from '@dsh-rp/component-runtime'
import { RpCapabilityId, RpPackageId } from '@dsh-rp/contracts'
import { RP_RUNTIME_V1 } from '@dsh-rp/package-runtime'
import RpPipelineRuntime from '@dsh-rp/pipeline-runtime'
import RpUiSlotRegistry from '@dsh-rp/ui-slot-runtime'
import RpRegistry from '@dsh-rp/registry'
import * as SandboxBackends from '@dsh-rp/workflow-backends-sandbox'
import RpWorkflowRouter from '@dsh-rp/workflow-router'
import { createRpTestArchive } from '../../package-runtime/tests/archive-fixture.ts'
import * as LifecycleL1 from '../src/index.ts'

const addModule = Buffer.from(
  '0061736d0100000001070160027f7f017f030201000707010361646400000a09010700200020016a0b',
  'hex',
)

describe('@dsh-rp/lifecycle-l1', () => {
  it('routes package QuickJS and WebAssembly through the canonical sandbox backends', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRegistry)
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPipelineRuntime)
    await ctx.plugin(RpUiSlotRegistry)
    await ctx.plugin(RpWorkflowRouter)
    await ctx.plugin(SandboxBackends)
    await ctx.plugin(RpRegistry)
    await ctx.plugin(LifecycleL1, {})
    const quick = RpCapabilityId('test.l1.quickjs')
    const wasm = RpCapabilityId('test.l1.wasm')
    const bytes = await createRpTestArchive([
      { name: 'quick.js', body: '({ answer: input.answer + 1, process: typeof process, fetch: typeof fetch })' },
      { name: 'add.wasm', body: addModule },
      { name: 'rp.runtime.json', body: JSON.stringify({
        schemaVersion: 1,
        components: [],
        capabilities: [
          {
            id: String(quick), kind: 'tool', title: 'QuickJS', description: 'Sandbox expression.',
            scopes: ['conversation'], permissions: [LifecycleL1.L1_EXECUTION_PERMISSION],
            implementation: { kind: 'quickjs', path: 'quick.js' },
          },
          {
            id: String(wasm), kind: 'tool', title: 'WASM', description: 'No-import module.',
            scopes: ['conversation'], permissions: [LifecycleL1.L1_EXECUTION_PERMISSION],
            implementation: { kind: 'wasm', path: 'add.wasm', export: 'add' },
          },
        ],
      }) },
    ])
    const manifest = {
      schemaVersion: 1 as const,
      id: RpPackageId('test-l1-package'),
      name: 'Test L1 package',
      version: '1.0.0',
      license: 'MIT' as const,
      trust: 'L1' as const,
      dependencies: [],
      components: [],
      capabilities: [String(quick), String(wasm)],
      permissions: [LifecycleL1.L1_EXECUTION_PERMISSION],
      compatibility: { runtime: RP_RUNTIME_V1 },
      integrity: { sha256: createHash('sha256').update(bytes).digest('hex') },
    }
    ctx.rpRegistry.registerProvider({ kind: 'local', resolve: async source => ({ source, manifest, bytes }) })
    await ctx.rpRegistry.install({ kind: 'local', locator: 'test-l1-package' })

    const authority = {
      scope: { kind: 'conversation' as const, id: 'conversation-1' },
      grantedPermissions: [LifecycleL1.L1_EXECUTION_PERMISSION],
      grantedTrust: 'L1' as const,
      budget: { timeoutMs: 2_000 },
    }
    await expect(ctx.rpCapabilities.invoke(quick, { ...authority, input: { answer: 41 } })).resolves.toEqual({
      answer: 42, process: 'undefined', fetch: 'undefined',
    })
    await expect(ctx.rpCapabilities.invoke(wasm, { ...authority, input: [20, 22] })).resolves.toBe(42)

    await ctx.rpRegistry.uninstall(String(manifest.id))
    expect(ctx.rpCapabilities.get(quick)).toBeUndefined()
    expect(ctx.rpCapabilities.get(wasm)).toBeUndefined()
    await ctx.fiber.dispose()
  }, 15_000)

  it('rejects executable descriptors that omit script.execute', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRegistry)
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPipelineRuntime)
    await ctx.plugin(RpUiSlotRegistry)
    await ctx.plugin(RpWorkflowRouter)
    await ctx.plugin(RpRegistry)
    await ctx.plugin(LifecycleL1, {})
    const id = RpCapabilityId('test.l1.undeclared')
    const bytes = await createRpTestArchive([
      { name: 'quick.js', body: 'input' },
      { name: 'rp.runtime.json', body: JSON.stringify({
        schemaVersion: 1, components: [], capabilities: [{
          id: String(id), kind: 'tool', title: 'Denied', description: 'Missing permission.',
          scopes: ['conversation'], implementation: { kind: 'quickjs', path: 'quick.js' },
        }],
      }) },
    ])
    const manifest = {
      schemaVersion: 1 as const, id: RpPackageId('bad-l1'), name: 'Bad L1', version: '1.0.0',
      license: 'MIT' as const, trust: 'L1' as const, dependencies: [], components: [],
      capabilities: [String(id)], permissions: [LifecycleL1.L1_EXECUTION_PERMISSION],
      compatibility: { runtime: RP_RUNTIME_V1 },
      integrity: { sha256: createHash('sha256').update(bytes).digest('hex') },
    }
    ctx.rpRegistry.registerProvider({ kind: 'local', resolve: async source => ({ source, manifest, bytes }) })
    await expect(ctx.rpRegistry.install({ kind: 'local', locator: 'bad-l1' }))
      .rejects.toMatchObject({ code: 'PERMISSION' })
    expect(ctx.rpCapabilities.get(id)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
