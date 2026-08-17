import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import * as Preset from '../src/index.ts'
import type { RpPromptPresetRecord } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const record: RpPromptPresetRecord = {
  schemaVersion: 1,
  id: 'preset:test',
  name: 'Test preset',
  promptDefinitions: [
    { schemaVersion: 1, id: 'main', name: 'Main', role: 'system', content: 'Act as {{char}}', marker: false },
    { schemaVersion: 1, id: 'chatHistory', name: 'History', role: 'system', content: '', marker: true },
  ],
  promptOrders: [
    { id: '100000', entries: [{ identifier: 'main', enabled: true }] },
    { id: '100001', entries: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] },
  ],
  selectedPromptOrderId: '100001',
  prompts: [
    { schemaVersion: 1, id: 'main', role: 'system', content: 'Act as {{char}}', priority: 0 },
    { schemaVersion: 1, id: 'chatHistory', role: 'system', content: '', priority: 1 },
  ],
  generation: { temperature: 0.8, openai_max_tokens: 3000 },
  savedAt: 1,
}

async function createRuntime(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(Preset)
  return ctx
}

describe('@dsh-rp/preset', () => {
  it('persists presets and exact conversation bindings across Host restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-preset-'))
    roots.push(root)
    const conversation = { kind: 'conversation' as const, id: 'session-1' }
    const first = await createRuntime(root)
    expect(first.rpPresets.capture(conversation)).toBeUndefined()
    await first.rpPresets.save(record)
    await first.rpPresets.activate(conversation, record.id)
    const initial = first.rpPresets.capture({ kind: 'turn', id: 'turn-1', parent: conversation })
    expect(initial).toMatchObject({
      id: record.id,
      selectedPromptOrderId: '100001',
      bindingScope: conversation,
      prompts: [{ id: 'main' }, { id: 'chatHistory' }],
    })
    expect(initial?.snapshotHash).toMatch(/^[a-f0-9]{64}$/u)
    await first.fiber.dispose()

    const restarted = await createRuntime(root)
    expect(restarted.rpPresets.list()).toHaveLength(1)
    expect(restarted.rpPresets.capture(conversation)).toMatchObject({
      id: record.id,
      snapshotHash: initial?.snapshotHash,
      promptDefinitions: [{ id: 'main' }, { id: 'chatHistory' }],
      promptOrders: [{ id: '100000' }, { id: '100001' }],
    })
    await restarted.fiber.dispose()
  })

  it('removes activation without changing the ordinary no-preset path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-preset-empty-'))
    roots.push(root)
    const ctx = await createRuntime(root)
    const scope = { kind: 'conversation' as const, id: 'ordinary' }
    await ctx.rpPresets.save(record)
    await ctx.rpPresets.activate(scope, record.id)
    await expect(ctx.rpPresets.deactivate(scope)).resolves.toBe(true)
    expect(ctx.rpPresets.capture(scope)).toBeUndefined()
    expect(ctx.rpPresets.list()).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
