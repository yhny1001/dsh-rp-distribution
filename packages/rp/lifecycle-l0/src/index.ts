/** Declarative L0 RP package lifecycle adapter. @module @dsh-rp/lifecycle-l0 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  RpPackageLifecycleAdapter,
  RpPackageLifecycleRequest,
  RpRegistryRelease,
} from '@dsh-rp/registry'
import { RP_RUNTIME_V1 } from '@dsh-rp/package-runtime'
import { activateRpRuntimeGraph, prepareRpRuntimeGraph } from '@dsh-rp/lifecycle-common'
import '@dsh-rp/workflow-router'

const DEFAULT_MAX_UNPACKED_BYTES = 128 * 1024 * 1024
const DEFAULT_MAX_FILES = 512
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024

/** Deployment extraction limits for declarative packages. */
export interface Config {
  /** Maximum decompressed bytes accepted from one package archive. */
  maxUnpackedBytes?: number
  /** Maximum regular files accepted from one package archive. */
  maxFiles?: number
  /** Maximum decompressed bytes accepted from one regular file. */
  maxFileBytes?: number
}

export const Config: z<Config> = z.object({
  maxUnpackedBytes: z.number().step(1).min(1).max(512 * 1024 * 1024).default(DEFAULT_MAX_UNPACKED_BYTES),
  maxFiles: z.number().step(1).min(1).max(10_000).default(DEFAULT_MAX_FILES),
  maxFileBytes: z.number().step(1).min(1).max(128 * 1024 * 1024).default(DEFAULT_MAX_FILE_BYTES),
})

/**
 * Create an independently replaceable L0 lifecycle adapter.
 * @param ctx - Registries and deterministic workflow router.
 * @param config - Archive ceilings.
 * @returns Registry lifecycle adapter.
 */
export function createL0LifecycleAdapter(ctx: Context, config: Config = {}): RpPackageLifecycleAdapter {
  const limits = resolveLimits(config)
  return Object.freeze({
    id: 'rp-runtime-l0-v1',
    priority: 100,
    supports: (release: RpRegistryRelease) => release.manifest.trust === 'L0'
      && release.manifest.compatibility?.runtime === RP_RUNTIME_V1,
    async prepare(request: RpPackageLifecycleRequest) {
      const graph = await prepareRpRuntimeGraph(request, limits, 'L0', 'integrity')
      return Object.freeze({
        activate: () => activateRpRuntimeGraph(ctx, graph, (spec) => {
          if (spec.implementation?.kind !== 'expression') return undefined
          const expression = spec.implementation.expression
          return async (invocation) => {
            const run = ctx.rpWorkflowRouter.start({
              kind: 'workflow',
              payload: { expression, input: invocation.input },
              requiredBackendKind: 'deterministic',
              requiredTrust: 'L0',
              authority: invocation.effectiveAuthority,
              budget: invocation.effectiveBudget,
              ...(invocation.signal === undefined ? {} : { signal: invocation.signal }),
            })
            const outcome = await run.result
            if (outcome.status !== 'completed') throw new Error(outcome.error ?? `L0 workflow ${outcome.status}`)
            return outcome.value ?? null
          }
        }),
        dispose() {},
      })
    },
  })
}

function resolveLimits(config: Config) {
  const limits = {
    maxUnpackedBytes: config.maxUnpackedBytes ?? DEFAULT_MAX_UNPACKED_BYTES,
    maxFiles: config.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  }
  if (limits.maxFileBytes > limits.maxUnpackedBytes) {
    throw new Error('lifecycle-l0 maxFileBytes cannot exceed maxUnpackedBytes')
  }
  return Object.freeze(limits)
}

export const name = 'rp-lifecycle-l0'
export const inject = ['rpRegistry', 'rpComponents', 'rpCapabilities', 'rpPipelines', 'rpUiSlots', 'rpWorkflowRouter']

/** Register the L0 adapter as a reversible Cordis Effect. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.rpRegistry.registerLifecycleAdapter(createL0LifecycleAdapter(ctx, config)))
}
