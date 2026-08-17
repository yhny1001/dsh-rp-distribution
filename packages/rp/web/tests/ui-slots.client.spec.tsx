import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { RpWebUiSlotSummary } from '../src/types.ts'
import { UiSlotFrames } from '../src/client/ui-slots.tsx'

describe('installable RP UI frames', () => {
  it('grants an empty iframe sandbox and no referrer authority', () => {
    const slot: RpWebUiSlotSummary = {
      packageId: 'example-ui', packageVersion: '1.0.0', id: 'panel', title: 'Panel',
      placement: 'studio.overview', trust: 'L0', script: 'none', height: 240,
      entryUrl: '/api/rp/v1/ui/example-ui/panel/ui/index.html?v=1.0.0',
    }
    const output = UiSlotFrames({
      catalog: { uiSlots: [slot] }, placement: 'studio.overview', t: key => key,
    })
    const frame = findElement(output, 'iframe')
    expect(frame?.props).toMatchObject({
      src: slot.entryUrl,
      sandbox: '',
      referrerPolicy: 'no-referrer',
    })
    expect(frame?.props).not.toHaveProperty('allow')
  })

  it('renders conversation placements through the same opaque frame primitive', () => {
    const slot: RpWebUiSlotSummary = {
      packageId: 'example-ui', packageVersion: '1.0.0', id: 'after', title: 'After',
      placement: 'message.after', trust: 'L0', script: 'none', height: 120,
      entryUrl: '/api/rp/v1/ui/example-ui/after/ui/index.html?v=1.0.0',
    }
    const output = UiSlotFrames({
      catalog: { uiSlots: [slot] }, placement: 'message.after', variant: 'message', t: key => key,
    })
    const section = findElement(output, 'section')
    const frame = findElement(output, 'iframe')
    expect(section?.props).toMatchObject({ 'data-rp-ui-placement': 'message.after' })
    expect(frame?.props).toMatchObject({ sandbox: '', referrerPolicy: 'no-referrer' })
  })
})

function findElement(node: ReactNode, type: string): ReactElement<Record<string, unknown>> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue
    if (child.type === type) return child
    const nested = findElement(child.props.children as ReactNode, type)
    if (nested !== undefined) return nested
  }
  return undefined
}
