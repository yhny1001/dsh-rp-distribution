import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RpPresetRuntime } from '@dsh-rp/preset'
import { describe, expect, it } from 'vitest'
import { mutatePreset, presetCatalog, presetDetail } from '../src/index.ts'

const identifiers = Array.from({ length: 18 }, (_, index) => index === 0 ? 'main' : `prompt-${index}`)
const source = JSON.stringify({
  prompts: identifiers.map((identifier, index) => ({
    identifier,
    name: `Prompt ${index}`,
    role: 'system',
    content: `content-${index}`,
    marker: index === 1,
  })),
  prompt_order: [
    { character_id: 100000, order: identifiers.slice(0, 11).map((identifier, index) => ({ identifier, enabled: index !== 5 })) },
    { character_id: 100001, order: identifiers.map((identifier, index) => ({ identifier, enabled: index !== 9 && index !== 17 })) },
  ],
  temperature: 1,
})

function runtime(ctx: Context, cells: Map<string, unknown>): RpPresetRuntime {
  return new RpPresetRuntime(ctx, {
    get: (key: string) => cells.get(key) as never,
    put: (key: string, value: unknown) => {
      cells.set(key, structuredClone(value))
      return Promise.resolve()
    },
  } as never)
}

async function host(cells: Map<string, unknown>, sessionId?: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  ctx.provide('rpPresets', runtime(ctx, cells))
  if (sessionId !== undefined) ctx.sessions.create(SessionId(sessionId))
  return ctx
}

describe('RP Web durable preset API', () => {
  it('saves every definition and order, pre-binds a new conversation, and restores it after Host restart', async () => {
    const cells = new Map<string, unknown>()
    const sessionId = 'preset-web-session'
    const first = await host(cells)
    const saved = await mutatePreset(first, { action: 'save', source, sourceId: '北棱预设2.0.json' })
    expect(saved).toMatchObject({
      action: 'save',
      presets: [{ promptDefinitionCount: 18, promptOrderCount: 2, selectedPromptOrderId: '100001' }],
    })
    expect(saved.presets[0]?.enabledPromptIds).toHaveLength(16)
    const activated = await mutatePreset(first, {
      action: 'activate', sessionId, presetId: saved.presetId,
    })
    expect(activated.active).toMatchObject({
      presetId: saved.presetId, selectedPromptOrderId: '100001', enabledPromptIds: saved.presets[0]?.enabledPromptIds,
    })
    expect(activated.active?.snapshotHash).toMatch(/^[a-f0-9]{64}$/u)
    const detail = presetDetail(first, saved.presetId)
    const updated = await mutatePreset(first, {
      action: 'update', sessionId, presetId: saved.presetId,
      preset: {
        ...detail.preset,
        name: '北棱预设 2.0（已编辑）',
        selectedPromptOrderId: '100000',
        promptDefinitions: detail.preset.promptDefinitions.map(item => item.id === 'main'
          ? { ...item, content: 'edited-main-content' } : item),
      },
    })
    expect(updated).toMatchObject({
      action: 'update', presetId: saved.presetId,
      active: { presetId: saved.presetId, selectedPromptOrderId: '100000' },
    })
    expect(updated.active?.enabledPromptIds).toHaveLength(10)
    const editedDetail = presetDetail(first, saved.presetId)
    expect(editedDetail.preset.name).toBe('北棱预设 2.0（已编辑）')
    expect(editedDetail.preset.prompts[0]).toMatchObject({ id: 'main', content: 'edited-main-content' })
    first.sessions.create(SessionId(sessionId))
    expect(presetCatalog(first, sessionId).active).toEqual(updated.active)
    await first.fiber.dispose()

    const restarted = await host(cells, sessionId)
    expect(presetCatalog(restarted, sessionId).active).toEqual(updated.active)
    await expect(mutatePreset(restarted, { action: 'deactivate', sessionId }))
      .resolves.toMatchObject({ action: 'deactivate', presets: [{ promptDefinitionCount: 18 }] })
    expect(presetCatalog(restarted, sessionId).active).toBeUndefined()
    await expect(mutatePreset(restarted, { action: 'erase', presetId: saved.presetId }))
      .rejects.toThrow('unsupported preset action')
    await restarted.fiber.dispose()
  })
})
