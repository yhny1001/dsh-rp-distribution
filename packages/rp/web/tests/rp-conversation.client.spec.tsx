// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { RpWebCatalogState } from '../src/client/catalog-controller.ts'
import { en, zh, type RpStudioLocaleKey } from '../src/client/locales.ts'
import {
  RpConversationView,
  RpModeControl,
  RpTurnStatus,
  type RpConversationViewProps,
  type RpModeControlProps,
  type RpTurnStatusProps,
} from '../src/client/rp-conversation.tsx'
import type { RpWebTurnClientState } from '../src/client/turn-controller.ts'

afterEach(cleanup)

const t = (key: RpStudioLocaleKey): string => en[key]
const tZh = (key: RpStudioLocaleKey): string => zh[key]
const state = (patch: Partial<RpWebTurnClientState> = {}): RpWebTurnClientState => ({
  mode: 'rp',
  experienceId: 'rp-adaptive',
  phase: 'idle',
  timelinePhase: 'idle',
  requestId: undefined,
  response: undefined,
  timeline: undefined,
  error: undefined,
  timelineError: undefined,
  ...patch,
})

function hook<T>(value: T): SnapshotSelectorHook<T> {
  return selector => selector(value)
}

const catalog = {
  status: 'ready',
  catalog: {
    experiences: [
      { id: 'rp-adaptive', name: 'Adaptive' },
      { id: 'rp-fast', name: 'Fast' },
    ],
  },
} as unknown as RpWebCatalogState

describe('RP conversation Web surfaces', () => {
  it('switches submission mode and selects a registered Experience', () => {
    const setMode = vi.fn()
    const setExperience = vi.fn()
    render(<RpModeControl {...({
      useRpTurn: hook(state()),
      useRpCatalog: hook(catalog),
      loadCatalog: vi.fn(async () => {}),
      setMode,
      setExperience,
      t,
    } as unknown as RpModeControlProps)} />)

    const mode = screen.getByRole('combobox', { name: 'Conversation mode' })
    expect((mode as HTMLSelectElement).value).toBe('rp-adaptive')
    expect(screen.getByRole('option', { name: 'RP · Adaptive RP' })).toBeTruthy()
    fireEvent.change(mode, { target: { value: 'agent' } })
    expect(setMode).toHaveBeenCalledWith('agent')
    fireEvent.change(mode, { target: { value: 'rp-fast' } })
    expect(setExperience).toHaveBeenCalledWith('rp-fast')
    expect(setMode).toHaveBeenCalledWith('rp')
  })

  it('presents first-party RP modes in Chinese without changing their stable ids', () => {
    render(<RpModeControl {...({
      useRpTurn: hook(state()),
      useRpCatalog: hook(catalog),
      loadCatalog: vi.fn(async () => {}),
      setMode: vi.fn(),
      setExperience: vi.fn(),
      t: tZh,
    } as unknown as RpModeControlProps)} />)

    expect(screen.getByRole('combobox', { name: '对话模式' })).toBeTruthy()
    const adaptive = screen.getByRole('option', { name: 'RP 模式 · 自适应 RP' }) as HTMLOptionElement
    expect(adaptive.value).toBe('rp-adaptive')
    expect(screen.getByRole('option', { name: 'RP 模式 · 快速 RP' })).toBeTruthy()
  })

  it('exposes exact cancellation and uncertain-delivery retry guidance', () => {
    const cancelTurn = vi.fn()
    const { rerender } = render(<RpTurnStatus {...({
      useRpTurn: hook(state({ phase: 'running' })),
      cancelTurn,
      t,
    } as unknown as RpTurnStatusProps)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancelTurn).toHaveBeenCalledOnce()

    rerender(<RpTurnStatus {...({
      useRpTurn: hook(state({
        phase: 'error',
        error: { code: 'DURABILITY', message: 'flush uncertain', retryWithSameRequestId: true },
      })),
      cancelTurn,
      t,
    } as unknown as RpTurnStatusProps)} />)
    expect(screen.getByRole('alert').textContent).toContain('Send the unchanged draft again')
  })

  it('correlates context and commit events, rendering Session-authorized input images', async () => {
    const loadTimeline = vi.fn(async () => {})
    const resolveImage = vi.fn(() => Promise.resolve('data:image/png;base64,AQ=='))
    render(<RpConversationView {...({
      sessionId: 'session-rp',
      useRpTurn: hook(state({
        timelinePhase: 'ready',
        timeline: {
          sessionId: 'session-rp',
          events: [{
            seq: 11,
            time: 90,
            type: 'rp/context-activated',
            data: {
              turnId: 'turn-1', input: { text: 'Open the door' },
              content: [{
                type: 'image',
                attachment: {
                  attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png',
                  bytes: 1, width: 1, height: 1, name: 'scene.png',
                },
              }],
            },
          }, {
            seq: 12,
            time: 100,
            type: 'rp/turn-committed',
            data: { turnId: 'turn-1', assistantMessage: 'It opens.' },
          }],
          projection: { turns: [] },
        },
      })),
      loadTimeline,
      resolveImage,
      t,
    } as unknown as RpConversationViewProps)} />)

    expect(screen.getByText('Open the door')).toBeTruthy()
    expect(screen.getByText('It opens.')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Open original image: scene.png' })).toBeTruthy()
    expect(resolveImage).toHaveBeenCalledWith(expect.objectContaining({ name: 'scene.png' }))
    expect(screen.getByText(/Agent \/ Pipeline event inspector/)).toBeTruthy()
    expect(loadTimeline).toHaveBeenCalledOnce()
  })
})
