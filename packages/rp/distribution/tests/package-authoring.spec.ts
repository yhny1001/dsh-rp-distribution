import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import RpComponentRegistry from '@dsh-rp/component-runtime'
import { RpCapabilityId } from '@dsh-rp/contracts'
import * as LifecycleL0 from '@dsh-rp/lifecycle-l0'
import * as LifecycleL1 from '@dsh-rp/lifecycle-l1'
import type { RpRuntimeArchiveFile, RpRuntimeDescriptor } from '@dsh-rp/package-runtime'
import RpPipelineRuntime from '@dsh-rp/pipeline-runtime'
import RpRegistry from '@dsh-rp/registry'
import RpUiSlotRegistry from '@dsh-rp/ui-slot-runtime'
import * as RegistrySources from '@dsh-rp/registry-sources'
import { buildRpPackage, validateRpPackageManifest } from '@dsh-rp/sdk'
import * as SandboxBackends from '@dsh-rp/workflow-backends-sandbox'
import RpWorkflowRouter from '@dsh-rp/workflow-router'

const EXAMPLES = fileURLToPath(new URL('../../../../examples/rp-package-authoring/', import.meta.url))
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('RP package authoring examples', () => {
  it('builds, installs, invokes, and totally unloads L0 and QuickJS package graphs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rp-package-authoring-'))
    temporaryRoots.push(root)
    const l0Release = await materializeRelease(root, 'l0-orchestration')
    const l1Release = await materializeRelease(root, 'l1-quickjs-critic', ['runtime/critic.js'])
    const uiRelease = await materializeRelease(root, 'l0-ui-panel', ['ui/index.html', 'ui/styles.css'])
    const ctx = new Context()
    try {
      await ctx.plugin(RpComponentRegistry)
      await ctx.plugin(RpCapabilityCatalog)
      await ctx.plugin(RpPipelineRuntime)
      await ctx.plugin(RpUiSlotRegistry)
      await ctx.plugin(RpWorkflowRouter)
      await ctx.plugin(SandboxBackends)
      await ctx.plugin(RpRegistry)
      await ctx.plugin(RegistrySources, { localRoots: [root], maxArtifactBytes: 4 * 1024 * 1024 })
      await ctx.plugin(LifecycleL0, {})
      await ctx.plugin(LifecycleL1, {})

      await ctx.rpRegistry.install({ kind: 'local', locator: l0Release })
      expect(ctx.rpComponents.list()).toMatchObject([{ id: 'example.rp-suite' }])
      expect(ctx.rpCapabilities.list({ kind: 'agent' }).map(item => item.id)).toContain('example.actor.echo')
      expect(ctx.rpCapabilities.list({ kind: 'memory' }).map(item => item.id)).toContain('example.memory.echo')
      expect(ctx.rpPipelines.list().map(item => item.id)).toEqual([
        'example.sidecar.memory', 'example.turn.directed',
      ])
      await expect(ctx.rpCapabilities.invoke(RpCapabilityId('example.turn.directed'), {
        scope: { kind: 'conversation', id: 'conversation-example' },
        input: { text: 'hello' },
        grantedPermissions: [],
      })).resolves.toEqual({
        'stage.actor.result': { text: 'hello' },
        'stage.memory.result': { text: 'hello' },
      })

      await ctx.rpRegistry.install({ kind: 'local', locator: l1Release })
      await ctx.rpRegistry.install({ kind: 'local', locator: uiRelease })
      expect(ctx.rpRegistry.listActivePackages()).toMatchObject([
        { id: 'example.quickjs-critic', runtimeActive: true },
        { id: 'example.rp-orchestration', runtimeActive: true },
        { id: 'example.rp-ui-panel', runtimeActive: true },
      ])
      expect(ctx.rpUiSlots.list()).toMatchObject([{
        packageId: 'example.rp-ui-panel', id: 'overview-panel', placement: 'studio.overview',
      }])
      await expect(ctx.rpCapabilities.invoke(RpCapabilityId('example.critic.pipeline'), {
        scope: { kind: 'conversation', id: 'conversation-example' },
        input: { text: 'check continuity' },
        grantedPermissions: [],
        grantedTrust: 'L1',
      })).rejects.toMatchObject({ code: 'PERMISSION' })
      await expect(ctx.rpCapabilities.invoke(RpCapabilityId('example.critic.pipeline'), {
        scope: { kind: 'conversation', id: 'conversation-example' },
        input: { text: 'check continuity' },
        grantedPermissions: ['script.execute'],
        grantedTrust: 'L1',
      })).resolves.toEqual({
        'stage.critic.result': {
          role: 'continuity-critic',
          finding: 'check continuity',
          process: 'undefined',
          fetch: 'undefined',
        },
      })

      await ctx.rpRegistry.uninstall('example.rp-orchestration')
      expect(ctx.rpPipelines.list().map(item => item.id)).toEqual(['example.critic.pipeline'])
      expect(ctx.rpCapabilities.get(RpCapabilityId('example.actor.echo'))).toBeUndefined()
      await ctx.rpRegistry.uninstall('example.quickjs-critic')
      await ctx.rpRegistry.uninstall('example.rp-ui-panel')
      expect(ctx.rpPipelines.list()).toEqual([])
      expect(ctx.rpCapabilities.list()).toEqual([])
      expect(ctx.rpComponents.list()).toEqual([])
      expect(ctx.rpUiSlots.list()).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

async function materializeRelease(
  root: string,
  example: string,
  assetPaths: readonly string[] = [],
): Promise<string> {
  const source = join(EXAMPLES, example)
  const validation = validateRpPackageManifest(JSON.parse(readFileSync(join(source, 'rp.package.json'), 'utf8')))
  if (!validation.valid || validation.manifest === undefined) {
    throw new Error(validation.diagnostics.map(item => `${item.path}: ${item.message}`).join('; '))
  }
  const descriptor = JSON.parse(readFileSync(join(source, 'rp.runtime.json'), 'utf8')) as RpRuntimeDescriptor
  const files: RpRuntimeArchiveFile[] = assetPaths.map(path => ({
    path,
    bytes: new Uint8Array(readFileSync(join(source, path))),
  }))
  const built = await buildRpPackage({ manifest: validation.manifest, descriptor, files })
  const release = join(root, example)
  mkdirSync(release)
  writeFileSync(join(release, 'rp.package.json'), `${JSON.stringify(built.manifest, undefined, 2)}\n`)
  writeFileSync(join(release, 'rp.package.tgz'), built.archive)
  writeFileSync(join(release, 'rp.sbom.json'), `${JSON.stringify(built.sbom, undefined, 2)}\n`)
  return release
}
