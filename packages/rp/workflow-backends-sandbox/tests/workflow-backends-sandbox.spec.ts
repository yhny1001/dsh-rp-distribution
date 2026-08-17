import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { RpAuthorityDecision } from '@dsh-rp/policy'
import RpWorkflowRouter from '@dsh-rp/workflow-router'
import * as SandboxBackends from '../src/index.ts'

const authority: RpAuthorityDecision = Object.freeze({
  permissions: Object.freeze(['script.execute']),
  trust: 'L1',
  budget: Object.freeze({ timeoutMs: 2_000 }),
  networkDomains: Object.freeze([]),
  fileRoots: Object.freeze([]),
  layers: Object.freeze(['test']),
})

const addModule = Buffer.from(
  '0061736d0100000001070160027f7f017f030201000707010361646400000a09010700200020016a0b',
  'hex',
).toString('base64')

describe('@dsh-rp/workflow-backends-sandbox', () => {
  it('executes a bounded no-import WebAssembly numeric ABI in a fresh Worker', async () => {
    const backend = SandboxBackends.createNoImportWasmBackend()
    await expect(backend.execute({
      kind: 'workflow', authority,
      payload: { schemaVersion: 1, moduleBase64: addModule, export: 'add', args: [20, 22] },
    }, new AbortController().signal)).resolves.toBe(42)
  })

  it('executes JSON expressions in QuickJS without ambient Node or network authority', async () => {
    const backend = SandboxBackends.createIsolatedQuickJsBackend()
    await expect(backend.execute({
      kind: 'workflow', authority,
      payload: {
        schemaVersion: 1,
        source: '({ answer: input.answer + 1, process: typeof process, fetch: typeof fetch, date: typeof Date })',
        input: { answer: 41 },
      },
    }, new AbortController().signal)).resolves.toEqual({
      answer: 42,
      process: 'undefined',
      fetch: 'undefined',
      date: 'undefined',
    })
  }, 10_000)

  it.each([
    SandboxBackends.createNoImportWasmBackend(),
    SandboxBackends.createIsolatedQuickJsBackend(),
  ])('requires explicit L1 script authority for $kind', async (backend) => {
    const payload = backend.kind === 'wasm'
      ? { schemaVersion: 1 as const, moduleBase64: addModule, export: 'add', args: [1, 1] }
      : { schemaVersion: 1 as const, source: '1 + 1' }
    await expect(backend.execute({ kind: 'workflow', payload }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'AUTHORITY_REQUIRED' })
  })

  it('rejects unbounded memory and start sections before creating a Worker', async () => {
    const unboundedMemory = Buffer.from('0061736d010000000503010001', 'hex').toString('base64')
    const withStart = Buffer.from(
      '0061736d0100000001070160027f7f017f030201000707010361646400000801000a09010700200020016a0b',
      'hex',
    ).toString('base64')
    const backend = SandboxBackends.createNoImportWasmBackend()
    for (const moduleBase64 of [unboundedMemory, withStart]) {
      const failure = await backend.execute({
        kind: 'workflow', authority,
        payload: { schemaVersion: 1, moduleBase64, export: 'add', args: [1, 2] },
      }, new AbortController().signal).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(SandboxBackends.RpSandboxWorkflowError)
      if (failure instanceof SandboxBackends.RpSandboxWorkflowError) {
        expect(['INVALID', 'LIMIT']).toContain(failure.code)
      }
    }
  })

  it('rejects every WebAssembly import before instantiation', async () => {
    const importedFunction = Buffer.from(
      '0061736d010000000105016000017f020701016d0166000007050101660000',
      'hex',
    ).toString('base64')
    const backend = SandboxBackends.createNoImportWasmBackend()
    const failure = await backend.execute({
      kind: 'workflow', authority,
      payload: { schemaVersion: 1, moduleBase64: importedFunction, export: 'f' },
    }, new AbortController().signal).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(SandboxBackends.RpSandboxWorkflowError)
    if (failure instanceof SandboxBackends.RpSandboxWorkflowError) {
      expect(failure.code).toBe('EXECUTION')
      expect(failure.message).toContain('imports are forbidden')
    }
  })

  it('terminates non-cooperative QuickJS execution at the backend deadline', async () => {
    const backend = SandboxBackends.createIsolatedQuickJsBackend()
    await expect(backend.execute({
      kind: 'workflow', authority,
      budget: { timeoutMs: 100 },
      payload: { schemaVersion: 1, source: '(() => { while (true) {} })()' },
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'TIMEOUT' })
  }, 10_000)

  it('releases both backend registrations with its Cordis fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(RpWorkflowRouter)
    const fiber = await ctx.plugin(SandboxBackends)
    expect(ctx.rpWorkflowRouter.list().map(item => item.id)).toEqual([
      'deterministic',
      'wasm-no-import-worker',
      'quickjs-isolated',
    ])
    await fiber.dispose()
    expect(ctx.rpWorkflowRouter.list().map(item => item.id)).toEqual(['deterministic'])
    await ctx.fiber.dispose()
  })
})
