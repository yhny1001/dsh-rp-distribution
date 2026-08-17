import { describe, expect, it } from 'vitest'
import {
  RpCapabilityId,
  RpComponentId,
  RpCompositionId,
  RpPackageId,
  RpPipelineId,
  RpTurnId,
} from '../src/index.ts'

describe('@dsh-rp/contracts', () => {
  it('brands every opaque id without changing its runtime representation', () => {
    expect(RpPackageId('package')).toBe('package')
    expect(RpComponentId('component')).toBe('component')
    expect(RpCapabilityId('capability')).toBe('capability')
    expect(RpPipelineId('pipeline')).toBe('pipeline')
    expect(RpTurnId('turn')).toBe('turn')
    expect(RpCompositionId('composition')).toBe('composition')
  })
})
