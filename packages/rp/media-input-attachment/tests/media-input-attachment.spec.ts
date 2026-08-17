import { describe, expect, it, vi } from 'vitest'
import { AttachmentId, type AttachmentStore, type SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { createAttachmentMediaInputAdapter } from '../src/index.ts'

function store(limit = 10): {
  attachments: AttachmentStore
  validateImage: ReturnType<typeof vi.fn>
  saveImage: ReturnType<typeof vi.fn>
} {
  let sequence = 0
  const validateImage = vi.fn((_input: SaveImageAttachment) => Promise.resolve())
  const saveImage = vi.fn((input: SaveImageAttachment) => {
    sequence += 1
    return Promise.resolve({
      attachmentId: AttachmentId(`sha256:${String(sequence).padStart(64, '0')}`),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...(input.name === undefined ? {} : { name: input.name }),
    })
  })
  const attachments = {
    imageLimits: {
      maxImageBytes: limit,
      maxImagesPerMessage: 2,
      maxMessageImageBytes: limit,
      maxImagePixels: 100,
      mediaTypes: ['image/png'],
    },
    validateImage,
    saveImage,
    readImage: vi.fn(),
  } as unknown as AttachmentStore
  return { attachments, validateImage, saveImage }
}

describe('attachment-backed RP media input', () => {
  it('validates a complete batch before publishing and round-trips model references', async () => {
    const { attachments, validateImage, saveImage } = store()
    const adapter = createAttachmentMediaInputAdapter(attachments)
    const inputs = [
      { kind: 'image' as const, mimeType: 'image/png', data: Uint8Array.of(1), name: 'one.png' },
      { kind: 'image' as const, mimeType: 'image/png', data: Uint8Array.of(2) },
    ]
    const artifacts = await adapter.ingest(inputs)
    expect(validateImage).toHaveBeenCalledTimes(2)
    expect(saveImage).toHaveBeenCalledTimes(2)
    expect(artifacts[0]).toMatchObject({
      kind: 'image', uri: `attachment:sha256:${'1'.padStart(64, '0')}`,
      metadata: { source: 'user-input', attachment: { name: 'one.png' } },
    })
    expect(adapter.modelInput(artifacts[0]!)).toMatchObject({
      type: 'image', attachment: { name: 'one.png', bytes: 1, width: 1, height: 1 },
    })
  })

  it('rejects aggregate overflow before validating or saving any object', async () => {
    const { attachments, validateImage, saveImage } = store(1)
    const adapter = createAttachmentMediaInputAdapter(attachments)
    await expect(adapter.ingest([
      { kind: 'image', mimeType: 'image/png', data: Uint8Array.of(1, 2) },
    ])).rejects.toMatchObject({ code: 'INVALID' })
    expect(validateImage).not.toHaveBeenCalled()
    expect(saveImage).not.toHaveBeenCalled()
  })
})
