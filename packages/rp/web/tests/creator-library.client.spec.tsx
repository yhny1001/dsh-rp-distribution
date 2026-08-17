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

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

describe('RP Creator asset library', () => {
  it('restores active assets and routes the explicit deactivate mutation', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url.includes('/presets')) {
        return { ok: true, json: async () => ({ schemaVersion: 1, presets: [] }) }
      }
      if (init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            schemaVersion: 1, sessionId: 'session-1', characters: [{ id: 'hero', name: 'Hero', savedAt: 1 }],
            personas: [], lorebooks: [], assetIds: ['hero'], action: 'deactivate',
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          schemaVersion: 1, sessionId: 'session-1', characters: [{ id: 'hero', name: 'Hero', savedAt: 1 }],
          personas: [], lorebooks: [],
          active: { snapshotHash: 'a'.repeat(64), characterIds: ['hero'], personaIds: [], lorebookIds: [] },
        }),
      }
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
    expect(await screen.findByText('Hero')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'SillyTavern Persona' })).toBeTruthy()
    expect(document.querySelector('[data-rp-library-file]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate from session' }))
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith('/api/rp/v1/library', expect.objectContaining({ method: 'POST' }))
    })
    const call = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')
    const body = call?.[1]?.body
    if (typeof body !== 'string') throw new Error('expected a JSON string request body')
    expect(JSON.parse(body)).toEqual({
      action: 'deactivate', assetKind: 'character', assetId: 'hero', sessionId: 'session-1',
    })
  })
})
