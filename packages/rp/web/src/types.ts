/** Client-safe RP Studio HTTP types. @module @dsh-rp/web/types */
import type {
  CharacterIR,
  CompatibilityEnvelope,
  CompatibilityLossReport,
  JsonObject,
  JsonValue,
  LoreIR,
  PersonaIR,
  PromptSectionIR,
  RpBudget,
  RpExperienceManifest,
  RpTrustLevel,
  RpUiSlotPlacement,
} from '@dsh-rp/contracts'

/** Component metadata exposed by the Studio catalog. */
export interface RpWebComponentSummary {
  readonly id: string
  readonly version: string
  readonly trust: string
  readonly scopes: readonly string[]
  readonly provides: readonly string[]
}
/** Capability metadata exposed by the Studio catalog. */
export interface RpWebCapabilitySummary {
  readonly id: string
  readonly kind: string
  readonly version: string
  readonly title: string
  readonly trust: string
  readonly scopes: readonly string[]
  readonly permissions: readonly string[]
  readonly executable: boolean
}
/** Active capability authorization adapter metadata. */
export interface RpWebCapabilityAuthorizerSummary {
  readonly id: string
  readonly priority: number
}
/** Active deployment/product policy ceiling metadata. */
export interface RpWebPolicyLayerSummary {
  readonly name: string
  readonly permissions?: readonly string[]
  readonly maxTrust?: string
  readonly budget?: RpBudget
  readonly networkDomains?: readonly string[]
  readonly fileRoots?: readonly string[]
}
/** Compiled pipeline metadata exposed by the Studio catalog. */
export interface RpWebPipelineSummary {
  readonly id: string
  readonly kind: string
  readonly version: string
  readonly description: string
  readonly trust: string
  readonly permissions: readonly string[]
  readonly hash: string
  readonly levels: readonly (readonly string[])[]
}
/** Registered workflow backend metadata. */
export interface RpWebWorkflowBackendSummary {
  readonly id: string
  readonly kind: string
  readonly trust: string
  readonly priority: number
  readonly kinds: readonly string[]
}
/** Registered rules-engine metadata. */
export interface RpWebRuleSystemSummary {
  readonly id: string
  readonly version: string
  readonly title: string
}
/** Registered media Provider metadata. */
export interface RpWebMediaProviderSummary {
  readonly id: string
  readonly version: string
  readonly title: string
  readonly trust: string
  readonly kinds: readonly string[]
  readonly permissions: readonly string[]
}
/** Registered byte-ingress and model-materialization Adapter metadata. */
export interface RpWebMediaInputAdapterSummary {
  readonly id: string
  readonly version: string
  readonly title: string
  readonly trust: string
  readonly permissions: readonly string[]
}
/** Installed RP memory retrieval Provider metadata. */
export interface RpWebMemoryRetrieverSummary {
  readonly id: string
  readonly version: string
  readonly title: string
  readonly priority: number
}
/** Installed durable RP memory store metadata. */
export interface RpWebMemoryStoreSummary {
  readonly id: string
  readonly version: string
  readonly title: string
  readonly priority: number
}
/** Opaque-origin package UI frame exposed by the Host catalog. */
export interface RpWebUiSlotSummary {
  readonly packageId: string
  readonly packageVersion: string
  readonly id: string
  readonly title: string
  readonly placement: RpUiSlotPlacement
  readonly trust: string
  readonly script: 'none' | 'sandbox'
  readonly height: number
  readonly entryUrl: string
}
/** Published Registry release metadata. */
export interface RpWebRegistryReleaseSummary {
  readonly id: string
  readonly version: string
  readonly trust: string
  readonly sourceKind: string
  readonly manifestHash: string
  readonly revoked: boolean
  readonly payloadSha256?: string
  readonly signingKeyId?: string
  readonly signed: boolean
  readonly signingKeyRevoked: boolean
  readonly sbomSha256?: string
  readonly evidenceVerified: boolean
  readonly permissions: readonly string[]
  readonly networkDomains: readonly string[]
  readonly fileRoots: readonly string[]
  readonly sourceLocator: string
  readonly sourceRef?: string
}
/** Exact package state inside one committed installation lock. */
export interface RpWebRegistryInstalledPackageSummary {
  readonly id: string
  readonly version: string
  readonly trust: string
  readonly manifestHash: string
  readonly evidenceVerified: boolean
  readonly revoked: boolean
  readonly runtimeActive: boolean
  readonly owners: readonly string[]
  readonly lifecycleAdapterId?: string
  readonly permissions: readonly string[]
  readonly networkDomains: readonly string[]
  readonly fileRoots: readonly string[]
  readonly payloadSha256?: string
  readonly signingKeyId?: string
  readonly signingKeyRevoked: boolean
  readonly sbomSha256?: string
}
/** Committed root installation and its immutable dependency graph. */
export interface RpWebRegistryInstallationSummary {
  readonly rootId: string
  readonly rootVersion: string
  readonly sourceKind: string
  readonly sourceLocator: string
  readonly sourceRef?: string
  readonly graphHash: string
  readonly installedAt: number
  readonly updatedAt: number
  readonly packages: readonly RpWebRegistryInstalledPackageSummary[]
}
/** Registered package runtime activator metadata. */
export interface RpWebRegistryLifecycleAdapterSummary {
  readonly id: string
  readonly priority: number
}
/** Active Registry evidence policy shown in the permission inspector. */
export interface RpWebRegistrySecurityPolicySummary {
  readonly id: string
  readonly appliesTo: readonly string[]
  readonly requirePayloadIntegrity: boolean
  readonly requireSignature: boolean
  readonly requireSbom: boolean
}
/** Registry lifecycle mutation accepted by the Host API. */
export type RpWebRegistryMutationRequest =
  | { readonly action: 'install' | 'update'; readonly source: string }
  | { readonly action: 'uninstall'; readonly rootId: string }
/** Result of one committed Registry lifecycle mutation. */
export interface RpWebRegistryMutationResponse {
  readonly schemaVersion: 1
  readonly action: 'install' | 'update' | 'uninstall'
  readonly rootId: string
  readonly graphHash: string
  readonly installed: boolean
  readonly installation?: RpWebRegistryInstallationSummary
}
/** Aggregate Outbox status counters. */
export interface RpWebOutboxSummary {
  readonly pending: number
  readonly running: number
  readonly completed: number
  readonly failed: number
}
/** Complete detached RP Studio catalog response. */
export interface RpWebCatalog {
  readonly schemaVersion: 1
  readonly generatedAt: number
  readonly experiences: readonly RpExperienceManifest[]
  readonly components: readonly RpWebComponentSummary[]
  readonly capabilities: readonly RpWebCapabilitySummary[]
  readonly capabilityAuthorizers: readonly RpWebCapabilityAuthorizerSummary[]
  readonly policyLayers: readonly RpWebPolicyLayerSummary[]
  readonly pipelines: readonly RpWebPipelineSummary[]
  readonly workflowBackends: readonly RpWebWorkflowBackendSummary[]
  readonly ruleSystems: readonly RpWebRuleSystemSummary[]
  readonly mediaProviders: readonly RpWebMediaProviderSummary[]
  readonly mediaInputAdapters: readonly RpWebMediaInputAdapterSummary[]
  readonly memoryRetrievers: readonly RpWebMemoryRetrieverSummary[]
  readonly memoryStores: readonly RpWebMemoryStoreSummary[]
  readonly uiSlots: readonly RpWebUiSlotSummary[]
  readonly registryReleases: readonly RpWebRegistryReleaseSummary[]
  readonly registryInstallations: readonly RpWebRegistryInstallationSummary[]
  readonly registryLifecycleAdapters: readonly RpWebRegistryLifecycleAdapterSummary[]
  readonly registrySourceProviders: readonly string[]
  readonly registrySecurityPolicies: readonly RpWebRegistrySecurityPolicySummary[]
  readonly registryInstallationStore?: { readonly id: string }
  readonly registryArtifactStore?: { readonly id: string }
  readonly outbox: RpWebOutboxSummary
}
/** Import formats accepted by Creator Studio. */
export type RpWebImportKind =
  | 'character-card-json'
  | 'character-card-png'
  | 'character-card-charx'
  | 'persona'
  | 'world-info'
  | 'preset'
  | 'chat'
/** Creator Studio import request. */
export interface RpWebImportRequest {
  readonly kind: RpWebImportKind
  readonly source?: string
  readonly base64?: string
  readonly sourceId?: string
}
/** Creator Studio import result. */
export interface RpWebImportResponse {
  readonly kind: RpWebImportKind
  readonly result: JsonValue
  readonly lossReports: readonly {
    readonly path: string
    readonly report: CompatibilityLossReport
  }[]
}

/** Creator formats that can be persisted in the durable RP asset library. */
export type RpWebLibraryImportKind =
  | 'character-card-json'
  | 'character-card-png'
  | 'character-card-charx'
  | 'persona'
  | 'world-info'

/** Saved Character summary exposed by Creator Studio. */
export interface RpWebLibraryCharacterSummary {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly savedAt: number
}

/** Saved Persona summary exposed by Creator Studio. */
export interface RpWebLibraryPersonaSummary {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly savedAt: number
}

/** Saved Lorebook summary exposed by Creator Studio. */
export interface RpWebLibraryLoreSummary {
  readonly id: string
  readonly name: string
  readonly entryCount: number
  readonly savedAt: number
}

/** Durable asset catalog and current conversation selections. */
export interface RpWebLibraryCatalogResponse {
  readonly schemaVersion: 1
  readonly sessionId?: string
  readonly characters: readonly RpWebLibraryCharacterSummary[]
  readonly personas: readonly RpWebLibraryPersonaSummary[]
  readonly lorebooks: readonly RpWebLibraryLoreSummary[]
  readonly active?: {
    readonly snapshotHash: string
    readonly characterIds: readonly string[]
    readonly personaIds: readonly string[]
    readonly lorebookIds: readonly string[]
  }
}

/** Full normalized library asset loaded only when the user opens an editor. */
export interface RpWebLibraryAssetDetailResponse {
  readonly schemaVersion: 1
  readonly assetKind: 'character' | 'persona' | 'lore'
  readonly asset: CharacterIR | PersonaIR | LoreIR
  readonly savedAt: number
}

/** Creator Studio mutation accepted by the durable asset library. */
export type RpWebLibraryMutationRequest =
  | {
    readonly action: 'save'
    readonly kind: RpWebLibraryImportKind
    readonly source?: string
    readonly base64?: string
    readonly sourceId?: string
  }
  | {
    readonly action: 'update'
    readonly sessionId: string
    readonly assetKind: 'character' | 'persona' | 'lore'
    readonly assetId: string
    readonly asset: CharacterIR | PersonaIR | LoreIR
  }
  | {
    readonly action: 'activate' | 'deactivate'
    readonly sessionId: string
    readonly assetKind: 'character' | 'persona' | 'lore'
    readonly assetId: string
  }
  | {
    readonly action: 'remove'
    readonly assetKind: 'character' | 'persona' | 'lore'
    readonly assetId: string
  }

/** Completed asset-library mutation plus refreshed catalog projection. */
export interface RpWebLibraryMutationResponse extends RpWebLibraryCatalogResponse {
  readonly action: RpWebLibraryMutationRequest['action']
  readonly assetIds: readonly string[]
}

/** Saved prompt preset summary exposed to Creator Studio. */
export interface RpWebPresetSummary {
  readonly id: string
  readonly name: string
  readonly selectedPromptOrderId: string
  readonly promptDefinitionCount: number
  readonly promptOrderCount: number
  readonly enabledPromptIds: readonly string[]
  readonly generation: JsonObject
  readonly savedAt: number
}

/** Complete adapter-neutral preset document safe for Host and browser editors. */
export interface RpWebPresetDocument {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly promptDefinitions: readonly {
    readonly schemaVersion: 1
    readonly id: string
    readonly name: string
    readonly role: 'system' | 'user' | 'assistant'
    readonly content: string
    readonly marker: boolean
  }[]
  readonly promptOrders: readonly {
    readonly id: string
    readonly entries: readonly { readonly identifier: string; readonly enabled: boolean }[]
  }[]
  readonly selectedPromptOrderId: string
  readonly prompts: readonly PromptSectionIR[]
  readonly generation: JsonObject
  readonly compatibility?: CompatibilityEnvelope
  readonly savedAt: number
}

/** Durable preset catalog and current conversation binding. */
export interface RpWebPresetCatalogResponse {
  readonly schemaVersion: 1
  readonly sessionId?: string
  readonly presets: readonly RpWebPresetSummary[]
  readonly active?: {
    readonly presetId: string
    readonly snapshotHash: string
    readonly selectedPromptOrderId: string
    readonly enabledPromptIds: readonly string[]
  }
}

/** Full normalized preset loaded only when the user opens its editor. */
export interface RpWebPresetDetailResponse {
  readonly schemaVersion: 1
  readonly preset: RpWebPresetDocument
}

/** Creator Studio mutation accepted by the durable preset plugin. */
export type RpWebPresetMutationRequest =
  | { readonly action: 'save'; readonly source: string; readonly sourceId?: string }
  | {
    readonly action: 'update'
    readonly sessionId: string
    readonly presetId: string
    readonly preset: RpWebPresetDocument
  }
  | { readonly action: 'activate'; readonly sessionId: string; readonly presetId: string }
  | { readonly action: 'deactivate'; readonly sessionId: string }
  | { readonly action: 'remove'; readonly presetId: string }

/** Completed preset mutation plus refreshed catalog projection. */
export interface RpWebPresetMutationResponse extends RpWebPresetCatalogResponse {
  readonly action: RpWebPresetMutationRequest['action']
  readonly presetId?: string
}

/** Timeline lookup for one live Harness session. */
export interface RpWebTimelineRequest { readonly sessionId: string }
/** One RP-owned Session Event exposed to the debugger. */
export interface RpWebTimelineEvent {
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: JsonValue
}
/** Replay-backed RP debugger response. */
export interface RpWebTimelineResponse {
  readonly sessionId: string
  readonly events: readonly RpWebTimelineEvent[]
  readonly projection: JsonValue
}

/** Idempotent, authority-free request accepted by the shared Headless/Web Turn API. */
export interface RpWebMediaInput {
  readonly schemaVersion: 1
  readonly kind: 'image'
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Canonical padded Base64 accepted only at the bounded HTTP ingress. */
  readonly data: string
  readonly name?: string
  /** Optional exact input Adapter route. */
  readonly adapter?: string
}

/** Idempotent, authority-free request accepted by the shared Headless/Web Turn API. */
export interface RpWebTurnRequest {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly sessionId: string
  readonly agentId: string
  readonly experienceId?: string
  readonly scope?: JsonValue
  readonly input: JsonValue
  readonly media?: readonly RpWebMediaInput[]
  readonly context?: { readonly [key: string]: JsonValue }
}

/** Durable result of one new or idempotently replayed RP Turn commit. */
export interface RpWebTurnResponse {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly replayed: boolean
  readonly sessionId: string
  readonly agentId: string
  readonly experienceId: string
  readonly turnId: string
  readonly eventSeq: number
  readonly assistantMessage: string
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly costUsd?: number
    readonly durationMs?: number
  }
  readonly authority: {
    readonly permissions: readonly string[]
    readonly trust: RpTrustLevel
    readonly budget: RpBudget
    readonly layers: readonly string[]
  }
  readonly projection: JsonValue
}

/** Sanitized HTTP failure returned by the shared Headless/Web Turn API. */
export interface RpWebTurnErrorResponse {
  readonly error: {
    readonly code: string
    readonly message: string
    /** Only an identical request with the same requestId may retry an uncertain durability barrier. */
    readonly retryWithSameRequestId?: boolean
  }
}
