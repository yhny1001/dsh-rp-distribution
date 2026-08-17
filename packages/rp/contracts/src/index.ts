/** RP intermediate representations and branded identifiers. @module @dsh-rp/contracts */

import type {
  RpCapabilityId as CapabilityId,
  RpComponentId as ComponentId,
  RpCompositionId as CompositionId,
  RpPackageId as PackageId,
  RpPipelineId as PipelineId,
  RpRuleSystemId as RuleSystemId,
  RpMediaProviderId as MediaProviderId,
  RpTurnId as TurnId,
} from './types.ts'

export type * from './types.ts'

/** Public package-id type paired with the runtime branding helper. */
export type RpPackageId = PackageId
/** Public component-id type paired with the runtime branding helper. */
export type RpComponentId = ComponentId
/** Public capability-id type paired with the runtime branding helper. */
export type RpCapabilityId = CapabilityId
/** Public pipeline-id type paired with the runtime branding helper. */
export type RpPipelineId = PipelineId
/** Public turn-id type paired with the runtime branding helper. */
export type RpTurnId = TurnId
/** Public composition-id type paired with the runtime branding helper. */
export type RpCompositionId = CompositionId
/** Public rules-engine id type paired with the runtime branding helper. */
export type RpRuleSystemId = RuleSystemId
/** Public media-Provider id type paired with the runtime branding helper. */
export type RpMediaProviderId = MediaProviderId

/**
 * Brand a raw package id.
 * @param id - Non-empty package id.
 * @returns The same string with its package brand.
 */
export function RpPackageId(id: string): PackageId {
  return id as PackageId
}

/**
 * Brand a raw component id.
 * @param id - Non-empty component id.
 * @returns The same string with its component brand.
 */
export function RpComponentId(id: string): ComponentId {
  return id as ComponentId
}

/**
 * Brand a raw capability id.
 * @param id - Non-empty capability id.
 * @returns The same string with its capability brand.
 */
export function RpCapabilityId(id: string): CapabilityId {
  return id as CapabilityId
}

/**
 * Brand a raw pipeline id.
 * @param id - Non-empty pipeline id.
 * @returns The same string with its pipeline brand.
 */
export function RpPipelineId(id: string): PipelineId {
  return id as PipelineId
}

/**
 * Brand a raw turn id.
 * @param id - Non-empty turn id.
 * @returns The same string with its turn brand.
 */
export function RpTurnId(id: string): TurnId {
  return id as TurnId
}

/**
 * Brand a raw composition hash.
 * @param id - Non-empty composition hash.
 * @returns The same string with its composition brand.
 */
export function RpCompositionId(id: string): CompositionId {
  return id as CompositionId
}

/**
 * Brand a raw rules-engine id.
 * @param id - Non-empty rules-engine id.
 * @returns The same string with its rules-engine brand.
 */
export function RpRuleSystemId(id: string): RuleSystemId {
  return id as RuleSystemId
}

/**
 * Brand a raw media-Provider id.
 * @param id - Non-empty media-Provider id.
 * @returns The same string with its media-Provider brand.
 */
export function RpMediaProviderId(id: string): MediaProviderId {
  return id as MediaProviderId
}
