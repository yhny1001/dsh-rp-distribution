import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpWebCatalog } from '../src/types.ts'
import { RpWebCatalogController } from '../src/client/catalog-controller.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('RP Web catalog projection', () => {
  it('deduplicates concurrent readers and refreshes the shared snapshot explicitly', async () => {
    const catalogs = [{ uiSlots: [] }, { uiSlots: [{ id: 'updated' }] }]
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => catalogs.shift() as unknown as RpWebCatalog,
    }))
    vi.stubGlobal('fetch', fetcher)
    const controller = new RpWebCatalogController('/api/rp/v1')

    await Promise.all([controller.load(), controller.load()])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', catalog: { uiSlots: [] } })

    await controller.load(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', catalog: { uiSlots: [{ id: 'updated' }] },
    })
    controller.dispose()
  })
})
