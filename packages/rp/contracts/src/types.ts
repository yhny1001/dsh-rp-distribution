/** Client-safe role-playing data types. @module @dsh-rp/contracts/types */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** A losslessly JSON-serializable primitive. */
export type JsonPrimitive = boolean | number | string | null

/** A losslessly JSON-serializable value. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/** A JSON object with string keys. */
export type JsonObject = { [key: string]: JsonValue }

/** Identifies an installable RP package. */
export type RpPackageId = Branded<'RpPackageId'>
/** Identifies one registered component. */
export type RpComponentId = Branded<'RpComponentId'>
/** Identifies one registered capability. */
export type RpCapabilityId = Branded<'RpCapabilityId'>
/** Identifies one registered pipeline. */
export type RpPipelineId = Branded<'RpPipelineId'>
/** Identifies one RP turn transaction. */
export type RpTurnId = Branded<'RpTurnId'>
/** Identifies one immutable composition resolution. */
export type RpCompositionId = Branded<'RpCompositionId'>
/** Identifies one registered rules engine. */
export type RpRuleSystemId = Branded<'RpRuleSystemId'>
/** Identifies one registered media Provider. */
export type RpMediaProviderId = Branded<'RpMediaProviderId'>

/** The supported RP lifetime scopes, from deployment-wide to one agent. */
export type RpScopeKind =
  | 'deployment'
  | 'experience'
  | 'profile'
  | 'conversation'
  | 'scene'
  | 'turn'
  | 'agent'

/** A concrete scope and its optional parent. */
export interface RpScopeRef {
  readonly kind: RpScopeKind
  readonly id: string
  readonly parent?: RpScopeRef
}

/** Where imported data came from and which original bytes remain available. */
export interface SourceProvenance {
  readonly format: string
  readonly sourceId?: string
  readonly importedAt: number
  readonly contentHash?: string
}

/** How one source behavior changed while entering the safe public IR. */
export type CompatibilityDisposition = 'preserved-inert' | 'normalized' | 'disabled' | 'omitted'

/** One path-addressed compatibility difference. */
export interface CompatibilityLossItem {
  readonly path: string
  readonly feature: string
  readonly disposition: CompatibilityDisposition
  readonly reason: string
}

/** Versioned import report separating retained data from executable behavior. */
export interface CompatibilityLossReport {
  readonly schemaVersion: 1
  readonly losslessData: boolean
  readonly executableBehaviorDisabled: boolean
  readonly items: readonly CompatibilityLossItem[]
}

/** Preserved source fields that the active runtime does not execute. */
export interface CompatibilityEnvelope {
  readonly source: SourceProvenance
  readonly unknownFields: JsonObject
  readonly warnings?: readonly string[]
  readonly lossReport?: CompatibilityLossReport
}

/** A normalized role-playing character. */
export interface CharacterIR {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly personality?: string
  readonly scenario?: string
  readonly firstMessages: readonly string[]
  readonly examples?: readonly string[]
  readonly tags?: readonly string[]
  readonly extensions?: JsonObject
  readonly compatibility?: CompatibilityEnvelope
}

/** A normalized user persona. */
export interface PersonaIR {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly description: string
  readonly extensions?: JsonObject
  readonly compatibility?: CompatibilityEnvelope
}

/** One lore entry with deterministic activation metadata. */
export interface LoreEntryIR {
  readonly id: string
  readonly content: string
  readonly keys: readonly string[]
  readonly secondaryKeys?: readonly string[]
  readonly constant?: boolean
  readonly enabled: boolean
  readonly priority: number
  readonly extensions?: JsonObject
}

/** A normalized lorebook or world-info document. */
export interface LoreIR {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly entries: readonly LoreEntryIR[]
  readonly compatibility?: CompatibilityEnvelope
}

/** A named prompt contribution with explicit ordering constraints. */
export interface PromptSectionIR {
  readonly schemaVersion: 1
  readonly id: string
  readonly content: string
  readonly role: 'system' | 'user' | 'assistant'
  readonly priority: number
  readonly before?: readonly string[]
  readonly after?: readonly string[]
}

/** The authoritative typed state document for a conversation branch. */
export interface StateDocument {
  readonly schemaVersion: 1
  readonly revision: number
  readonly owner: string
  readonly value: JsonObject
}

/** A closed state mutation operation. */
export type StatePatchOperation =
  | { readonly op: 'add' | 'replace'; readonly path: string; readonly value: JsonValue }
  | { readonly op: 'remove'; readonly path: string }
  | { readonly op: 'test'; readonly path: string; readonly value: JsonValue }

/** A revision-checked state mutation proposal. */
export interface StatePatch {
  readonly baseRevision: number
  readonly owner: string
  readonly operations: readonly StatePatchOperation[]
}

/** One active RP scene. */
export interface SceneIR {
  readonly schemaVersion: 1
  readonly id: string
  readonly title: string
  readonly summary?: string
  readonly participants: readonly string[]
  readonly location?: string
  readonly time?: string
  readonly extensions?: JsonObject
}

/** Directed relationship state between two entities. */
export interface RelationshipIR {
  readonly schemaVersion: 1
  readonly from: string
  readonly to: string
  readonly revision: number
  readonly dimensions: Readonly<Record<string, number>>
  readonly notes?: readonly string[]
}

/** One durable memory fact with provenance and salience. */
export interface MemoryEvent {
  readonly schemaVersion: 1
  readonly id: string
  readonly owner: string
  readonly content: string
  readonly salience: number
  readonly createdAt: number
  readonly sourceTurn?: RpTurnId
  readonly tags?: readonly string[]
}

/** A generated or imported media artifact. */
export interface MediaArtifact {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'image' | 'audio' | 'video' | 'document'
  readonly mimeType: string
  readonly uri: string
  readonly metadata?: JsonObject
}

/** Storage-neutral immutable image reference suitable for a model input block. */
export interface RpImageAttachmentIR {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

/** Model-visible media materialization resolved from one durable artifact. */
export type RpModelMediaInput = {
  readonly type: 'image'
  readonly attachment: RpImageAttachmentIR
}

/** Package execution trust. */
export type RpTrustLevel = 'L0' | 'L1' | 'L2'

/** Host-owned seats which an installable package may fill with sandboxed UI. */
export type RpUiSlotPlacement =
  | 'studio.overview'
  | 'studio.creator'
  | 'studio.inspector'
  | 'conversation.sidebar'
  | 'message.after'

/** Code and resource declaration for one opaque-origin package UI frame. */
export interface RpUiSlotManifest {
  readonly schemaVersion: 1
  /** Package-local stable identity. */
  readonly id: string
  readonly title: string
  readonly placement: RpUiSlotPlacement
  /** HTML entry path inside the integrity-bound package archive. */
  readonly entry: string
  /** Every package-local resource this frame is allowed to request, including entry. */
  readonly assets: readonly string[]
  /** Whether the opaque-origin iframe may execute package-local JavaScript. */
  readonly script: 'none' | 'sandbox'
  /** Initial iframe height in CSS pixels. The Host still clamps this value. */
  readonly height?: number
}

/** A package dependency. `version` is exact or `*` in the initial registry. */
export interface RpPackageDependency {
  readonly id: RpPackageId
  readonly version: string
  readonly optional?: boolean
}

/** Installable RP package metadata. */
export interface RpPackageManifest {
  readonly schemaVersion: 1
  readonly id: RpPackageId
  readonly name: string
  readonly version: string
  readonly license: 'MIT'
  readonly trust: RpTrustLevel
  readonly dependencies: readonly RpPackageDependency[]
  readonly components: readonly RpComponentId[]
  readonly capabilities: readonly string[]
  /** Package-local UI Slot ids contributed by the signed runtime descriptor. */
  readonly uiSlots?: readonly string[]
  /** Explicit host authority requested by this package. */
  readonly permissions?: readonly string[]
  /** Allowed outbound origins; empty means no network. */
  readonly networkDomains?: readonly string[]
  /** Allowed file roots; empty means no file access. */
  readonly fileRoots?: readonly string[]
  /** Optional package integrity and signing metadata. */
  readonly integrity?: {
    readonly sha256?: string
    readonly signature?: string
    readonly keyId?: string
    readonly sbom?: string
  }
  readonly assets?: readonly string[]
  readonly compatibility?: Readonly<Record<string, string>>
}

/** An agent profile selected by an Experience. */
export interface RpAgentProfile {
  readonly id: string
  readonly role: string
  readonly provider?: string
  readonly instructions?: string
  readonly capabilities: readonly string[]
  readonly budget?: RpBudget
}

/** Common execution budgets enforced by policy and runtimes. */
export interface RpBudget {
  readonly timeoutMs?: number
  readonly maxTokens?: number
  readonly maxToolCalls?: number
  readonly maxAgents?: number
  readonly maxCostUsd?: number
}

/** A complete RP composition selected for a conversation. */
export interface RpExperienceManifest {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly components: readonly RpComponentId[]
  readonly agents: readonly RpAgentProfile[]
  readonly pipelines: Readonly<Partial<Record<'turn' | 'workflow' | 'sidecar', RpPipelineId>>>
  readonly uiSlots?: readonly string[]
  readonly defaults?: JsonObject
}
