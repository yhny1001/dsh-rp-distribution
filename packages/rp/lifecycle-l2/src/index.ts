/** Explicit trusted-native L2 RP package lifecycle adapter. @module @dsh-rp/lifecycle-l2 */
import { Buffer } from 'node:buffer'
import { Script } from 'node:vm'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { JsonValue } from '@dsh-rp/contracts'
import type { RpResolvedCapabilityInvocation } from '@dsh-rp/capability-catalog'
import type {
  RpPackageLifecycleAdapter,
  RpPackageLifecycleRequest,
  RpRegistryRelease,
} from '@dsh-rp/registry'
import { RP_RUNTIME_V1 } from '@dsh-rp/package-runtime'
import { activateRpRuntimeGraph, prepareRpRuntimeGraph } from '@dsh-rp/lifecycle-common'

/** Permission required by every trusted native capability. */
export const L2_EXECUTION_PERMISSION = 'native.execute'
const DEFAULT_MAX_UNPACKED_BYTES = 128 * 1024 * 1024
const DEFAULT_MAX_FILES = 512
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_SOURCE_BYTES = 256 * 1024
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 2_000
const DEFAULT_MAX_TIMEOUT_MS = 10_000

/** Deployment limits for explicitly trusted native code. */
export interface Config {
  /** Maximum decompressed bytes accepted from one package archive. */
  maxUnpackedBytes?: number
  /** Maximum regular files accepted from one package archive. */
  maxFiles?: number
  /** Maximum decompressed bytes accepted from one regular file. */
  maxFileBytes?: number
  /** Maximum UTF-8 bytes accepted from one native implementation source. */
  maxSourceBytes?: number
  /** Maximum serialized JSON bytes returned from one invocation. */
  maxOutputBytes?: number
  /** Timeout used when neither capability nor caller supplies one. */
  defaultTimeoutMs?: number
  /** Deployment ceiling applied to every asynchronous native invocation. */
  maxTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  maxUnpackedBytes: z.number().step(1).min(1).max(512 * 1024 * 1024).default(DEFAULT_MAX_UNPACKED_BYTES),
  maxFiles: z.number().step(1).min(1).max(10_000).default(DEFAULT_MAX_FILES),
  maxFileBytes: z.number().step(1).min(1).max(128 * 1024 * 1024).default(DEFAULT_MAX_FILE_BYTES),
  maxSourceBytes: z.number().step(1).min(1).max(4 * 1024 * 1024).default(DEFAULT_MAX_SOURCE_BYTES),
  maxOutputBytes: z.number().step(1).min(1).max(64 * 1024 * 1024).default(DEFAULT_MAX_OUTPUT_BYTES),
  defaultTimeoutMs: z.number().step(1).min(1).max(60_000).default(DEFAULT_TIMEOUT_MS),
  maxTimeoutMs: z.number().step(1).min(1).max(60_000).default(DEFAULT_MAX_TIMEOUT_MS),
})

/** Native module validation or execution failure. */
export class RpL2LifecycleError extends Error {
  constructor(message: string, readonly code: 'SOURCE' | 'EXECUTION' | 'OUTPUT' | 'TIMEOUT' | 'CANCELLED') {
    super(message)
    this.name = 'RpL2LifecycleError'
  }
}

type NativeCapability = (
  input: JsonValue,
  authority: NativeAuthority,
  signal: AbortSignal,
) => unknown

interface NativeAuthority {
  readonly permissions: readonly string[]
  readonly trust: 'L2'
  readonly budget: Readonly<Record<string, number>>
  readonly networkDomains: readonly string[]
  readonly fileRoots: readonly string[]
  readonly layers: readonly string[]
}

/**
 * Create the explicit trusted-native lifecycle adapter.
 * @param ctx - Component and Capability registries.
 * @param config - Source, output, archive, and timeout bounds.
 * @returns Registry lifecycle adapter requiring signed SBOM evidence.
 */
export function createL2LifecycleAdapter(ctx: Context, config: Config = {}): RpPackageLifecycleAdapter {
  const resolved = resolveConfig(config)
  return Object.freeze({
    id: 'rp-runtime-l2-v1',
    priority: 100,
    supports: (release: RpRegistryRelease) => release.manifest.trust === 'L2'
      && release.manifest.compatibility?.runtime === RP_RUNTIME_V1,
    async prepare(request: RpPackageLifecycleRequest) {
      const graph = await prepareRpRuntimeGraph(
        request,
        resolved,
        'L2',
        'signed-sbom',
        L2_EXECUTION_PERMISSION,
      )
      const factories = new Map<string, () => unknown>()
      for (const capability of graph.archive.descriptor.capabilities) {
        const implementation = capability.implementation
        if (implementation?.kind !== 'native') continue
        const source = graph.archive.text(implementation.path)
        if (Buffer.byteLength(source) > resolved.maxSourceBytes) {
          throw new RpL2LifecycleError(
            `Native source ${implementation.path} exceeds ${resolved.maxSourceBytes} bytes`,
            'SOURCE',
          )
        }
        factories.set(String(capability.id), compileFactory(source, implementation.path))
      }
      return Object.freeze({
        activate: () => {
          const deactivate = activateRpRuntimeGraph(ctx, graph, (spec) => {
            if (spec.implementation?.kind !== 'native') return undefined
            const factory = factories.get(String(spec.id))
            if (factory === undefined) throw new RpL2LifecycleError('Prepared native factory disappeared', 'SOURCE')
            return invocation => executeNative(factory, invocation, resolved)
          })
          let active = true
          return () => {
            if (!active) return
            active = false
            deactivate()
            factories.clear()
          }
        },
        dispose() { factories.clear() },
      })
    },
  })
}

function compileFactory(source: string, path: string): () => unknown {
  try {
    const script = new Script(`"use strict"; (\n${source}\n)`, { filename: path })
    return (): unknown => {
      const value: unknown = script.runInThisContext()
      return value
    }
  } catch (error: unknown) {
    throw new RpL2LifecycleError(`Native source ${path} cannot compile: ${renderError(error)}`, 'SOURCE')
  }
}

async function executeNative(
  factory: () => unknown,
  invocation: RpResolvedCapabilityInvocation,
  config: Required<Config>,
): Promise<JsonValue> {
  const controller = new AbortController()
  const forwardAbort = (): void => { controller.abort(invocation.signal?.reason) }
  if (invocation.signal?.aborted === true) controller.abort(invocation.signal.reason)
  else invocation.signal?.addEventListener('abort', forwardAbort, { once: true })
  const requested = invocation.effectiveBudget.timeoutMs ?? config.defaultTimeoutMs
  const timeoutMs = Math.min(requested, config.maxTimeoutMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const operation = Promise.resolve().then(async () => {
      if (controller.signal.aborted) throw cancelled(controller.signal)
      const candidate = factory()
      if (typeof candidate !== 'function') {
        throw new RpL2LifecycleError('Native source must evaluate to one capability function', 'SOURCE')
      }
      const value = await (candidate as NativeCapability)(
        structuredClone(invocation.input),
        nativeAuthority(invocation),
        controller.signal,
      )
      return jsonResult(value, config.maxOutputBytes)
    })
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort('timeout')
        reject(new RpL2LifecycleError(`Native capability timed out after ${timeoutMs}ms`, 'TIMEOUT'))
      }, timeoutMs)
    })
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => {
        if (controller.signal.reason !== 'timeout') reject(cancelled(controller.signal))
      }, { once: true })
    })
    return await Promise.race([operation, timeout, aborted])
  } catch (error: unknown) {
    if (error instanceof RpL2LifecycleError) throw error
    throw new RpL2LifecycleError(renderError(error), 'EXECUTION')
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    invocation.signal?.removeEventListener('abort', forwardAbort)
  }
}

function nativeAuthority(invocation: RpResolvedCapabilityInvocation): NativeAuthority {
  const authority = invocation.effectiveAuthority
  return Object.freeze({
    permissions: Object.freeze([...authority.permissions]),
    trust: 'L2',
    budget: Object.freeze({ ...authority.budget }),
    networkDomains: Object.freeze([...authority.networkDomains]),
    fileRoots: Object.freeze([...authority.fileRoots]),
    layers: Object.freeze([...authority.layers]),
  })
}

function jsonResult(value: unknown, maxBytes: number): JsonValue {
  let serialized: unknown
  try { serialized = JSON.stringify(value) }
  catch (error: unknown) { throw new RpL2LifecycleError(`Native result is not JSON: ${renderError(error)}`, 'OUTPUT') }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > maxBytes) {
    throw new RpL2LifecycleError(`Native result must be JSON within ${maxBytes} bytes`, 'OUTPUT')
  }
  return JSON.parse(serialized) as JsonValue
}

function cancelled(signal: AbortSignal): RpL2LifecycleError {
  return new RpL2LifecycleError(`Native capability cancelled: ${renderError(signal.reason)}`, 'CANCELLED')
}

function resolveConfig(config: Config): Required<Config> {
  const resolved = {
    maxUnpackedBytes: config.maxUnpackedBytes ?? DEFAULT_MAX_UNPACKED_BYTES,
    maxFiles: config.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxSourceBytes: config.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxTimeoutMs: config.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS,
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`lifecycle-l2 ${key} must be a positive safe integer`)
    }
  }
  if (resolved.maxFileBytes > resolved.maxUnpackedBytes) {
    throw new Error('lifecycle-l2 maxFileBytes cannot exceed maxUnpackedBytes')
  }
  if (resolved.defaultTimeoutMs > resolved.maxTimeoutMs) {
    throw new Error('lifecycle-l2 defaultTimeoutMs cannot exceed maxTimeoutMs')
  }
  return Object.freeze(resolved)
}

function renderError(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error) }
  catch { return '[unrenderable native error]' }
}

export const name = 'rp-lifecycle-l2'
export const inject = ['rpRegistry', 'rpComponents', 'rpCapabilities', 'rpPipelines', 'rpUiSlots']

/** Register the L2 adapter as a reversible Cordis Effect. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.rpRegistry.registerLifecycleAdapter(createL2LifecycleAdapter(ctx, config)))
}
