import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import RpComponentRegistry from '@dsh-rp/component-runtime'
import { RpCapabilityId, RpComponentId, RpPackageId, RpPipelineId } from '@dsh-rp/contracts'
import RpRegistry from '@dsh-rp/registry'
import RpWorkflowRouter from '@dsh-rp/workflow-router'
import { RP_RUNTIME_V1 } from '@dsh-rp/package-runtime'
import RpPipelineRuntime from '@dsh-rp/pipeline-runtime'
import RpUiSlotRegistry from '@dsh-rp/ui-slot-runtime'
import { createRpTestArchive } from '../../package-runtime/tests/archive-fixture.ts'
import * as LifecycleL0 from '../src/index.ts'

describe('@dsh-rp/lifecycle-l0', () => {
  it('installs, invokes, and totally releases a declarative package graph', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRegistry)
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPipelineRuntime)
    await ctx.plugin(RpUiSlotRegistry)
    await ctx.plugin(RpWorkflowRouter)
    await ctx.plugin(RpRegistry)
    const fiber = await ctx.plugin(LifecycleL0, {
      maxUnpackedBytes: 1024 * 1024,
      maxFiles: 8,
      maxFileBytes: 256 * 1024,
    })
    const id = RpCapabilityId('test.l0.echo')
    const turn = RpPipelineId('test.l0.turn')
    const turnCapability = RpCapabilityId(String(turn))
    const component = RpComponentId('test.l0.component')
    const bytes = await createRpTestArchive([
      { name: 'ui/index.html', body: '<h1>Declarative panel</h1>' },
      { name: 'rp.runtime.json', body: JSON.stringify({
        schemaVersion: 1,
        components: [{ id: String(component), scopes: ['conversation'], provides: ['echo'] }],
        capabilities: [
          {
            id: String(id), kind: 'tool', title: 'Echo', description: 'Echo JSON input.', scopes: ['conversation'],
            implementation: { kind: 'expression', expression: { op: 'input' } },
          },
          {
            id: String(turnCapability), kind: 'pipeline', title: 'Packaged turn',
            description: 'Routes the turn through the Pipeline Runtime.', scopes: ['conversation'],
          },
        ],
        pipelines: [{
          id: String(turn), kind: 'turn', description: 'Installable one-stage turn.',
          stages: [{ id: 'actor', operation: { kind: 'invoke-capability', capabilityId: String(id) } }],
        }],
        uiSlots: [{
          schemaVersion: 1, id: 'panel', title: 'Declarative panel', placement: 'studio.overview',
          entry: 'ui/index.html', assets: ['ui/index.html'], script: 'none', height: 240,
        }],
      }) },
    ])
    const manifest = {
      schemaVersion: 1 as const,
      id: RpPackageId('test-l0-package'),
      name: 'Test L0 package',
      version: '1.0.0',
      license: 'MIT' as const,
      trust: 'L0' as const,
      dependencies: [],
      components: [component],
      capabilities: [String(id), String(turnCapability)],
      uiSlots: ['panel'],
      assets: ['ui/index.html'],
      compatibility: { runtime: RP_RUNTIME_V1 },
      integrity: { sha256: createHash('sha256').update(bytes).digest('hex') },
    }
    ctx.rpRegistry.registerProvider({
      kind: 'local',
      resolve: async source => ({ source, manifest, bytes }),
    })

    await ctx.rpRegistry.install({ kind: 'local', locator: 'test-l0-package' })
    expect(ctx.rpComponents.list()).toMatchObject([{ id: component, packageId: manifest.id }])
    await expect(ctx.rpCapabilities.invoke(id, {
      scope: { kind: 'conversation', id: 'conversation-1' },
      input: { value: 42 },
      grantedPermissions: [],
    })).resolves.toEqual({ value: 42 })
    expect(ctx.rpPipelines.list().map(item => item.id)).toEqual([turn])
    expect(ctx.rpUiSlots.list()).toMatchObject([{
      packageId: manifest.id, id: 'panel', placement: 'studio.overview', script: 'none',
    }])
    await expect(ctx.rpCapabilities.invoke(turnCapability, {
      scope: { kind: 'conversation', id: 'conversation-1' },
      input: { line: 'hello' },
      grantedPermissions: [],
    })).resolves.toEqual({ 'stage.actor.result': { line: 'hello' } })

    await ctx.rpRegistry.uninstall(String(manifest.id))
    expect(ctx.rpComponents.list()).toEqual([])
    expect(ctx.rpCapabilities.get(id)).toBeUndefined()
    expect(ctx.rpPipelines.list()).toEqual([])
    expect(ctx.rpUiSlots.list()).toEqual([])
    await fiber.dispose()
    expect(ctx.rpRegistry.listLifecycleAdapters()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('requires payload integrity before a runtime descriptor can activate', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRegistry)
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPipelineRuntime)
    await ctx.plugin(RpUiSlotRegistry)
    await ctx.plugin(RpWorkflowRouter)
    await ctx.plugin(RpRegistry)
    await ctx.plugin(LifecycleL0, {})
    const bytes = await createRpTestArchive([{ name: 'rp.runtime.json', body: JSON.stringify({
      schemaVersion: 1, components: [], capabilities: [],
    }) }])
    ctx.rpRegistry.registerProvider({
      kind: 'local',
      resolve: async source => ({ source, bytes, manifest: {
        schemaVersion: 1, id: RpPackageId('unsigned-l0'), name: 'Unsigned L0', version: '1.0.0',
        license: 'MIT', trust: 'L0', dependencies: [], components: [], capabilities: [],
        compatibility: { runtime: RP_RUNTIME_V1 },
      } }),
    })
    await expect(ctx.rpRegistry.install({ kind: 'local', locator: 'unsigned-l0' }))
      .rejects.toMatchObject({ code: 'EVIDENCE' })
    expect(ctx.rpRegistry.listInstallations()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('rolls back every earlier registration when atomic activation collides', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRegistry)
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPipelineRuntime)
    await ctx.plugin(RpUiSlotRegistry)
    await ctx.plugin(RpWorkflowRouter)
    await ctx.plugin(RpRegistry)
    await ctx.plugin(LifecycleL0, {})
    const first = RpCapabilityId('test.l0.partial-first')
    const colliding = RpCapabilityId('test.l0.colliding')
    const component = RpComponentId('test.l0.partial-component')
    const releaseExternal = ctx.rpCapabilities.register({
      descriptor: {
        id: colliding, kind: 'tool', version: 'external', title: 'Existing', description: 'Existing owner.',
        trust: 'L0', scopes: ['deployment'],
      },
    })
    const bytes = await createRpTestArchive([
      { name: 'ui/rollback.html', body: '<p>must disappear</p>' },
      { name: 'rp.runtime.json', body: JSON.stringify({
        schemaVersion: 1,
        components: [{ id: String(component), scopes: ['deployment'] }],
        capabilities: [
          { id: String(first), kind: 'tool', title: 'First', description: 'Must roll back.', scopes: ['deployment'] },
          { id: String(colliding), kind: 'tool', title: 'Collision', description: 'Must fail.', scopes: ['deployment'] },
        ],
        uiSlots: [{
          schemaVersion: 1, id: 'rollback', title: 'Rollback', placement: 'studio.overview',
          entry: 'ui/rollback.html', assets: ['ui/rollback.html'], script: 'none',
        }],
      }) },
    ])
    const manifest = {
      schemaVersion: 1 as const, id: RpPackageId('colliding-l0'), name: 'Colliding L0', version: '1.0.0',
      license: 'MIT' as const, trust: 'L0' as const, dependencies: [], components: [component],
      capabilities: [String(first), String(colliding)], compatibility: { runtime: RP_RUNTIME_V1 },
      uiSlots: ['rollback'], assets: ['ui/rollback.html'],
      integrity: { sha256: createHash('sha256').update(bytes).digest('hex') },
    }
    ctx.rpRegistry.registerProvider({ kind: 'local', resolve: async source => ({ source, manifest, bytes }) })

    await expect(ctx.rpRegistry.install({ kind: 'local', locator: 'colliding-l0' }))
      .rejects.toMatchObject({ code: 'LIFECYCLE' })
    expect(ctx.rpComponents.list()).toEqual([])
    expect(ctx.rpCapabilities.get(first)).toBeUndefined()
    expect(ctx.rpCapabilities.get(colliding)?.version).toBe('external')
    expect(ctx.rpUiSlots.list()).toEqual([])
    expect(ctx.rpRegistry.listInstallations()).toEqual([])
    releaseExternal()
    await ctx.fiber.dispose()
  })
})
