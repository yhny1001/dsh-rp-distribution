import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpRegistry from '@dsh-rp/registry'
import * as Artifacts from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('@dsh-rp/registry-artifacts-local', () => {
  it('publishes and retrieves detached content-addressed archives', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-artifacts-'))
    roots.push(root)
    const store = new Artifacts.RpLocalPackageArtifactStore({ root, maxBytes: 1024 })
    const bytes = new TextEncoder().encode('immutable package archive')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await store.put(sha256, bytes)
    const first = await store.get(sha256)
    expect(first).toEqual(bytes)
    if (first !== undefined) first[0] = 0
    expect(await store.get(sha256)).toEqual(bytes)
    await store.put(sha256, bytes)
  })

  it('fails closed for invalid keys, mismatched writes, and corrupt cache files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-artifacts-corrupt-'))
    roots.push(root)
    const store = new Artifacts.RpLocalPackageArtifactStore({ root, maxBytes: 1024 })
    const bytes = new TextEncoder().encode('expected')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await expect(store.put('..', bytes)).rejects.toMatchObject({ code: 'INTEGRITY' })
    await expect(store.put(sha256, new TextEncoder().encode('different')))
      .rejects.toMatchObject({ code: 'INTEGRITY' })
    await store.put(sha256, bytes)
    await writeFile(join(root, sha256.slice(0, 2), sha256), 'corrupt')
    await expect(store.get(sha256)).rejects.toMatchObject({ code: 'INTEGRITY' })
  })

  it('registers and releases the cache with its Cordis plugin fiber', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-rp-artifacts-plugin-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(RpRegistry)
    const fiber = await ctx.plugin(Artifacts, { root, maxBytes: 1024 })
    expect(ctx.rpRegistry.getArtifactStore()).toEqual({ id: 'local-content-addressed-v1' })
    await fiber.dispose()
    expect(ctx.rpRegistry.getArtifactStore()).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
