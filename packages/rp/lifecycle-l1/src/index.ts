/** Sandbox-routed L1 RP package lifecycle adapter. @module @dsh-rp/lifecycle-l1 */
import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { JsonValue } from '@dsh-rp/contracts'
import type {
  RpPackageLifecycleAdapter,
  RpPackageLifecycleRequest,
  RpRegistryRelease,
} from '@dsh-rp/registry'
import { RP_RUNTIME_V1 } from '@dsh-rp/package-runtime'
import { activateRpRuntimeGraph, prepareRpRuntimeGraph } from '@dsh-rp/lifecycle-common'
import type { RpWorkflowOutcome } from '@dsh-rp/workflow-router'
import '@dsh-rp/workflow-router'

/** Permission required by every L1 executable capability. */
export const L1_EXECUTION_PERMISSION = 'script.execute'
const DEFAULT_MAX_UNPACKED_BYTES = 128 * 1024 * 1024
const DEFAULT_MAX_FILES = 512
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024

/** Deployment extraction and backend-selection policy. */
export interface Config {
  /** Maximum decompressed bytes accepted from one package archive. */
  maxUnpackedBytes?: number
  /** Maximum regular files accepted from one package archive. */
  maxFiles?: number
  /** Maximum decompressed bytes accepted from one regular file. */
  maxFileBytes?: number
  /** Optional exact QuickJS backend id selected through the Workflow Router. */
  quickJsBackend?: string
  /** Optional exact WebAssembly backend id selected through the Workflow Router. */
  wasmBackend?: string
}

export const Config: z<Config> = z.object({
  maxUnpackedBytes: z.number().step(1).min(1).max(512 * 1024 * 1024).default(DEFAULT_MAX_UNPACKED_BYTES),
  maxFiles: z.number().step(1).min(1).max(10_000).default(DEFAULT_MAX_FILES),
  maxFileBytes: z.number().step(1).min(1).max(128 * 1024 * 1024).default(DEFAULT_MAX_FILE_BYTES),
  quickJsBackend: z.string(),
  wasmBackend: z.string(),
})

/** L1 invocation input validation or sandbox outcome failure. */
export class RpL1LifecycleError extends Error {
  constructor(message: string, readonly code: 'INPUT' | 'EXECUTION') {
    super(message)
    this.name = 'RpL1LifecycleError'
  }
}

/**
 * Create an independently replaceable L1 lifecycle adapter.
 * @param ctx - Runtime registries and workflow router.
 * @param config - Archive ceilings and optional exact backend ids.
 * @returns Registry lifecycle adapter.
 */
export function createL1LifecycleAdapter(ctx: Context, config: Config = {}): RpPackageLifecycleAdapter {
  const limits = resolveLimits(config)
  for (const [key, value] of [['quickJsBackend', config.quickJsBackend], ['wasmBackend', config.wasmBackend]] as const) {
    if (value !== undefined && (value.trim() === '' || value !== value.trim())) {
      throw new Error(`lifecycle-l1 ${key} must be a normalized non-empty id`)
    }
  }
  return Object.freeze({
    id: 'rp-runtime-l1-v1',
    priority: 100,
    supports: (release: RpRegistryRelease) => release.manifest.trust === 'L1'
      && release.manifest.compatibility?.runtime === RP_RUNTIME_V1,
    async prepare(request: RpPackageLifecycleRequest) {
      const graph = await prepareRpRuntimeGraph(
        request, limits, 'L1', 'integrity', L1_EXECUTION_PERMISSION,
      )
      return Object.freeze({
        activate: () => activateRpRuntimeGraph(ctx, graph, (spec, archive) => {
          const implementation = spec.implementation
          if (implementation?.kind === 'quickjs') {
            const source = archive.text(implementation.path)
            return async invocation => settle(await ctx.rpWorkflowRouter.start({
              kind: 'workflow',
              payload: { schemaVersion: 1, source, input: invocation.input },
              ...(config.quickJsBackend === undefined ? {} : { backend: config.quickJsBackend }),
              requiredBackendKind: 'quickjs',
              requiredTrust: 'L1',
              authority: invocation.effectiveAuthority,
              budget: invocation.effectiveBudget,
              ...(invocation.signal === undefined ? {} : { signal: invocation.signal }),
            }).result)
          }
          if (implementation?.kind === 'wasm') {
            const moduleBase64 = Buffer.from(archive.bytes(implementation.path)).toString('base64')
            return async invocation => settle(await ctx.rpWorkflowRouter.start({
              kind: 'workflow',
              payload: {
                schemaVersion: 1,
                moduleBase64,
                export: implementation.export,
                args: [...wasmArguments(invocation.input)],
              },
              ...(config.wasmBackend === undefined ? {} : { backend: config.wasmBackend }),
              requiredBackendKind: 'wasm',
              requiredTrust: 'L1',
              authority: invocation.effectiveAuthority,
              budget: invocation.effectiveBudget,
              ...(invocation.signal === undefined ? {} : { signal: invocation.signal }),
            }).result)
          }
          return undefined
        }),
        dispose() {},
      })
    },
  })
}

function wasmArguments(input: JsonValue): readonly number[] {
  const candidate = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.args) ? input.args : undefined
  if (candidate === undefined || candidate.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new RpL1LifecycleError('WebAssembly capability input must be a finite number array or { args }', 'INPUT')
  }
  return Object.freeze([...candidate] as number[])
}

function settle(outcome: RpWorkflowOutcome): JsonValue {
  if (outcome.status !== 'completed') {
    throw new RpL1LifecycleError(outcome.error ?? `Sandbox workflow ${outcome.status}`, 'EXECUTION')
  }
  return outcome.value ?? null
}

function resolveLimits(config: Config) {
  const limits = {
    maxUnpackedBytes: config.maxUnpackedBytes ?? DEFAULT_MAX_UNPACKED_BYTES,
    maxFiles: config.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  }
  if (limits.maxFileBytes > limits.maxUnpackedBytes) {
    throw new Error('lifecycle-l1 maxFileBytes cannot exceed maxUnpackedBytes')
  }
  return Object.freeze(limits)
}

function isRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const name = 'rp-lifecycle-l1'
export const inject = ['rpRegistry', 'rpComponents', 'rpCapabilities', 'rpPipelines', 'rpUiSlots', 'rpWorkflowRouter']

/** Register the L1 adapter as a reversible Cordis Effect. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.rpRegistry.registerLifecycleAdapter(createL1LifecycleAdapter(ctx, config)))
}
