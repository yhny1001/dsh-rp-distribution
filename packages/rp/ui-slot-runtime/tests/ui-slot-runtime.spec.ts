import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RpPackageId } from '@dsh-rp/contracts'
import RpUiSlotRegistry from '../src/index.ts'

const definition = {
  schemaVersion: 1 as const,
  packageId: RpPackageId('example-ui'), packageVersion: '1.0.0', trust: 'L0' as const,
  id: 'panel', title: 'Example', placement: 'studio.overview' as const,
  entry: 'ui/index.html', assets: ['ui/index.html'], script: 'none' as const,
}

describe('@dsh-rp/ui-slot-runtime', () => {
  it('copies resources and totally releases one contribution', async () => {
    const ctx = new Context()
    await ctx.plugin(RpUiSlotRegistry)
    const source = new TextEncoder().encode('<h1>safe</h1>')
    const dispose = ctx.rpUiSlots.register({ definition, resources: [{ path: 'ui/index.html', bytes: source }] })
    source.fill(0)
    expect(new TextDecoder().decode(ctx.rpUiSlots.resource('example-ui', 'panel', 'ui/index.html'))).toBe('<h1>safe</h1>')
    const detached = ctx.rpUiSlots.resource('example-ui', 'panel', 'ui/index.html') as Uint8Array
    detached.fill(0)
    expect(new TextDecoder().decode(ctx.rpUiSlots.resource('example-ui', 'panel', 'ui/index.html'))).toBe('<h1>safe</h1>')
    dispose(); dispose()
    expect(ctx.rpUiSlots.list()).toEqual([])
    expect(ctx.rpUiSlots.resource('example-ui', 'panel', 'ui/index.html')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('rejects runtime v1 scripts, path traversal, undeclared and missing resources', async () => {
    const ctx = new Context()
    await ctx.plugin(RpUiSlotRegistry)
    expect(() => ctx.rpUiSlots.register({
      definition: { ...definition, trust: 'L2', script: 'sandbox' }, resources: [{ path: 'ui/index.html', bytes: new Uint8Array() }],
    })).toThrow(/browser script/)
    expect(() => ctx.rpUiSlots.register({
      definition, resources: [{ path: '../index.html', bytes: new Uint8Array() }],
    })).toThrow(/unsafe/)
    expect(() => ctx.rpUiSlots.register({ definition, resources: [] })).toThrow(/missing resource/)
    expect(ctx.rpUiSlots.list()).toEqual([])
    await ctx.fiber.dispose()
  })
})
