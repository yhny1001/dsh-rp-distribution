import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyAgent } from '../src/agent.ts'
import { apply as applyProduct } from '../src/index.ts'
import {
  bindSession,
  defaultProductState,
  normalizeEntity,
  removeEntity,
  renderPromptLayer,
  resolvePromptLayers,
  upsertEntity,
} from '../src/model.ts'
import { ProductStore } from '../src/store.ts'

afterEach(() => { vi.unstubAllEnvs() })

describe('@dsh-rp/product', () => {
  it('keeps system, world, character, user persona, and scene in distinct prompt layers', () => {
    const initial = defaultProductState()
    const state = bindSession(initial, {
      sessionId: 'session-one',
      systemId: 'immersive-story',
      characterIds: ['lin-yao'],
      primaryCharacterId: 'lin-yao',
      personaId: 'traveler',
      worldId: 'mist-harbor',
      scene: '观星塔顶层，夜潮刚刚越过北防波堤。',
      updatedAt: 1,
    }, 0, 1)
    const layers = resolvePromptLayers(state, 'session-one')
    expect(layers.map(layer => layer.kind)).toEqual(['system', 'world', 'character', 'persona', 'scene'])
    expect(layers[2]?.content).toContain('当前主要角色：林遥')
    expect(layers[3]?.content).toContain('用户人设描述的是对话中的用户')
    expect(layers[2]?.content).not.toContain('用户身份：')
    expect(layers[1]?.content).toContain('世界观只定义环境、历史与客观规则')
    expect(renderPromptLayer(layers[0]!)).toMatch(/^<rp-system/u)
    expect(renderPromptLayer(layers[3]!)).toMatch(/^<rp-persona/u)
  })

  it('supports multiple characters with one explicit primary role', () => {
    const initial = defaultProductState()
    const second = normalizeEntity('characters', {
      id: 'qin', name: '秦雾', summary: '旧灯塔的临时守望者', personality: '直率', speechStyle: '短句',
      appearance: '灰色斗篷', goals: '守住灯塔', openingMessage: '', accent: '#d97757', updatedAt: 0,
    }, 2)
    const expanded = upsertEntity(initial, 'characters', second, 0)
    const bound = bindSession(expanded, {
      sessionId: 'session-cast', systemId: 'immersive-story', characterIds: ['lin-yao', 'qin'],
      primaryCharacterId: 'qin', personaId: 'traveler', worldId: 'mist-harbor', scene: '', updatedAt: 3,
    }, 1, 3)
    const layer = resolvePromptLayers(bound, 'session-cast').find(item => item.kind === 'character')
    expect(layer?.subtitle).toBe('秦雾')
    expect(layer?.content).toContain('配角阵容：')
    expect(layer?.content).toContain('林遥')
  })

  it('repairs Session bindings when a referenced persona is removed', () => {
    const initial = bindSession(defaultProductState(), {
      sessionId: 'session-delete', systemId: 'immersive-story', characterIds: ['lin-yao'],
      primaryCharacterId: 'lin-yao', personaId: 'traveler', worldId: 'mist-harbor', scene: '', updatedAt: 1,
    }, 0, 1)
    const removed = removeEntity(initial, 'personas', 'traveler', 1)
    expect(removed.bindings['session-delete']?.personaId).toBe('')
    expect(resolvePromptLayers(removed, 'session-delete').find(layer => layer.kind === 'persona')?.empty).toBe(true)
  })

  it('serializes concurrent durable updates behind optimistic revisions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rp-product-'))
    const store = await ProductStore.open(join(root, 'state.json'))
    const first = await store.upsert('personas', {
      id: 'scholar', name: '学者', description: '研究夜潮的人', traits: '', relationship: '', addressAs: '教授', updatedAt: 0,
    }, 0)
    expect(first.revision).toBe(1)
    await expect(store.upsert('personas', {
      id: 'late', name: '迟到者', description: '旧请求', traits: '', relationship: '', addressAs: '', updatedAt: 0,
    }, 0)).rejects.toThrow(/revision conflict/u)
  })

  it('rolls a binding back before releasing the mutation queue when Agent activation fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rp-product-rollback-'))
    const store = await ProductStore.open(join(root, 'state.json'))
    await expect(store.bindWithEffect({
      sessionId: 'session-rollback', systemId: 'immersive-story', characterIds: ['lin-yao'],
      primaryCharacterId: 'lin-yao', personaId: 'traveler', worldId: 'mist-harbor', scene: '', updatedAt: 1,
    }, 0, async () => { throw new Error('preset unavailable') })).rejects.toThrow(/preset unavailable/u)
    expect(store.snapshot().revision).toBe(0)
    expect(store.snapshot().bindings['session-rollback']).toBeUndefined()
  })

  it('registers five separately named native AgentLoop prompt sections', () => {
    const sections: Array<{ name: string; order: number; text: () => string }> = []
    const context = {
      systemPrompt: { section: (section: { name: string; order: number; text: () => string }) => { sections.push(section); return () => {} } },
      agents: { requireInitiator: () => ({ id: 'missing-session' }) },
      effect: (factory: () => unknown) => factory(),
    }
    applyAgent(context)
    expect(sections.map(section => section.name)).toEqual([
      'deployment:persona', 'rp-product:world', 'rp-product:characters', 'rp-product:user-persona', 'rp-product:scene',
    ])
    expect(sections.map(section => section.order)).toEqual([0, 10, 20, 30, 40])
    expect(sections[0]?.text()).toBe('')
  })

  it('recomposes a blank Session and records the selected RP preset', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-rp-product-host-'))
    vi.stubEnv('DSH_HOME', home)
    type CapturedCommand = (input: { agent: {
      id: string
      ctx: object
      session: { events: Array<{ type: string }>; append: (type: string, data: unknown) => unknown }
    }; rawInput: string }) => Promise<{ kind: string; text: string }>
    let command: CapturedCommand | undefined
    const selected: Array<{ type: string; data: unknown }> = []
    const context = {
      webServer: { register: () => () => {} },
      commands: { register: (definition: { handler: CapturedCommand }) => { command = definition.handler; return () => {} } },
      agentPresets: {
        composedPreset: () => 'standard',
        recompose: async () => ({ id: 'rp-studio' }),
      },
      effect: (factory: () => unknown) => factory(),
    }
    await applyProduct(context)
    expect(command).toBeTypeOf('function')
    const rawInput = Buffer.from(JSON.stringify({
      sessionId: 'session-bind', baseRevision: 0, systemId: 'immersive-story', characterIds: ['lin-yao'],
      primaryCharacterId: 'lin-yao', personaId: 'traveler', worldId: 'mist-harbor', scene: 'Test scene',
    })).toString('base64url')
    const result = await command!({
      agent: {
        id: 'session-bind', ctx: {},
        session: { events: [], append: (type, data) => { selected.push({ type, data }); return {} } },
      },
      rawInput,
    })
    expect(result.kind).toBe('success')
    expect(selected).toEqual([{ type: 'agent-preset/selected', data: { agentPreset: 'rp-studio' } }])
  })
})
