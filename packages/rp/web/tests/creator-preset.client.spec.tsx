// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpStudio } from '../src/client/index.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const catalog = {
  schemaVersion: 1,
  generatedAt: 1,
  experiences: [], components: [], capabilities: [], capabilityAuthorizers: [], policyLayers: [], pipelines: [],
  workflowBackends: [], ruleSystems: [], mediaProviders: [], mediaInputAdapters: [], memoryRetrievers: [],
  memoryStores: [], uiSlots: [], registryReleases: [], registryInstallations: [], registryLifecycleAdapters: [],
  registrySourceProviders: [], registrySecurityPolicies: [], outbox: { pending: 0, running: 0, completed: 0, failed: 0 },
}
const identifiers = Array.from({ length: 18 }, (_, index) => index === 0 ? 'main' : `prompt-${index}`)
const source = JSON.stringify({
  prompts: identifiers.map((identifier, index) => ({ identifier, content: `content-${index}` })),
  prompt_order: [
    { character_id: 100000, order: identifiers.slice(0, 11).map(identifier => ({ identifier, enabled: true })) },
    { character_id: 100001, order: identifiers.map((identifier, index) => ({ identifier, enabled: index < 16 })) },
  ],
})
const presetId = 'preset:beiling'
const summary = {
  id: presetId, name: '北棱预设2.0.json', selectedPromptOrderId: '100001',
  promptDefinitionCount: 18, promptOrderCount: 2, enabledPromptIds: identifiers.slice(0, 16),
  generation: {}, savedAt: 1,
}

function response(value: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(value) } as Response
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new Error('expected a JSON string request body')
  return init.body
}

describe('RP Creator preset flow', () => {
  it('selects a file, previews it, saves it durably, and activates it for the current Session', async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      if (init?.method !== 'POST') return Promise.resolve(response(url.endsWith('/library?sessionId=session-1')
        ? { schemaVersion: 1, sessionId: 'session-1', characters: [], personas: [], lorebooks: [] }
        : { schemaVersion: 1, sessionId: 'session-1', presets: [] }))
      const body = JSON.parse(requestBody(init)) as { action?: string }
      if (url.endsWith('/import')) {
        return Promise.resolve(response({
          kind: 'preset', lossReports: [],
          result: {
            schemaVersion: 1, id: presetId, name: summary.name,
            promptDefinitions: identifiers.map(id => ({ id })),
            promptOrders: [{ id: '100000' }, { id: '100001' }],
            selectedPromptOrderId: '100001', prompts: identifiers.slice(0, 16), generation: {},
          },
        }))
      }
      if (body.action === 'save') {
        return Promise.resolve(response({ schemaVersion: 1, presets: [summary], action: 'save', presetId }))
      }
      return Promise.resolve(response({
        schemaVersion: 1, sessionId: 'session-1', presets: [summary], action: 'activate', presetId,
        active: {
          presetId, snapshotHash: 'a'.repeat(64), selectedPromptOrderId: '100001',
          enabledPromptIds: identifiers.slice(0, 16),
        },
      }))
    })
    vi.stubGlobal('fetch', fetcher)
    render(<RpStudio {...({
      t: (key: keyof typeof en) => en[key],
      useRpCatalog: (selector: (value: unknown) => unknown) => selector({ status: 'ready', catalog }),
      useRpTurnLatest: (selector: (value: unknown) => unknown) => selector({}),
      useSessions: (selector: (value: unknown) => unknown) => selector({ current: 'session-1' as SessionId }),
      loadCatalog: async () => {},
    } as unknown as ComponentProps<typeof RpStudio>)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Creator Studio' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Import format' }), { target: { value: 'preset' } })
    const file = new File([source], '北棱预设2.0.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(source) })
    const input = document.querySelector('[data-rp-preset-file]')
    if (!(input instanceof HTMLInputElement)) throw new Error('preset file input is missing')
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Import and preview' })
      if (!(button instanceof HTMLButtonElement)) throw new Error('preset import button is missing')
      expect(button.disabled).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import and preview' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save preset durably' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Activate for current session' }))

    await screen.findByText(`Active preset: ${presetId}`)
    const bodies = fetcher.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(requestBody(init)) as { action?: string; sourceId?: string; sessionId?: string })
    expect(bodies).toMatchObject([
      { sourceId: '北棱预设2.0.json' },
      { action: 'save', sourceId: '北棱预设2.0.json' },
      { action: 'activate', sessionId: 'session-1' },
    ])
  })
})
