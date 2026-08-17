/** Shared package lifecycle preparation and reversible publication. @module @dsh-rp/lifecycle-common */
import type { Context } from '@deepseek-ai/cordis'
import type {
  RpCapabilityContribution,
  RpCapabilityDescriptor,
  RpResolvedCapabilityInvocation,
} from '@dsh-rp/capability-catalog'
import type { RpComponentDefinition } from '@dsh-rp/component-runtime'
import type { JsonValue, RpTrustLevel } from '@dsh-rp/contracts'
import { RpPipelineId } from '@dsh-rp/contracts'
import {
  parseRpRuntimeArchive,
  type RpRuntimeArchive,
  type RpRuntimeArchiveLimits,
  type RpRuntimeCapabilitySpec,
} from '@dsh-rp/package-runtime'
import type { RpPipelineDefinition } from '@dsh-rp/pipeline-runtime'
import '@dsh-rp/pipeline-runtime'
import type { RpUiSlotContribution } from '@dsh-rp/ui-slot-runtime'
import '@dsh-rp/ui-slot-runtime'
import type { RpPackageLifecycleRequest } from '@dsh-rp/registry'

/** Evidence level required before executable content reaches an adapter. */
export type RpRuntimeEvidenceLevel = 'integrity' | 'signed-sbom'

/** A fully checked graph which has not yet published runtime registrations. */
export interface RpPreparedRuntimeGraph {
  readonly archive: RpRuntimeArchive
  readonly components: readonly RpComponentDefinition[]
  readonly capabilities: readonly RpCapabilityDescriptor[]
  readonly pipelines: readonly RpPipelineDefinition[]
  readonly uiSlots: readonly RpUiSlotContribution[]
}

/** Adapter-owned invocation bridge factory. */
export type RpRuntimeInvocationFactory = (
  spec: RpRuntimeCapabilitySpec,
  archive: RpRuntimeArchive,
) => ((request: RpResolvedCapabilityInvocation) => Promise<JsonValue>) | undefined

/** Stable lifecycle boundary failure. */
export class RpRuntimeLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: 'EVIDENCE' | 'TRUST' | 'PERMISSION' | 'ACTIVATION',
  ) {
    super(message)
    this.name = 'RpRuntimeLifecycleError'
  }
}

/**
 * Validate package evidence, descriptor declarations, permission ownership, and immutable registration metadata.
 * @param request - Registry-verified lifecycle request.
 * @param limits - Deployment-owned extraction limits.
 * @param trust - Exact trust handled by the calling adapter.
 * @param evidence - Minimum Registry proof required by the adapter.
 * @param executablePermission - Permission every executable capability must explicitly request.
 * @returns Side-effect-free prepared graph.
 */
export async function prepareRpRuntimeGraph(
  request: RpPackageLifecycleRequest,
  limits: RpRuntimeArchiveLimits,
  trust: RpTrustLevel,
  evidence: RpRuntimeEvidenceLevel,
  executablePermission?: string,
): Promise<RpPreparedRuntimeGraph> {
  const { manifest } = request.release
  if (manifest.trust !== trust) {
    throw new RpRuntimeLifecycleError(`Adapter ${trust} cannot prepare package trust ${manifest.trust}`, 'TRUST')
  }
  assertEvidence(request, evidence)
  const archive = await parseRpRuntimeArchive(request.payload as Uint8Array, manifest, limits)
  const manifestPermissions = new Set(manifest.permissions ?? [])
  for (const capability of archive.descriptor.capabilities) {
    for (const permission of capability.permissions ?? []) {
      if (!manifestPermissions.has(permission)) {
        throw new RpRuntimeLifecycleError(
          `Capability ${String(capability.id)} requests undeclared Manifest permission ${JSON.stringify(permission)}`,
          'PERMISSION',
        )
      }
    }
    if (capability.implementation !== undefined && executablePermission !== undefined) {
      if (!manifestPermissions.has(executablePermission) || !capability.permissions?.includes(executablePermission)) {
        throw new RpRuntimeLifecycleError(
          `Executable capability ${String(capability.id)} must declare ${executablePermission} in both Manifest and descriptor`,
          'PERMISSION',
        )
      }
    }
  }
  const components = Object.freeze(archive.descriptor.components.map(component => Object.freeze({
    id: component.id,
    packageId: manifest.id,
    version: manifest.version,
    trust: manifest.trust,
    scopes: Object.freeze([...component.scopes]),
    ...(component.dependencies === undefined ? {} : {
      dependencies: Object.freeze(component.dependencies.map(dependency => Object.freeze({ ...dependency }))),
    }),
    ...(component.provides === undefined ? {} : { provides: Object.freeze([...component.provides]) }),
    ...(component.requires === undefined ? {} : { requires: Object.freeze([...component.requires]) }),
  })))
  const capabilities = Object.freeze(archive.descriptor.capabilities.map(capability => Object.freeze({
    id: capability.id,
    kind: capability.kind,
    version: manifest.version,
    title: capability.title,
    description: capability.description,
    trust: manifest.trust,
    scopes: Object.freeze([...capability.scopes]),
    ...(capability.permissions === undefined ? {} : { permissions: Object.freeze([...capability.permissions]) }),
    ...(capability.budget === undefined ? {} : { budget: Object.freeze({ ...capability.budget }) }),
    ...(capability.inputSchema === undefined ? {} : { inputSchema: capability.inputSchema }),
    ...(capability.outputSchema === undefined ? {} : { outputSchema: capability.outputSchema }),
    ...(capability.tags === undefined ? {} : { tags: Object.freeze([...capability.tags]) }),
  } satisfies RpCapabilityDescriptor)))
  const byCapabilityId = new Map(capabilities.map(capability => [String(capability.id), capability]))
  const pipelines = Object.freeze((archive.descriptor.pipelines ?? []).map((pipeline) => {
    const capability = byCapabilityId.get(String(pipeline.id))
    if (capability === undefined || capability.kind !== 'pipeline') {
      throw new RpRuntimeLifecycleError(
        `Pipeline ${String(pipeline.id)} has no matching Pipeline capability`,
        'ACTIVATION',
      )
    }
    return Object.freeze({
      id: pipeline.id,
      kind: pipeline.kind,
      version: manifest.version,
      description: pipeline.description,
      trust: manifest.trust,
      permissions: capability.permissions ?? Object.freeze([]),
      stages: pipeline.stages,
      ...(pipeline.budget === undefined ? {} : { budget: pipeline.budget }),
    } satisfies RpPipelineDefinition)
  }))
  const uiSlots = Object.freeze((archive.descriptor.uiSlots ?? []).map(slot => Object.freeze({
    definition: Object.freeze({
      ...slot,
      packageId: manifest.id,
      packageVersion: manifest.version,
      trust: manifest.trust,
    }),
    resources: Object.freeze(slot.assets.map(path => Object.freeze({ path, bytes: archive.bytes(path) }))),
  } satisfies RpUiSlotContribution)))
  return Object.freeze({ archive, components, capabilities, pipelines, uiSlots })
}

/**
 * Publish one prepared graph and return an idempotent best-effort reverse-order disposer.
 * @param ctx - Runtime registries owning the published entries.
 * @param graph - Prepared immutable package graph.
 * @param invocationFactory - Trust-specific execution bridge factory.
 * @returns Total disposer suitable for Registry transaction ownership.
 */
export function activateRpRuntimeGraph(
  ctx: Context,
  graph: RpPreparedRuntimeGraph,
  invocationFactory: RpRuntimeInvocationFactory,
): () => void {
  const disposers: Array<() => void> = []
  try {
    for (const component of graph.components) disposers.push(ctx.rpComponents.register(component))
    for (const pipeline of graph.pipelines) disposers.push(ctx.rpPipelines.register(pipeline))
    for (const slot of graph.uiSlots) disposers.push(ctx.rpUiSlots.register(slot))
    graph.archive.descriptor.capabilities.forEach((spec, index) => {
      const descriptor = graph.capabilities[index]
      if (descriptor === undefined) throw new RpRuntimeLifecycleError('Prepared capability graph changed shape', 'ACTIVATION')
      const invoke = spec.kind === 'pipeline'
        ? async (invocation: RpResolvedCapabilityInvocation): Promise<JsonValue> => {
          const result = await ctx.rpPipelines.run(RpPipelineId(String(spec.id)), {
            scope: invocation.scope,
            input: invocation.input,
            grantedPermissions: invocation.effectiveAuthority.permissions,
            grantedTrust: invocation.effectiveAuthority.trust,
            budget: invocation.effectiveBudget,
            networkDomains: invocation.effectiveAuthority.networkDomains,
            fileRoots: invocation.effectiveAuthority.fileRoots,
            ...(invocation.policyLayers === undefined ? {} : { policyLayers: invocation.policyLayers }),
            ...(invocation.signal === undefined ? {} : { signal: invocation.signal }),
          })
          return structuredClone(result.frame.values)
        }
        : invocationFactory(spec, graph.archive)
      const contribution: RpCapabilityContribution = Object.freeze({
        descriptor,
        ...(invoke === undefined ? {} : { invoke }),
      })
      disposers.push(ctx.rpCapabilities.register(contribution))
    })
  } catch (error) {
    releaseAll(disposers)
    throw error
  }
  let active = true
  return () => {
    if (!active) return
    active = false
    releaseAll(disposers)
  }
}

function assertEvidence(request: RpPackageLifecycleRequest, level: RpRuntimeEvidenceLevel): void {
  const { manifest } = request.release
  const sha256 = manifest.integrity?.sha256
  if (request.payload === undefined || sha256 === undefined
    || request.entry.payloadSha256 !== sha256 || !request.entry.evidenceVerified) {
    throw new RpRuntimeLifecycleError('Executable RP package requires Registry-verified payload SHA-256 evidence', 'EVIDENCE')
  }
  if (level === 'signed-sbom') {
    const keyId = manifest.integrity?.keyId
    const signature = manifest.integrity?.signature
    const sbom = manifest.integrity?.sbom
    if (keyId === undefined || signature === undefined || sbom === undefined || request.sbom === undefined
      || request.entry.signingKeyId !== keyId || request.entry.sbomSha256 !== sbom) {
      throw new RpRuntimeLifecycleError(
        'Native RP package requires trusted signature and hash-bound SBOM evidence',
        'EVIDENCE',
      )
    }
  }
}

function releaseAll(disposers: readonly (() => void)[]): void {
  for (const dispose of [...disposers].reverse()) {
    try { dispose() } catch { /* total lifecycle cleanup must continue */ }
  }
}
