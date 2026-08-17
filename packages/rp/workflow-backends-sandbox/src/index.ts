/** Capability-bounded QuickJS and WebAssembly RP workflow executors. @module @dsh-rp/workflow-backends-sandbox */
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@dsh-rp/contracts'
import type { RpWorkflowBackend, RpWorkflowRequest } from '@dsh-rp/workflow-router'

const SCRIPT_PERMISSION = 'script.execute'
const DEFAULT_TIMEOUT_MS = 2_000
const MAX_TIMEOUT_MS = 10_000
const MAX_SOURCE_BYTES = 256 * 1024
const MAX_INPUT_BYTES = 1024 * 1024
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_WASM_BYTES = 1024 * 1024
const MAX_WASM_MEMORY_PAGES = 256
const MAX_WASM_TABLE_ELEMENTS = 10_000
const MAX_WASM_ARGUMENTS = 64
const MAX_ERROR_CHARACTERS = 16_384

/** Versioned source envelope accepted by the QuickJS backend. */
export interface RpQuickJsWorkflowPayload {
  readonly schemaVersion: 1
  readonly source: string
  readonly input?: JsonValue
}

/** Versioned numeric ABI envelope accepted by the no-import WebAssembly backend. */
export interface RpWasmWorkflowPayload {
  readonly schemaVersion: 1
  readonly moduleBase64: string
  readonly export: string
  readonly args?: readonly number[]
}

/** Security-boundary validation failure. */
export class RpSandboxWorkflowError extends Error {
  constructor(
    message: string,
    readonly code: 'AUTHORITY_REQUIRED' | 'INVALID' | 'LIMIT' | 'EXECUTION' | 'TIMEOUT',
  ) {
    super(message)
    this.name = 'RpSandboxWorkflowError'
  }
}

const WASM_WORKER_SOURCE = String.raw`
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
function fail(message) { throw new Error(message); }
try {
  const bytes = Buffer.from(workerData.moduleBase64, 'base64');
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  if (imports.length !== 0) fail('WebAssembly imports are forbidden');
  const descriptor = WebAssembly.Module.exports(module).find(item => item.name === workerData.exportName);
  if (!descriptor || descriptor.kind !== 'function') fail('requested WebAssembly export is not a function');
  const instance = new WebAssembly.Instance(module, {});
  const entry = instance.exports[workerData.exportName];
  if (typeof entry !== 'function') fail('requested WebAssembly export is unavailable');
  const value = entry(...workerData.args);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('WebAssembly result must be one finite JSON number');
  }
  parentPort.postMessage({ ok: true, value });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: String(error && typeof error === 'object' && 'message' in error ? error.message : error).slice(0, ${MAX_ERROR_CHARACTERS}),
  });
}
`

const QUICKJS_CHILD_SOURCE = String.raw`
'use strict';
let source = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { source += chunk; });
process.stdin.on('end', () => { void main(); });
async function main() {
  let payload;
  let quickJS;
  let runtime;
  let context;
  let handle;
  try {
    payload = JSON.parse(source);
    const [core, variantModule] = await Promise.all([
      import(payload.quickjsCoreUrl),
      import(payload.quickjsVariantUrl),
    ]);
    const variant = variantModule.default ?? variantModule;
    quickJS = await core.newQuickJSWASMModuleFromVariant(variant);
    runtime = quickJS.newRuntime();
    runtime.setMemoryLimit(payload.memoryLimitBytes);
    runtime.setMaxStackSize(payload.maxStackSizeBytes);
    runtime.setInterruptHandler(() => Date.now() > payload.deadline);
    context = runtime.newContext();
    const result = context.evalCode(payload.program, 'rp-workflow.js');
    if (result.error) {
      const detail = context.dump(result.error);
      result.error.dispose();
      const message = detail && typeof detail === 'object' && 'message' in detail ? detail.message : detail;
      throw new Error(String(message));
    }
    handle = result.value;
    const json = context.getString(handle);
    handle.dispose();
    handle = undefined;
    process.stdout.write(JSON.stringify({ ok: true, json }));
  } catch (error) {
    const message = String(error && typeof error === 'object' && 'message' in error ? error.message : error)
      .slice(0, ${MAX_ERROR_CHARACTERS});
    process.stdout.write(JSON.stringify({
      ok: false,
      error: message,
      timedOut: payload !== undefined && Date.now() > payload.deadline,
    }));
    process.exitCode = 1;
  } finally {
    try { handle?.dispose(); } catch {}
    try { context?.dispose(); } catch {}
    try { runtime?.dispose(); } catch {}
    try { quickJS?.dispose(); } catch {}
  }
}
`

interface ExecutorMessage {
  readonly ok: boolean
  readonly value?: JsonValue
  readonly json?: string
  readonly error?: string
  readonly timedOut?: boolean
}

/**
 * Create a fresh-worker, no-import WebAssembly Provider.
 * @param id - Registry identity.
 * @returns L1 WebAssembly workflow backend.
 */
export function createNoImportWasmBackend(id: string = 'wasm-no-import-worker'): RpWorkflowBackend {
  return Object.freeze({
    id,
    kind: 'wasm' as const,
    trust: 'L1' as const,
    priority: -200,
    kinds: Object.freeze(['turn', 'workflow', 'sidecar'] as const),
    async execute(request: RpWorkflowRequest, signal: AbortSignal) {
      authorize(request)
      const payload = parseWasmPayload(request.payload)
      const timeoutMs = resolveTimeout(request)
      return executeWasmWorker(payload, signal, timeoutMs)
    },
  })
}

/**
 * Create a QuickJS-in-isolated-process Provider with no bridged Host APIs.
 * @param id - Registry identity.
 * @returns L1 QuickJS workflow backend.
 */
export function createIsolatedQuickJsBackend(id: string = 'quickjs-isolated'): RpWorkflowBackend {
  return Object.freeze({
    id,
    kind: 'quickjs' as const,
    trust: 'L1' as const,
    priority: -210,
    kinds: Object.freeze(['turn', 'workflow', 'sidecar'] as const),
    async execute(request: RpWorkflowRequest, signal: AbortSignal) {
      authorize(request)
      const payload = parseQuickJsPayload(request.payload)
      const timeoutMs = resolveTimeout(request)
      return executeQuickJsProcess(payload, signal, timeoutMs)
    },
  })
}

async function executeWasmWorker(
  payload: RpWasmWorkflowPayload,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<JsonValue> {
  if (signal.aborted) throw abortError(signal)
  return new Promise((resolve, reject) => {
    const worker = new Worker(WASM_WORKER_SOURCE, {
      eval: true,
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 32, stackSizeMb: 4 },
      workerData: {
        moduleBase64: payload.moduleBase64,
        exportName: payload.export,
        args: [...(payload.args ?? [])],
      },
    })
    const resources: { timer?: ReturnType<typeof setTimeout>; abort?: () => void } = {}
    const finish = createSettler(() => {
      if (resources.timer !== undefined) clearTimeout(resources.timer)
      if (resources.abort !== undefined) signal.removeEventListener('abort', resources.abort)
    })
    const terminateWith = (error: Error): void => {
      void worker.terminate()
      finish(() => { reject(error) })
    }
    const abort = (): void => { terminateWith(abortError(signal)) }
    const timer = setTimeout(() => { terminateWith(timeoutError(timeoutMs)) }, timeoutMs)
    resources.abort = abort
    resources.timer = timer
    signal.addEventListener('abort', abort, { once: true })
    worker.once('message', (message: ExecutorMessage) => {
      void worker.terminate()
      finish(() => {
        if (!message.ok) reject(executionError(message.error ?? 'WebAssembly execution failed'))
        else resolve(message.value ?? null)
      })
    })
    worker.once('error', (error) => { finish(() => { reject(executionError(renderError(error))) }) })
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => { reject(executionError(`WebAssembly worker exited with code ${code}`)) })
    })
  })
}

async function executeQuickJsProcess(
  payload: RpQuickJsWorkflowPayload,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<JsonValue> {
  if (signal.aborted) throw abortError(signal)
  const inputJson = stringifyJson(payload.input ?? null, 'QuickJS input', MAX_INPUT_BYTES)
  const program = createQuickJsProgram(payload.source, inputJson)
  const childPayload = stringifyJson({
    quickjsCoreUrl: import.meta.resolve('quickjs-emscripten-core'),
    quickjsVariantUrl: import.meta.resolve('@jitl/quickjs-wasmfile-release-sync'),
    memoryLimitBytes: 16 * 1024 * 1024,
    maxStackSizeBytes: 512 * 1024,
    deadline: Date.now() + timeoutMs,
    program,
  }, 'QuickJS executor payload', MAX_INPUT_BYTES + MAX_SOURCE_BYTES + 64 * 1024)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--max-old-space-size=64',
      '--input-type=commonjs',
      '--eval',
      QUICKJS_CHILD_SOURCE,
    ], {
      env: {},
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const resources: { timer?: ReturnType<typeof setTimeout>; abort?: () => void } = {}
    const finish = createSettler(() => {
      if (resources.timer !== undefined) clearTimeout(resources.timer)
      if (resources.abort !== undefined) signal.removeEventListener('abort', resources.abort)
    })
    const terminateWith = (error: Error): void => {
      child.kill()
      finish(() => { reject(error) })
    }
    const abort = (): void => { terminateWith(abortError(signal)) }
    const timer = setTimeout(() => { terminateWith(timeoutError(timeoutMs)) }, timeoutMs)
    resources.abort = abort
    resources.timer = timer
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES + MAX_ERROR_CHARACTERS) {
        terminateWith(new RpSandboxWorkflowError('QuickJS output exceeds the execution limit', 'LIMIT'))
      }
    })
    child.stderr.on('data', (chunk: string) => {
      if (Buffer.byteLength(stderr) <= MAX_ERROR_CHARACTERS) stderr += chunk
    })
    child.stdin.on('error', () => {})
    child.once('error', (error) => { finish(() => { reject(executionError(renderError(error))) }) })
    child.once('close', () => { finish(() => {
      try {
        const message = JSON.parse(stdout) as ExecutorMessage
        if (!message.ok) {
          if (message.timedOut === true) throw timeoutError(timeoutMs)
          throw executionError(message.error ?? (stderr || 'QuickJS execution failed'))
        }
        if (typeof message.json !== 'string') throw executionError('QuickJS returned an invalid response')
        if (Buffer.byteLength(message.json) > MAX_OUTPUT_BYTES) {
          throw new RpSandboxWorkflowError('QuickJS result exceeds the execution limit', 'LIMIT')
        }
        resolve(parseJsonValue(message.json, 'QuickJS result'))
      } catch (error: unknown) {
        reject(error instanceof RpSandboxWorkflowError
          ? error
          : executionError(`Invalid QuickJS response: ${renderError(error)} ${stderr}`.trim()))
      }
    }) })
    child.stdin.end(childPayload)
  })
}

function parseQuickJsPayload(value: JsonValue): RpQuickJsWorkflowPayload {
  const record = requireRecord(value, 'QuickJS payload')
  requireOnlyKeys(record, ['schemaVersion', 'source', 'input'], 'QuickJS payload')
  if (record.schemaVersion !== 1 || typeof record.source !== 'string') {
    throw invalid('QuickJS payload requires schemaVersion 1 and source')
  }
  if (record.source.trim() === '' || Buffer.byteLength(record.source) > MAX_SOURCE_BYTES) {
    throw limit(`QuickJS source must contain 1 to ${MAX_SOURCE_BYTES} bytes`)
  }
  if ('input' in record) stringifyJson(record.input, 'QuickJS input', MAX_INPUT_BYTES)
  return Object.freeze({
    schemaVersion: 1,
    source: record.source,
    ...('input' in record ? { input: record.input } : {}),
  })
}

function parseWasmPayload(value: JsonValue): RpWasmWorkflowPayload {
  const record = requireRecord(value, 'WebAssembly payload')
  requireOnlyKeys(record, ['schemaVersion', 'moduleBase64', 'export', 'args'], 'WebAssembly payload')
  if (record.schemaVersion !== 1 || typeof record.moduleBase64 !== 'string' || typeof record.export !== 'string') {
    throw invalid('WebAssembly payload requires schemaVersion 1, moduleBase64, and export')
  }
  if (record.export.trim() === '' || record.export.length > 256) {
    throw invalid('WebAssembly export must contain 1 to 256 characters')
  }
  if (record.args !== undefined && (!Array.isArray(record.args)
    || record.args.length > MAX_WASM_ARGUMENTS
    || record.args.some(value => typeof value !== 'number' || !Number.isFinite(value)))) {
    throw invalid(`WebAssembly args must contain at most ${MAX_WASM_ARGUMENTS} finite numbers`)
  }
  const bytes = decodeCanonicalBase64(record.moduleBase64)
  validateWasmLayout(bytes)
  return Object.freeze({
    schemaVersion: 1,
    moduleBase64: record.moduleBase64,
    export: record.export,
    ...(record.args === undefined ? {} : { args: Object.freeze([...record.args]) as readonly number[] }),
  })
}

/**
 * Validate the resource-bearing portions of a WebAssembly binary before compilation.
 * @param bytes - Canonical module bytes.
 */
export function validateWasmLayout(bytes: Uint8Array): void {
  if (bytes.byteLength < 8 || bytes.byteLength > MAX_WASM_BYTES) {
    throw limit(`WebAssembly module must contain 8 to ${MAX_WASM_BYTES} bytes`)
  }
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]
  if (header.some((value, index) => bytes[index] !== value)) throw invalid('WebAssembly header is invalid')
  const cursor = new BinaryCursor(bytes, 8, bytes.byteLength)
  while (!cursor.done()) {
    const sectionId = cursor.byte()
    const size = cursor.u32()
    const end = cursor.offset + size
    if (end > bytes.byteLength) throw invalid('WebAssembly section exceeds module bounds')
    if (sectionId === 4) validateTableSection(new BinaryCursor(bytes, cursor.offset, end))
    if (sectionId === 5) validateMemorySection(new BinaryCursor(bytes, cursor.offset, end))
    if (sectionId === 8) throw invalid('WebAssembly start sections are forbidden')
    cursor.offset = end
  }
}

function validateTableSection(cursor: BinaryCursor): void {
  const count = cursor.u32()
  if (count > 1) throw limit('WebAssembly modules may declare at most one table')
  for (let index = 0; index < count; index += 1) {
    const referenceType = cursor.byte()
    if (referenceType !== 0x70 && referenceType !== 0x6f) throw invalid('Unsupported WebAssembly table reference type')
    validateLimits(cursor, MAX_WASM_TABLE_ELEMENTS, 'table')
  }
  if (!cursor.done()) throw invalid('WebAssembly table section is malformed')
}

function validateMemorySection(cursor: BinaryCursor): void {
  const count = cursor.u32()
  if (count > 1) throw limit('WebAssembly modules may declare at most one memory')
  for (let index = 0; index < count; index += 1) validateLimits(cursor, MAX_WASM_MEMORY_PAGES, 'memory')
  if (!cursor.done()) throw invalid('WebAssembly memory section is malformed')
}

function validateLimits(cursor: BinaryCursor, maximum: number, label: string): void {
  const flags = cursor.u32()
  if (flags !== 1) throw invalid(`WebAssembly ${label} must declare a non-shared 32-bit maximum`)
  const minimum = cursor.u32()
  const declaredMaximum = cursor.u32()
  if (minimum > declaredMaximum || declaredMaximum > maximum) {
    throw limit(`WebAssembly ${label} maximum exceeds ${maximum}`)
  }
}

class BinaryCursor {
  constructor(
    private readonly bytes: Uint8Array,
    public offset: number,
    private readonly end: number,
  ) {}

  done(): boolean { return this.offset === this.end }

  byte(): number {
    if (this.offset >= this.end) throw invalid('Unexpected end of WebAssembly binary')
    const value = this.bytes[this.offset]
    this.offset += 1
    return value ?? 0
  }

  u32(): number {
    let value = 0
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = this.byte()
      if (shift === 28 && (byte & 0xf0) !== 0) throw invalid('WebAssembly integer exceeds u32')
      value += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) return value
    }
    throw invalid('WebAssembly integer is malformed')
  }
}

function createQuickJsProgram(source: string, inputJson: string): string {
  return `(() => {
    'use strict';
    const freeze = (value, depth = 0) => {
      if (depth > 64) throw new Error('input nesting exceeds 64');
      if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) freeze(value[key], depth + 1);
        Object.freeze(value);
      }
      return value;
    };
    const input = freeze(JSON.parse(${JSON.stringify(inputJson)}));
    for (const key of ['process', 'require', 'module', 'exports', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'SharedArrayBuffer', 'Atomics', 'WebAssembly', 'crypto', 'performance']) {
      Object.defineProperty(globalThis, key, { value: undefined, writable: false, configurable: false });
    }
    Object.defineProperty(globalThis, 'Date', { value: undefined, writable: false, configurable: false });
    Object.defineProperty(Math, 'random', { value: () => { throw new Error('Math.random is disabled'); }, writable: false, configurable: false });
    const value = (${source});
    const json = JSON.stringify(value);
    if (typeof json !== 'string') throw new Error('result must be JSON-serializable');
    return json;
  })()`
}

function authorize(request: RpWorkflowRequest): void {
  if (request.authority === undefined
    || trustRank(request.authority.trust) < trustRank('L1')
    || !request.authority.permissions.includes(SCRIPT_PERMISSION)) {
    throw new RpSandboxWorkflowError(
      `L1 workflow execution requires ${SCRIPT_PERMISSION} and effective L1 authority`,
      'AUTHORITY_REQUIRED',
    )
  }
}

function resolveTimeout(request: RpWorkflowRequest): number {
  const candidate = request.budget?.timeoutMs ?? request.authority?.budget.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(candidate) || candidate <= 0) throw invalid('Workflow timeout must be a positive integer')
  return Math.min(candidate, MAX_TIMEOUT_MS)
}

function decodeCanonicalBase64(source: string): Uint8Array {
  if (source === '' || source.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(source)) {
    throw invalid('WebAssembly moduleBase64 must be canonical base64')
  }
  const bytes = Buffer.from(source, 'base64')
  if (bytes.toString('base64') !== source) throw invalid('WebAssembly moduleBase64 must be canonical base64')
  return bytes
}

function requireRecord(value: JsonValue, label: string): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(`${label} must be an object`)
  return value
}

function requireOnlyKeys(record: Record<string, JsonValue>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(record).filter(key => !allowed.includes(key))
  if (unexpected.length > 0) throw invalid(`${label} contains unsupported field ${JSON.stringify(unexpected.sort()[0])}`)
}

function stringifyJson(value: unknown, label: string, maximumBytes: number): string {
  let serialized: unknown
  try { serialized = JSON.stringify(value) }
  catch (error: unknown) { throw invalid(`${label} is not JSON-serializable: ${renderError(error)}`) }
  if (typeof serialized !== 'string') throw invalid(`${label} is not JSON-serializable`)
  const source = serialized
  if (Buffer.byteLength(source) > maximumBytes) throw limit(`${label} exceeds ${maximumBytes} bytes`)
  return source
}

function parseJsonValue(source: string, label: string): JsonValue {
  try { return JSON.parse(source) as JsonValue }
  catch (error: unknown) { throw executionError(`${label} is invalid JSON: ${renderError(error)}`) }
}

function trustRank(value: 'L0' | 'L1' | 'L2'): number { return value === 'L0' ? 0 : value === 'L1' ? 1 : 2 }
function invalid(message: string): RpSandboxWorkflowError { return new RpSandboxWorkflowError(message, 'INVALID') }
function limit(message: string): RpSandboxWorkflowError { return new RpSandboxWorkflowError(message, 'LIMIT') }
function executionError(message: string): RpSandboxWorkflowError { return new RpSandboxWorkflowError(message, 'EXECUTION') }
function timeoutError(timeoutMs: number): RpSandboxWorkflowError {
  return new RpSandboxWorkflowError(`Sandbox workflow timed out after ${timeoutMs}ms`, 'TIMEOUT')
}
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'workflow cancelled'))
}
function renderError(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error) }
  catch { return '[unrenderable error]' }
}

function createSettler(cleanup: () => void): (callback: () => void) => void {
  let settled = false
  return (callback) => {
    if (settled) return
    settled = true
    cleanup()
    callback()
  }
}

/** Cordis plugin name. */
export const name = 'rp-workflow-backends-sandbox'
/** The plugin contributes Providers to the canonical router. */
export const inject = ['rpWorkflowRouter']

/** Register both L1 execution Providers as reversible Effects. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.rpWorkflowRouter.register(createNoImportWasmBackend()))
  ctx.effect(() => ctx.rpWorkflowRouter.register(createIsolatedQuickJsBackend()))
}
