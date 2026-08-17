/** Local contained executors for declarative RP workflows. @module @dsh-rp/workflow-backends-local */
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@dsh-rp/contracts'
import type { RpWorkflowBackend, RpWorkflowRequest } from '@dsh-rp/workflow-router'

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

const EVALUATOR_SOURCE = String.raw`
'use strict';
function record(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function evaluate(expression, input, depth, state) {
  state.count += 1;
  if (depth > 64 || state.count > 10000) throw new Error('deterministic workflow limit exceeded');
  if (!record(expression) || typeof expression.op !== 'string') return expression;
  if (expression.op === 'input') return input;
  if (expression.op === 'get') {
    if (typeof expression.key !== 'string') throw new Error('get.key must be a string');
    const source = evaluate(expression.from, input, depth + 1, state);
    return record(source) && Object.prototype.hasOwnProperty.call(source, expression.key)
      ? source[expression.key]
      : null;
  }
  if (expression.op === 'object') {
    if (!record(expression.entries)) throw new Error('object.entries must be an object');
    return Object.fromEntries(Object.entries(expression.entries).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, evaluate(value, input, depth + 1, state)]));
  }
  if (expression.op === 'array') {
    if (!Array.isArray(expression.items)) throw new Error('array.items must be an array');
    return expression.items.map(value => evaluate(value, input, depth + 1, state));
  }
  if (expression.op === 'if') {
    return evaluate(expression.condition, input, depth + 1, state)
      ? evaluate(expression.then, input, depth + 1, state)
      : evaluate(expression.else, input, depth + 1, state);
  }
  throw new Error('unsupported deterministic operation ' + String(expression.op));
}
function run(payload) {
  if (!record(payload) || !Object.prototype.hasOwnProperty.call(payload, 'expression')) {
    throw new Error('deterministic payload requires expression');
  }
  return evaluate(payload.expression, payload.input ?? null, 0, { count: 0 });
}
`

const WORKER_SOURCE = `${EVALUATOR_SOURCE}
const { parentPort, workerData } = require('node:worker_threads');
try { parentPort.postMessage({ ok: true, value: run(JSON.parse(workerData)) }); }
catch (error) { parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
`

const PROCESS_SOURCE = `${EVALUATOR_SOURCE}
let source = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { source += chunk; });
process.stdin.on('end', () => {
  try { process.stdout.write(JSON.stringify({ ok: true, value: run(JSON.parse(source)) })); }
  catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
});
`

interface ExecutorMessage {
  readonly ok: boolean
  readonly value?: JsonValue
  readonly error?: string
}

/**
 * Create a fresh-worker backend for bounded declarative workflows.
 * @param id - Registry identity for this backend instance.
 * @returns Worker Thread workflow backend definition.
 */
export function createWorkerThreadBackend(id: string = 'worker-thread-local'): RpWorkflowBackend {
  return {
    id,
    kind: 'worker-thread',
    trust: 'L0',
    priority: 20,
    kinds: ['turn', 'workflow', 'sidecar'],
    execute(request, signal) {
      return executeWorker(request, signal)
    },
  }
}

/**
 * Create a sanitized child-process backend for bounded declarative workflows.
 * @param id - Registry identity for this backend instance.
 * @returns Isolated-process workflow backend definition.
 */
export function createIsolatedProcessBackend(id: string = 'isolated-process-local'): RpWorkflowBackend {
  return {
    id,
    kind: 'isolated-process',
    trust: 'L0',
    priority: 10,
    kinds: ['turn', 'workflow', 'sidecar'],
    execute(request, signal) {
      return executeProcess(request, signal)
    },
  }
}

async function executeWorker(request: RpWorkflowRequest, signal: AbortSignal): Promise<JsonValue> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  const payload = encodePayload(request.payload)
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: payload,
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 32, stackSizeMb: 4 },
    })
    let settled = false
    const settle = (callback: () => void): void => {
      if (!settled) {
        settled = true
        signal.removeEventListener('abort', abort)
        callback()
      }
    }
    const abort = (): void => {
      void worker.terminate()
      settle(() => {
        reject(abortError(signal))
      })
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.once('message', (message: ExecutorMessage) => {
      void worker.terminate()
      settle(() => {
        if (!message.ok) reject(new Error(message.error ?? 'worker execution failed'))
        else resolve(message.value ?? null)
      })
    })
    worker.once('error', (error) => {
      settle(() => {
        reject(error)
      })
    })
    worker.once('exit', (code) => {
      if (code !== 0) {
        settle(() => {
          reject(new Error(`RP workflow worker exited with code ${code}`))
        })
      }
    })
  })
}

async function executeProcess(request: RpWorkflowRequest, signal: AbortSignal): Promise<JsonValue> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  const payload = encodePayload(request.payload)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=commonjs', '--eval', PROCESS_SOURCE], {
      env: {},
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      callback()
    }
    const abort = (): void => {
      child.kill()
      settle(() => {
        reject(abortError(signal))
      })
    }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) abort()
    })
    child.stderr.on('data', (chunk: string) => {
      if (Buffer.byteLength(stderr) <= MAX_OUTPUT_BYTES) stderr += chunk
    })
    child.once('error', (error) => {
      settle(() => {
        reject(error)
      })
    })
    child.once('close', () => {
      settle(() => {
        try {
          const message = JSON.parse(stdout) as ExecutorMessage
          if (!message.ok) reject(new Error(message.error ?? (stderr || 'process execution failed')))
          else resolve(message.value ?? null)
        } catch (error: unknown) {
          reject(new Error(`Invalid RP workflow process response: ${renderError(error)} ${stderr}`.trim()))
        }
      })
    })
    child.stdin.end(payload)
  })
}

function encodePayload(payload: JsonValue): string {
  const source = JSON.stringify(payload)
  if (Buffer.byteLength(source) > MAX_OUTPUT_BYTES) {
    throw new Error(`RP workflow payload exceeds ${MAX_OUTPUT_BYTES} bytes`)
  }
  return source
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'workflow cancelled'))
}

function renderError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unrenderable error]'
  }
}

export const name = 'rp-workflow-backends-local'
export const inject = ['rpWorkflowRouter']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.rpWorkflowRouter.register(createWorkerThreadBackend()))
  ctx.effect(() => ctx.rpWorkflowRouter.register(createIsolatedProcessBackend()))
}
