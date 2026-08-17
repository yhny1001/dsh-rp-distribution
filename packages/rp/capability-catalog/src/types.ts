/** Unified RP capability types. @module @dsh-rp/capability-catalog/types */

import type {
  JsonObject,
  JsonValue,
  RpBudget,
  RpCapabilityId,
  RpScopeKind,
  RpScopeRef,
  RpTrustLevel,
} from '@dsh-rp/contracts'

/** Capability families visible to agents and Experience composers. */
export type RpCapabilityKind =
  | 'tool'
  | 'skill'
  | 'subagent'
  | 'agent'
  | 'pipeline'
  | 'memory'
  | 'lore'
  | 'media'
  | 'rules'

/** Public discovery metadata for one capability. */
export interface RpCapabilityDescriptor {
  readonly id: RpCapabilityId
  readonly kind: RpCapabilityKind
  readonly version: string
  readonly title: string
  readonly description: string
  readonly trust: RpTrustLevel
  readonly scopes: readonly RpScopeKind[]
  readonly permissions?: readonly string[]
  readonly budget?: RpBudget
  readonly inputSchema?: JsonObject
  readonly outputSchema?: JsonObject
  readonly tags?: readonly string[]
}

/** Invocation after policy intersection. */
export interface RpCapabilityInvocation {
  readonly scope: RpScopeRef
  readonly input: JsonValue
  readonly grantedPermissions: readonly string[]
  /** Caller-owned trust ceiling. Omission means L0, never ambient native trust. */
  readonly grantedTrust?: RpTrustLevel
  readonly budget?: RpBudget
  readonly networkDomains?: readonly string[]
  readonly fileRoots?: readonly string[]
  readonly policyLayers?: readonly RpCapabilityPolicyLayer[]
  readonly signal?: AbortSignal
  /** Synchronous fail-closed audit hook invoked after authorization and before adapter execution. */
  readonly onAuthorized?: (authority: RpCapabilityAuthorityDecision) => void
}

/** Structurally portable policy ceiling supplied by user, Agent, or call scope. */
export interface RpCapabilityPolicyLayer {
  readonly name: string
  readonly permissions?: readonly string[]
  readonly maxTrust?: RpTrustLevel
  readonly budget?: RpBudget
  readonly networkDomains?: readonly string[]
  readonly fileRoots?: readonly string[]
}

/** Least authority delivered to an owning capability adapter. */
export interface RpCapabilityAuthorityDecision {
  readonly permissions: readonly string[]
  readonly trust: RpTrustLevel
  readonly budget: RpBudget
  readonly networkDomains: readonly string[]
  readonly fileRoots: readonly string[]
  readonly layers: readonly string[]
}

/** Effective authority passed to the owning adapter. */
export interface RpResolvedCapabilityInvocation extends RpCapabilityInvocation {
  readonly capability: RpCapabilityDescriptor
  readonly effectiveAuthority: RpCapabilityAuthorityDecision
  /** Compatibility alias for `effectiveAuthority.budget`. */
  readonly effectiveBudget: RpBudget
}

/** Immutable input to a reversible authorization adapter. */
export interface RpCapabilityAuthorizationRequest {
  readonly capability: RpCapabilityDescriptor
  readonly invocation: RpCapabilityInvocation
  readonly authority: RpCapabilityAuthorityDecision
}

/** A policy adapter may only preserve or narrow the current authority. */
export interface RpCapabilityAuthorizer {
  readonly id: string
  readonly priority?: number
  authorize(request: RpCapabilityAuthorizationRequest): RpCapabilityAuthorityDecision
}

/** An owning registry adapter registered into the unified catalog. */
export interface RpCapabilityContribution {
  readonly descriptor: RpCapabilityDescriptor
  readonly invoke?: (request: RpResolvedCapabilityInvocation) => Promise<JsonValue>
}

/** Discovery filters; every supplied field is conjunctive. */
export interface RpCapabilityQuery {
  readonly kind?: RpCapabilityKind
  readonly scope?: RpScopeKind
  readonly tag?: string
  readonly permittedBy?: readonly string[]
  readonly trustedBy?: RpTrustLevel
}
