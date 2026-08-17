/** RP component-registry types. @module @dsh-rp/component-runtime/types */

import type {
  RpComponentId,
  RpCompositionId,
  RpPackageId,
  RpScopeKind,
  RpScopeRef,
  RpTrustLevel,
} from '@dsh-rp/contracts'

/** One dependency on another registered component. */
export interface RpComponentDependency {
  readonly id: RpComponentId
  readonly version?: string
  readonly optional?: boolean
}

/** Static metadata contributed by one RP plugin. */
export interface RpComponentDefinition {
  readonly id: RpComponentId
  readonly packageId: RpPackageId
  readonly version: string
  readonly trust: RpTrustLevel
  readonly scopes: readonly RpScopeKind[]
  readonly dependencies?: readonly RpComponentDependency[]
  readonly provides?: readonly string[]
  readonly requires?: readonly string[]
}

/** Inputs to deterministic component resolution. */
export interface RpCompositionRequest {
  readonly scope: RpScopeRef
  readonly components: readonly RpComponentId[]
  readonly grantedCapabilities: readonly string[]
}

/** Immutable component metadata captured for one turn or agent operation. */
export interface RpCompositionSnapshot {
  readonly id: RpCompositionId
  readonly scope: RpScopeRef
  readonly components: readonly RpComponentDefinition[]
  readonly grantedCapabilities: readonly string[]
  readonly createdAt: number
}
