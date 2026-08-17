import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpComponentRegistry from '@dsh-rp/component-runtime'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import RpPipelineRuntime from '@dsh-rp/pipeline-runtime'
import RpExperienceRegistry from '@dsh-rp/experience-registry'
import RpRegistry, { parseRpPackageSource } from '@dsh-rp/registry'
import RpOutbox from '@dsh-rp/outbox'
import RpWorkflowRouter from '@dsh-rp/workflow-router'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import RpProjectionService from '@dsh-rp/projection'
import RpRulesRuntime from '@dsh-rp/rules'
import RpMediaRuntime from '@dsh-rp/media'
import RpMemoryBasic from '@dsh-rp/memory-basic'
import RpPolicyRuntime from '@dsh-rp/policy'
import RpUiSlotRegistry from '@dsh-rp/ui-slot-runtime'
import { RpLibraryRuntime } from '@dsh-rp/library'
import { RpPackageId, RpPipelineId, RpTurnId } from '@dsh-rp/contracts'
import {
  catalog,
  importPayload,
  libraryAssetDetail,
  libraryCatalog,
  mutateLibrary,
  mutateRegistry,
  resolveUiResource,
  timeline,
  uiSlotResourceUrl,
} from '../src/index.ts'

describe('RP Web catalog', () => {
  it('projects runtime registries without creating an execution path', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRegistry); await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPolicyRuntime)
    await ctx.plugin(RpPipelineRuntime); await ctx.plugin(RpExperienceRegistry)
    await ctx.plugin(RpRegistry); await ctx.plugin(RpOutbox); await ctx.plugin(RpWorkflowRouter)
    await ctx.plugin(RpRulesRuntime); await ctx.plugin(RpMediaRuntime)
    await ctx.plugin(RpMemoryBasic)
    await ctx.plugin(RpUiSlotRegistry)
    ctx.rpPipelines.register({
      id: RpPipelineId('studio.pipeline'), kind: 'workflow', version: '1.0.0', description: 'Studio graph',
      trust: 'L2', permissions: ['rp.pipeline.execute'], stages: [{ id: 'stage', run: async () => ({ ok: true }) }],
    })
    ctx.rpRegistry.publish({
      schemaVersion: 1, id: RpPackageId('studio-fixture'), name: 'Studio fixture', version: '1.0.0',
      license: 'MIT', trust: 'L0', dependencies: [], components: [], capabilities: [],
    }, parseRpPackageSource('registry:studio-fixture'), 1)
    const result = catalog(ctx)
    expect(result.workflowBackends).toEqual([{ id: 'deterministic', kind: 'deterministic', trust: 'L0', priority: -100, kinds: ['turn', 'workflow', 'sidecar'] }])
    expect(result.registryReleases).toMatchObject([{
      id: 'studio-fixture', version: '1.0.0', evidenceVerified: false, signed: false,
      signingKeyRevoked: false,
    }])
    expect(result.registryInstallations).toEqual([])
    expect(result.registryLifecycleAdapters).toEqual([])
    expect(result.registrySecurityPolicies).toEqual([])
    expect(result.registryArtifactStore).toBeUndefined()
    expect(result.ruleSystems).toEqual([{ id: 'seeded-dice', version: '1.0.0', title: 'Seeded Dice' }])
    expect(result.mediaProviders).toMatchObject([{ id: 'svg-card', kinds: ['image'], trust: 'L0' }])
    expect(result.memoryRetrievers).toMatchObject([{ id: 'lexical', priority: 0 }])
    expect(result.memoryStores).toEqual([])
    expect(result.uiSlots).toEqual([])
    expect(result.capabilityAuthorizers).toEqual([{ id: 'rp-policy-layers', priority: 1000 }])
    expect(result.policyLayers).toEqual([])
    expect(result.pipelines).toMatchObject([{
      id: 'studio.pipeline', trust: 'L2', permissions: ['rp.pipeline.execute'], levels: [['stage']],
    }])
    expect(result.outbox).toEqual({ pending: 0, running: 0, completed: 0, failed: 0 })
  })

  it('serves live UI resources under an opaque-frame CSP and removes them with the Slot', async () => {
    const ctx = new Context()
    await ctx.plugin(RpUiSlotRegistry)
    const dispose = ctx.rpUiSlots.register({
      definition: {
        schemaVersion: 1,
        packageId: RpPackageId('@example/plugin-ui'), packageVersion: '1.2.3', trust: 'L0',
        id: 'inspector', title: 'Inspector', placement: 'studio.inspector',
        entry: 'ui/index.html', assets: ['ui/index.html', 'ui/styles.css'], script: 'none', height: 480,
      },
      resources: [
        { path: 'ui/index.html', bytes: new TextEncoder().encode('<link rel="stylesheet" href="styles.css">') },
        { path: 'ui/styles.css', bytes: new TextEncoder().encode('body { color: white }') },
      ],
    })
    const url = uiSlotResourceUrl('@example/plugin-ui', 'inspector', 'ui/index.html', '1.2.3')
    expect(url).toContain('%40example%2Fplugin-ui')
    const entry = resolveUiResource(ctx, url, ['http://127.0.0.1:3080'])
    expect(entry.status).toBe(200)
    expect(entry.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(entry.headers['content-security-policy']).toContain("connect-src 'none'")
    expect(entry.headers['content-security-policy']).toContain("script-src 'none'")
    expect(entry.headers['content-security-policy']).toContain('style-src http://127.0.0.1:3080/api/rp/v1/ui/%40example%2Fplugin-ui/inspector/')
    expect(entry.headers['content-security-policy']).not.toContain('allow-same-origin')
    expect(resolveUiResource(ctx, '/api/rp/v1/ui/%40example%2Fplugin-ui/inspector/ui/%2E%2E/secret').status).toBe(404)
    dispose()
    expect(resolveUiResource(ctx, url).status).toBe(404)
    await ctx.fiber.dispose()
  })

  it('installs, updates, inspects, and uninstalls package locks through the Host mutation API', async () => {
    const ctx = new Context()
    await ctx.plugin(RpRegistry)
    ctx.rpRegistry.registerProvider({
      kind: 'npm',
      resolve: async source => ({
        source,
        manifest: {
          schemaVersion: 1,
          id: RpPackageId('web-package'),
          name: 'Web package',
          version: source.ref ?? '0.0.0',
          license: 'MIT',
          trust: 'L0',
          dependencies: [],
          components: [],
          capabilities: [],
          permissions: ['rp.read'],
          networkDomains: ['example.test'],
          fileRoots: ['/fixtures'],
        },
      }),
    })
    const installed = await mutateRegistry(ctx, { action: 'install', source: 'npm:web-package@1.0.0' })
    expect(installed).toMatchObject({
      action: 'install', rootId: 'web-package', installed: true,
      installation: {
        rootVersion: '1.0.0',
        packages: [{ permissions: ['rp.read'], networkDomains: ['example.test'], fileRoots: ['/fixtures'] }],
      },
    })
    await expect(mutateRegistry(ctx, { action: 'update', source: 'npm:web-package@2.0.0' }))
      .resolves.toMatchObject({ action: 'update', installation: { rootVersion: '2.0.0' } })
    await expect(mutateRegistry(ctx, { action: 'uninstall', rootId: 'web-package' }))
      .resolves.toMatchObject({ action: 'uninstall', installed: false })
    expect(ctx.rpRegistry.listInstallations()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('projects RP events for one live Session timeline', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(RpProjectionService)
    const session = ctx.sessions.create(SessionId('rp-web-timeline'))
    session.append('rp/turn-aborted', {
      schemaVersion: 1,
      turnId: RpTurnId('turn-1'),
      reason: 'cancelled',
      abortedAt: 1,
    })
    expect(timeline(ctx, { sessionId: 'rp-web-timeline' })).toMatchObject({
      sessionId: 'rp-web-timeline',
      events: [{ type: 'rp/turn-aborted' }],
      projection: { turns: [], aborted: [{ reason: 'cancelled' }] },
    })
    await ctx.fiber.dispose()
  })

  it('returns path-addressed compatibility reports without traversing retained unknown fields', () => {
    const response = importPayload({
      kind: 'character-card-json', sourceId: 'creator-test',
      source: JSON.stringify({
        spec: 'chara_card_v3', data: {
          name: 'Safe', description: '', personality: '', scenario: '', first_mes: 'Hi', mes_example: '',
          alternate_greetings: [], tags: [], extensions: { regex_scripts: [{ findRegex: 'x' }] },
        },
      }),
    })
    expect(response.lossReports).toMatchObject([{
      path: '$.character.compatibility.lossReport',
      report: { losslessData: true, executableBehaviorDisabled: true, items: [{ feature: 'display-regex' }] },
    }])
    expect(importPayload({
      kind: 'persona', sourceId: 'creator-persona', source: JSON.stringify({ name: 'Visitor', description: 'Astronomer' }),
    })).toMatchObject({ kind: 'persona', result: { name: 'Visitor', description: 'Astronomer' } })
  })

  it('pre-binds imported assets before the Session is live and preserves the immutable selection', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const table = { get: () => undefined, put: async () => {} }
    ctx.provide('rpLibrary', new RpLibraryRuntime(ctx, table as never))
    const card = await mutateLibrary(ctx, {
      action: 'save', kind: 'character-card-json', sourceId: 'hero.json',
      source: JSON.stringify({
        spec: 'chara_card_v3', data: {
          name: 'Hero', description: 'Observatory keeper', personality: '', scenario: '', first_mes: 'Welcome',
          mes_example: '', alternate_greetings: [], tags: [],
          character_book: { name: 'Sky', entries: [{ id: 1, keys: ['stars'], content: 'The sky is clear.', enabled: true }] },
        },
      }),
    })
    expect(card.assetIds).toHaveLength(2)
    const persona = await mutateLibrary(ctx, {
      action: 'save', kind: 'persona', sourceId: 'visitor.json',
      source: JSON.stringify({ name: 'Visitor', description: 'An invited astronomer.' }),
    })
    const [characterId, loreId] = card.assetIds
    const [personaId] = persona.assetIds
    await mutateLibrary(ctx, {
      action: 'activate', sessionId: 'rp-library-session', assetKind: 'character', assetId: characterId!,
    })
    await mutateLibrary(ctx, {
      action: 'activate', sessionId: 'rp-library-session', assetKind: 'persona', assetId: personaId!,
    })
    const activated = await mutateLibrary(ctx, {
      action: 'activate', sessionId: 'rp-library-session', assetKind: 'lore', assetId: loreId!,
    })
    expect(activated).toMatchObject({
      sessionId: 'rp-library-session',
      active: { characterIds: [characterId], personaIds: [personaId], lorebookIds: [loreId] },
    })
    expect(activated.active?.snapshotHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(libraryCatalog(ctx, 'rp-library-session')).toMatchObject({
      characters: [{ name: 'Hero' }], personas: [{ name: 'Visitor' }], lorebooks: [{ name: 'Sky', entryCount: 1 }],
      active: { snapshotHash: activated.active?.snapshotHash },
    })
    ctx.sessions.create(SessionId('rp-library-session'))
    expect(libraryCatalog(ctx, 'rp-library-session').active).toEqual(activated.active)
    const hero = libraryAssetDetail(ctx, 'character', characterId!)
    await mutateLibrary(ctx, {
      action: 'update', sessionId: 'rp-library-session', assetKind: 'character', assetId: characterId!,
      asset: { ...hero.asset, description: 'Edited observatory keeper' },
    })
    expect(libraryAssetDetail(ctx, 'character', characterId!)).toMatchObject({
      asset: { id: characterId, description: 'Edited observatory keeper' },
    })
    expect(libraryCatalog(ctx, 'rp-library-session').active?.characterIds).toEqual([characterId])
    const lore = libraryAssetDetail(ctx, 'lore', loreId!)
    if (!('entries' in lore.asset)) throw new Error('expected lore detail')
    await mutateLibrary(ctx, {
      action: 'update', sessionId: 'rp-library-session', assetKind: 'lore', assetId: loreId!,
      asset: { ...lore.asset, entries: lore.asset.entries.map(entry => ({ ...entry, content: 'Edited sky lore.' })) },
    })
    expect(libraryAssetDetail(ctx, 'lore', loreId!)).toMatchObject({
      asset: { entries: [{ content: 'Edited sky lore.' }] },
    })
    expect(libraryCatalog(ctx, 'rp-library-session').active?.lorebookIds).toEqual([loreId])
    await mutateLibrary(ctx, { action: 'remove', assetKind: 'character', assetId: characterId! })
    expect(libraryCatalog(ctx, 'rp-library-session').active?.characterIds).toEqual([])
    await expect(mutateLibrary(ctx, {
      action: 'destroy', assetKind: 'lore', assetId: loreId,
    })).rejects.toThrow('Unsupported RP library action')
    expect(libraryCatalog(ctx).lorebooks).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
