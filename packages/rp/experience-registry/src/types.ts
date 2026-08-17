/** Experience discovery and adaptive-selection types. @module @dsh-rp/experience-registry/types */

import type { RpExperienceManifest } from '@dsh-rp/contracts'

/** Task facts the top-level Agent may provide when selecting an Experience. */
export interface RpExperienceSelectionRequest {
  readonly requested?: string
  readonly agentChoice?: string
  readonly allowed?: readonly string[]
  readonly hints?: {
    readonly participantCount?: number
    readonly worldSimulation?: boolean
    readonly rules?: boolean
    readonly creator?: boolean
    readonly director?: boolean
    readonly quality?: 'fast' | 'balanced' | 'maximum'
  }
}

/** Selected Experience and the policy rule that selected it. */
export interface RpExperienceSelection {
  readonly experience: RpExperienceManifest
  readonly reason: 'requested' | 'agent-choice' | 'creator' | 'rules' | 'world-sim' | 'multi-character' | 'premium' | 'directed' | 'fast' | 'adaptive'
}
