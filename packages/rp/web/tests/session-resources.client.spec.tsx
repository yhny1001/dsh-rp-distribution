// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { zh, type RpStudioLocaleKey } from '../src/client/locales.ts'
import {
  RpSessionInspector,
  RpSessionResources,
  type RpSessionInspectorProps,
  type RpSessionResourcesProps,
} from '../src/client/session-resources.tsx'
import type { RpWebResourceClientState } from '../src/client/resource-controller.ts'
import type { RpWebTurnClientState } from '../src/client/turn-controller.ts'

afterEach(cleanup)
const t = (key: RpStudioLocaleKey): string => zh[key]
const hook = <T,>(value: T): SnapshotSelectorHook<T> => selector => selector(value)

const turn = (patch: Partial<RpWebTurnClientState> = {}): RpWebTurnClientState => ({
  mode: 'rp', experienceId: 'rp-adaptive', phase: 'idle', timelinePhase: 'ready',
  requestId: undefined, response: undefined, timeline: undefined,
  error: undefined, timelineError: undefined, ...patch,
})

const resources = (): RpWebResourceClientState => ({
  phase: 'ready', importedFile: undefined, error: undefined,
  editor: { phase: 'closed', target: undefined, document: undefined, error: undefined },
  library: {
    schemaVersion: 1, sessionId: 'session-rp',
    characters: [{ id: 'character-1', name: '岚', description: '观星台守门人', savedAt: 1 }],
    personas: [], lorebooks: [{ id: 'lore-1', name: '观星台', entryCount: 2, savedAt: 1 }],
    active: {
      snapshotHash: 'library-hash', characterIds: [], personaIds: [], lorebookIds: ['lore-1'],
    },
  },
  presets: {
    schemaVersion: 1, sessionId: 'session-rp',
    presets: [{
      id: 'preset-1', name: '北棱预设2.0', selectedPromptOrderId: 'order-1',
      promptDefinitionCount: 18, promptOrderCount: 2, enabledPromptIds: ['main'], generation: {}, savedAt: 1,
    }],
    active: {
      presetId: 'preset-1', snapshotHash: 'preset-hash',
      selectedPromptOrderId: 'order-1', enabledPromptIds: ['main'],
    },
  },
})

describe('RP Session resource rails', () => {
  it('renders neither rail in ordinary Agent mode', () => {
    const common = {
      useRpTurn: hook(turn({ mode: 'agent' })),
      useRpResources: hook(resources()),
      loadResources: vi.fn(async () => {}),
      t,
    }
    const { container } = render(<>
      <RpSessionResources {...({
        ...common, wide: true,
        importResource: vi.fn(async () => {}),
        setResourceActive: vi.fn(async () => {}),
        setPresetActive: vi.fn(async () => {}),
      } as unknown as RpSessionResourcesProps)} />
      <RpSessionInspector {...({
        ...common, sessionId: 'session-rp', loadTimeline: vi.fn(async () => {}),
      } as unknown as RpSessionInspectorProps)} />
    </>)

    expect(container.childElementCount).toBe(0)
  })

  it('imports a selected preset file and toggles Character assets from the left rail', () => {
    const importResource = vi.fn(async () => {})
    const setResourceActive = vi.fn(async () => {})
    const openResourceEditor = vi.fn(async () => {})
    render(<RpSessionResources {...({
      wide: true,
      useRpTurn: hook(turn()),
      useRpResources: hook(resources()),
      loadResources: vi.fn(async () => {}),
      importResource,
      setResourceActive,
      setPresetActive: vi.fn(async () => {}),
      openResourceEditor,
      t,
    } as unknown as RpSessionResourcesProps)} />)

    fireEvent.change(screen.getByRole('combobox', { name: '导入类型' }), { target: { value: 'preset' } })
    const file = new File(['{}'], '北棱预设2.0.json', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('选择要导入的 RP 文件'), { target: { files: [file] } })
    expect(importResource).toHaveBeenCalledWith('preset', file)

    fireEvent.click(screen.getByRole('button', { name: '激活到当前会话 岚' }))
    expect(setResourceActive).toHaveBeenCalledWith('character', 'character-1', true)
    fireEvent.click(screen.getByRole('button', { name: '编辑资源 岚' }))
    expect(openResourceEditor).toHaveBeenCalledWith({ kind: 'character', id: 'character-1' })
    expect(screen.getByText('北棱预设2.0')).toBeTruthy()
    expect(screen.getByText('18 条定义 · 1 条启用 · 2 套顺序')).toBeTruthy()
  })

  it('summarizes current composition and replayed world state in the right rail', () => {
    render(<RpSessionInspector {...({
      sessionId: 'session-rp',
      useRpTurn: hook(turn({
        timeline: {
          sessionId: 'session-rp',
          events: [{ seq: 8, time: 1, type: 'rp/turn-committed', data: { turnId: 'turn-1' } }],
          projection: {
            state: { revision: 3 }, memories: [{ id: 'm1' }], branches: [{ id: 'b1' }],
            agents: [{ id: 'a1' }, { id: 'a2' }], pipelines: [{ id: 'p1' }],
          },
        },
      })),
      useRpResources: hook(resources()),
      loadResources: vi.fn(async () => {}),
      loadTimeline: vi.fn(async () => {}),
      t,
    } as unknown as RpSessionInspectorProps)} />)

    expect(screen.getByText('RP 检查器')).toBeTruthy()
    expect(screen.getByText('观星台')).toBeTruthy()
    expect(screen.getByText('北棱预设2.0')).toBeTruthy()
    expect(screen.getByText('18 条定义 · 1 条启用 · 2 套顺序')).toBeTruthy()
    expect(screen.getByText('状态版本').parentElement?.textContent).toContain('3')
    expect(screen.getByText('智能体').parentElement?.textContent).toContain('2')
    expect(screen.getByText('最近事件').parentElement?.textContent).toContain('rp/turn-committed')
    expect(screen.getByText('最近提交').parentElement?.textContent).toContain('turn-1')
  })
})
