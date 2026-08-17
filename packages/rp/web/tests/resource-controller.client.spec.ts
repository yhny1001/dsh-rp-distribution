// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { RpWebResourceController } from '../src/client/resource-controller.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('RP conversation resource controller', () => {
  it('persists and activates every Character Card asset, then saves and binds a preset', async () => {
    const requests: unknown[] = []
    const character = { id: 'character-1', name: '岚', description: '观星台守门人', savedAt: 1 }
    const lore = { id: 'lore-1', name: '观星台', entryCount: 2, savedAt: 1 }
    const activeCharacters: string[] = []
    const activeLorebooks: string[] = []
    const library = () => ({
      schemaVersion: 1 as const,
      sessionId: 'session-rp',
      characters: [character], personas: [], lorebooks: [lore],
      active: {
        snapshotHash: 'library-hash',
        characterIds: [...activeCharacters], personaIds: [], lorebookIds: [...activeLorebooks],
      },
    })
    const presets = (active = false) => ({
      schemaVersion: 1 as const,
      sessionId: 'session-rp',
      presets: [{
        id: 'preset-1', name: '北棱预设2.0', selectedPromptOrderId: 'order-1',
        promptDefinitionCount: 18, promptOrderCount: 2, enabledPromptIds: ['main'], generation: {}, savedAt: 1,
      }],
      ...(active ? { active: {
        presetId: 'preset-1', snapshotHash: 'preset-hash',
        selectedPromptOrderId: 'order-1', enabledPromptIds: ['main'],
      } } : {}),
    })

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (init?.method !== 'POST') {
        return Response.json(url.includes('/library')
          ? { ...library(), characters: [], lorebooks: [], active: undefined }
          : { ...presets(), presets: [], active: undefined })
      }
      if (typeof init.body !== 'string') throw new Error('expected a JSON request body')
      const body = JSON.parse(init.body) as Record<string, unknown>
      requests.push(body)
      if (url.includes('/library')) {
        if (body.action === 'save') return Response.json({ ...library(), action: 'save', assetIds: ['character-1', 'lore-1'] })
        if (body.assetKind === 'character') activeCharacters.push(String(body.assetId))
        if (body.assetKind === 'lore') activeLorebooks.push(String(body.assetId))
        return Response.json({ ...library(), action: body.action, assetIds: [body.assetId] })
      }
      if (body.action === 'save') return Response.json({ ...presets(), action: 'save', presetId: 'preset-1' })
      return Response.json({ ...presets(true), action: body.action, presetId: body.presetId })
    }))

    const controller = new RpWebResourceController('/api/rp/v1')
    const sessionId = 'session-rp' as SessionId
    const card = new File([JSON.stringify({ spec: 'chara_card_v3', data: { name: '岚' } })], '岚.json', {
      type: 'application/json',
    })
    await controller.importFile(sessionId, 'character-card-json', card)
    expect(controller.storeFor(sessionId).getSnapshot().library?.active).toMatchObject({
      characterIds: ['character-1'], lorebookIds: ['lore-1'],
    })
    expect(requests.slice(0, 3)).toEqual([
      expect.objectContaining({ action: 'save', kind: 'character-card-json' }),
      expect.objectContaining({ action: 'activate', assetKind: 'character', assetId: 'character-1' }),
      expect.objectContaining({ action: 'activate', assetKind: 'lore', assetId: 'lore-1' }),
    ])

    await controller.importFile(sessionId, 'preset', new File(['{}'], '北棱预设2.0.json', { type: 'application/json' }))
    expect(controller.storeFor(sessionId).getSnapshot()).toMatchObject({
      phase: 'ready', importedFile: '北棱预设2.0.json',
      presets: { active: { presetId: 'preset-1' } },
    })
    expect(requests.slice(3)).toEqual([
      expect.objectContaining({ action: 'save', sourceId: '北棱预设2.0.json' }),
      expect.objectContaining({ action: 'activate', sessionId: 'session-rp', presetId: 'preset-1' }),
    ])
    controller.dispose()
  })

  it('loads and saves a full editor document while retaining the current activation', async () => {
    let name = '守门人'
    const requests: Record<string, unknown>[] = []
    const catalog = () => ({
      schemaVersion: 1 as const, sessionId: 'session-rp',
      characters: [{ id: 'character-1', name, description: '观星台守门人', savedAt: 2 }],
      personas: [], lorebooks: [],
      active: { snapshotHash: 'hash', characterIds: ['character-1'], personaIds: [], lorebookIds: [] },
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (init?.method !== 'POST') {
        expect(url).toContain('assetKind=character')
        return Response.json({
          schemaVersion: 1, assetKind: 'character', savedAt: 2,
          asset: { schemaVersion: 1, id: 'character-1', name, description: '观星台守门人', firstMessages: ['欢迎。'] },
        })
      }
      if (typeof init.body !== 'string') throw new Error('expected a JSON request body')
      const body = JSON.parse(init.body) as Record<string, unknown>
      requests.push(body)
      const asset = body.asset as { name: string }
      name = asset.name
      return Response.json({ ...catalog(), action: 'update', assetIds: ['character-1'] })
    }))

    const controller = new RpWebResourceController('/api/rp/v1')
    const sessionId = 'session-rp' as SessionId
    await controller.openEditor(sessionId, { kind: 'character', id: 'character-1' })
    const opened = controller.storeFor(sessionId).getSnapshot().editor.document
    expect(opened).toMatchObject({ kind: 'character', asset: { id: 'character-1', name: '守门人' } })
    if (opened?.kind !== 'character') throw new Error('expected Character editor')
    await controller.saveEditor(sessionId, { ...opened, asset: { ...opened.asset, name: '新守门人' } })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      action: 'update', sessionId: 'session-rp', assetKind: 'character', assetId: 'character-1',
    })
    expect(requests[0]?.asset).toMatchObject({ name: '新守门人' })
    expect(controller.storeFor(sessionId).getSnapshot()).toMatchObject({
      phase: 'ready',
      library: { active: { characterIds: ['character-1'] } },
      editor: { phase: 'ready', document: { asset: { name: '新守门人' } } },
    })
    controller.dispose()
  })
})
