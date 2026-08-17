/** DSH attachment-backed RP media-input Adapter. @module @dsh-rp/media-input-attachment */

import type { Context } from '@deepseek-ai/cordis'
import type {
  AttachmentStore,
  ImageAttachmentRef,
  ImageMediaType,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { JsonObject, MediaArtifact, RpModelMediaInput } from '@dsh-rp/contracts'
import {
  RpMediaInputError,
  type RpMediaInputAdapter,
  type RpMediaInputRequest,
} from '@dsh-rp/media'

const MEDIA_TYPES: readonly ImageMediaType[] = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/**
 * Create one content-addressed image ingress Adapter.
 * @param attachments - Deployment-owned immutable attachment store.
 * @returns L2 Adapter requiring explicit attachment-write authority.
 */
export function createAttachmentMediaInputAdapter(attachments: AttachmentStore): RpMediaInputAdapter {
  return Object.freeze({
    id: 'dsh-attachment',
    version: '1.0.0',
    title: 'DSH Image Attachment',
    trust: 'L2',
    permissions: Object.freeze(['attachment.write']),
    supports: (input: Parameters<RpMediaInputAdapter['supports']>[0]) =>
      input.kind === 'image' && isImageMediaType(input.mimeType),
    ingest: async (
      inputs: Parameters<RpMediaInputAdapter['ingest']>[0],
      signal: Parameters<RpMediaInputAdapter['ingest']>[1],
    ) => await ingestImages(attachments, inputs, signal),
    modelInput: (artifact: MediaArtifact) => modelInput(artifact),
  })
}

async function ingestImages(
  attachments: AttachmentStore,
  inputs: readonly RpMediaInputRequest[],
  signal?: AbortSignal,
): Promise<readonly MediaArtifact[]> {
  const limits = attachments.imageLimits
  if (inputs.length > limits.maxImagesPerMessage) {
    throw new RpMediaInputError('RP media input exceeds the configured image-count limit', 'INVALID')
  }
  const totalBytes = inputs.reduce((total, input) => total + input.data.byteLength, 0)
  if (totalBytes > limits.maxMessageImageBytes) {
    throw new RpMediaInputError('RP media input exceeds the configured aggregate image-byte limit', 'INVALID')
  }
  const prepared = inputs.map((input): SaveImageAttachment => {
    if (input.kind !== 'image' || !isImageMediaType(input.mimeType)) {
      throw new RpMediaInputError('DSH attachment Adapter accepts only supported raster images', 'INVALID')
    }
    return Object.freeze({
      data: Uint8Array.from(input.data),
      mediaType: input.mimeType,
      ...(input.name === undefined ? {} : { name: input.name }),
    })
  })
  for (const input of prepared) {
    throwIfAborted(signal)
    try { await attachments.validateImage(input) }
    catch (error: unknown) {
      throw new RpMediaInputError('RP media input image failed attachment validation', 'INVALID', { cause: error })
    }
  }
  const artifacts: MediaArtifact[] = []
  for (const input of prepared) {
    throwIfAborted(signal)
    const ref = await attachments.saveImage(input)
    artifacts.push(artifactFrom(ref))
  }
  return Object.freeze(artifacts)
}

function artifactFrom(ref: ImageAttachmentRef): MediaArtifact {
  const attachment: JsonObject = {
    attachmentId: String(ref.attachmentId),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...(ref.name === undefined ? {} : { name: ref.name }),
  }
  return Object.freeze({
    schemaVersion: 1,
    id: `input:${String(ref.attachmentId)}`,
    kind: 'image',
    mimeType: ref.mediaType,
    uri: `attachment:${String(ref.attachmentId)}`,
    metadata: Object.freeze({ source: 'user-input', attachment }),
  })
}

function modelInput(artifact: MediaArtifact): RpModelMediaInput | undefined {
  if (artifact.kind !== 'image' || !artifact.uri.startsWith('attachment:')) return undefined
  const raw = artifact.metadata?.attachment
  if (!isRecord(raw)) return undefined
  const { attachmentId, mediaType, bytes, width, height, name } = raw
  if (typeof attachmentId !== 'string' || `attachment:${attachmentId}` !== artifact.uri
    || typeof mediaType !== 'string' || mediaType !== artifact.mimeType || !isImageMediaType(mediaType)
    || !isPositiveInteger(bytes) || !isPositiveInteger(width) || !isPositiveInteger(height)
    || name !== undefined && (typeof name !== 'string' || name.trim() === '')) return undefined
  return Object.freeze({
    type: 'image',
    attachment: Object.freeze({
      attachmentId,
      mediaType,
      bytes,
      width,
      height,
      ...(typeof name === 'string' ? { name } : {}),
    }),
  })
}

function isImageMediaType(value: string): value is ImageMediaType {
  return MEDIA_TYPES.includes(value as ImageMediaType)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return
  throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'RP media input cancelled'))
}

/** Cordis plugin identity. */
export const name = 'rp-media-input-attachment'
/** Required media registry and immutable attachment backend. */
export const inject = ['rpMedia', 'attachments']

/**
 * Register the DSH attachment Adapter on the caller's reversible Cordis fiber.
 * @param ctx - Composed Host context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.rpMedia.registerInputAdapter(createAttachmentMediaInputAdapter(ctx.attachments)),
    'rp-media-input-attachment',
  )
}

/** Default Cordis plugin definition for declarative loaders. */
export default { name, inject, apply }
