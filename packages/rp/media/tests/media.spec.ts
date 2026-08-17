import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RpMediaProviderId } from '@dsh-rp/contracts'
import RpMediaRuntime from '../src/index.ts'

describe('RP media runtime', () => {
  it('generates deterministic escaped SVG artifacts with bounded dimensions', async () => {
    const ctx = new Context(); await ctx.plugin(RpMediaRuntime)
    const request = { kind: 'image' as const, prompt: '<script>alert(1)</script>', options: { width: 640, height: 360 } }
    const first = await ctx.rpMedia.generate(request)
    const second = await ctx.rpMedia.generate(request)
    expect(second).toEqual(first)
    const svg = Buffer.from(first.uri.split(',')[1] ?? '', 'base64').toString('utf8')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).not.toContain('<script>')
    await ctx.fiber.dispose()
  })

  it('releases contributed Providers and rejects unsafe artifact schemes', async () => {
    const ctx = new Context(); await ctx.plugin(RpMediaRuntime)
    const release = ctx.rpMedia.register({
      id: RpMediaProviderId('unsafe'), version: '1.0.0', title: 'Unsafe', trust: 'L0', kinds: ['document'],
      generate: () => Promise.resolve({
        schemaVersion: 1, id: 'unsafe', kind: 'document', mimeType: 'text/plain', uri: 'file:///secret',
      }),
    })
    await expect(ctx.rpMedia.generate({ kind: 'document', prompt: 'test', provider: RpMediaProviderId('unsafe') }))
      .rejects.toThrow('URI must use')
    release()
    expect(ctx.rpMedia.list().map(item => item.id)).not.toContain('unsafe')
    await ctx.fiber.dispose()
  })

  it('routes input batches under authority and materializes only Adapter-owned artifacts', async () => {
    const ctx = new Context(); await ctx.plugin(RpMediaRuntime)
    const release = ctx.rpMedia.registerInputAdapter({
      id: 'test-input', version: '1.0.0', title: 'Test Input', trust: 'L1', permissions: ['attachment.write'],
      supports: input => input.kind === 'image' && input.mimeType === 'image/png',
      ingest: inputs => Promise.resolve(inputs.map((_input, index) => ({
        schemaVersion: 1, id: `image-${String(index)}`, kind: 'image', mimeType: 'image/png',
        uri: `attachment:image-${String(index)}`,
        metadata: { attachment: { attachmentId: `image-${String(index)}`, mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
      }))),
      modelInput: artifact => ({
        type: 'image',
        attachment: {
          attachmentId: artifact.id, mediaType: artifact.mimeType, bytes: 1, width: 1, height: 1,
        },
      }),
    })
    const input = [{ kind: 'image' as const, mimeType: 'image/png', data: Uint8Array.of(1) }]
    await expect(ctx.rpMedia.ingestInputs(input, { trust: 'L0', permissions: ['attachment.write'] }))
      .rejects.toMatchObject({ code: 'DENIED' })
    await expect(ctx.rpMedia.ingestInputs(input, { trust: 'L1', permissions: [] }))
      .rejects.toMatchObject({ code: 'DENIED' })
    const [artifact] = await ctx.rpMedia.ingestInputs(input, { trust: 'L1', permissions: ['attachment.write'] })
    expect(artifact).toMatchObject({
      id: 'image-0', metadata: { inputAdapter: 'test-input' },
    })
    expect(ctx.rpMedia.modelInput(artifact!)).toMatchObject({
      type: 'image', attachment: { attachmentId: 'image-0' },
    })
    release()
    expect(ctx.rpMedia.listInputAdapters()).toEqual([])
    expect(() => ctx.rpMedia.modelInput(artifact!)).toThrow('not live')
    await ctx.fiber.dispose()
  })

  it('selects deterministically from the Adapters permitted by effective authority', async () => {
    const ctx = new Context(); await ctx.plugin(RpMediaRuntime)
    const adapter = (id: string, permissions?: readonly string[]) => ({
      id, version: '1.0.0', title: id, trust: 'L1' as const,
      ...(permissions === undefined ? {} : { permissions }),
      supports: () => true,
      ingest: () => Promise.resolve([{
        schemaVersion: 1 as const, id, kind: 'image' as const, mimeType: 'image/png', uri: `attachment:${id}`,
      }]),
      modelInput: () => undefined,
    })
    ctx.rpMedia.registerInputAdapter(adapter('a-denied', ['secret.read']))
    ctx.rpMedia.registerInputAdapter(adapter('b-authorized'))
    const [artifact] = await ctx.rpMedia.ingestInputs(
      [{ kind: 'image', mimeType: 'image/png', data: Uint8Array.of(1) }],
      { trust: 'L1', permissions: [] },
    )
    expect(artifact).toMatchObject({ id: 'b-authorized', metadata: { inputAdapter: 'b-authorized' } })
    await ctx.fiber.dispose()
  })
})
