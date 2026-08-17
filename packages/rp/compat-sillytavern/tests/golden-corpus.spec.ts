import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { encode as encodePngText } from 'png-chunk-text'
import {
  importCharacterCard,
  importCharacterCardCharx,
  importCharacterCardPng,
  importChat,
  importPreset,
  importWorldInfo,
} from '../src/index.ts'

interface CorpusCase {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'character-json' | 'world-info' | 'preset' | 'chat' | 'png' | 'charx'
  readonly input: unknown
  readonly inputSha256: string
  readonly expected: {
    readonly name: string
    readonly format: string
    readonly itemCount: number
    readonly disabledFeatures: readonly string[]
    readonly marker: string
    readonly transport?: 'png-chara' | 'png-ccv3' | 'charx'
  }
}

const corpus = JSON.parse(
  readFileSync(new URL('./fixtures/golden-corpus.json', import.meta.url), 'utf8'),
) as CorpusCase[]

describe('@dsh-rp/compat-sillytavern golden corpus', () => {
  it('keeps exactly 100 unique checked samples across all supported transports', () => {
    expect(corpus).toHaveLength(100)
    expect(new Set(corpus.map(item => item.id))).toHaveLength(100)
    expect(countKinds(corpus)).toEqual({
      'character-json': 30,
      'world-info': 15,
      preset: 15,
      chat: 20,
      png: 10,
      charx: 10,
    })
  })

  it.each(corpus)('imports golden sample $id without executing retained behavior', (sample) => {
    expect(sha256(JSON.stringify(sample.input))).toBe(sample.inputSha256)
    const options = { sourceId: sample.id, importedAt: 1 }
    if (sample.kind === 'character-json') {
      const result = importCharacterCard(JSON.stringify(sample.input), options)
      expect(result.character.name).toBe(sample.expected.name)
      expect(result.character.firstMessages).toHaveLength(sample.expected.itemCount)
      expect(result.character.compatibility?.source.format).toBe(sample.expected.format)
      expect(result.lore?.entries).toHaveLength(1)
      assertCompatibility(result.character.compatibility, sample)
    } else if (sample.kind === 'world-info') {
      const result = importWorldInfo(JSON.stringify(sample.input), options)
      expect(result.name).toBe(sample.expected.name)
      expect(result.entries).toHaveLength(sample.expected.itemCount)
      expect(result.compatibility?.source.format).toBe(sample.expected.format)
      assertCompatibility(result.compatibility, sample)
    } else if (sample.kind === 'preset') {
      const result = importPreset(JSON.stringify(sample.input), options)
      expect(result.name).toBe(sample.expected.name)
      expect(result.prompts).toHaveLength(sample.expected.itemCount)
      expect(result.compatibility.source.format).toBe(sample.expected.format)
      assertCompatibility(result.compatibility, sample)
    } else if (sample.kind === 'chat') {
      const rows = asArray(sample.input).map(row => JSON.stringify(row)).join('\n')
      const result = importChat(rows, options)
      expect(result.characterName).toBe(sample.expected.name)
      expect(result.messages).toHaveLength(sample.expected.itemCount)
      expect(result.compatibility.source.format).toBe(sample.expected.format)
      assertCompatibility(result.compatibility, sample)
    } else if (sample.kind === 'png') {
      const input = asRecord(sample.input)
      const keyword = input.keyword === 'ccv3' ? 'ccv3' : 'chara'
      const result = importCharacterCardPng(pngCard(asRecord(input.card), keyword), options)
      expect(result.transport).toBe(sample.expected.transport)
      expect(result.character.name).toBe(sample.expected.name)
      expect(result.assets).toHaveLength(sample.expected.itemCount)
      expect(result.character.compatibility?.source.format).toBe(sample.expected.format)
      assertCompatibility(result.character.compatibility, sample)
    } else {
      const input = asRecord(sample.input)
      const assetPath = String(input.assetPath)
      const archive = zipSync({
        'card.json': strToU8(JSON.stringify(input.card)),
        [assetPath]: Uint8Array.from(asArray(input.assetBytes).map(Number)),
      })
      const result = importCharacterCardCharx(archive, options)
      expect(result.transport).toBe(sample.expected.transport)
      expect(result.character.name).toBe(sample.expected.name)
      expect(result.assets).toHaveLength(sample.expected.itemCount)
      expect(result.character.compatibility?.source.format).toBe(sample.expected.format)
      assertCompatibility(result.character.compatibility, sample)
    }
  })
})

function assertCompatibility(
  compatibility: {
    readonly unknownFields: unknown
    readonly lossReport?: { readonly items: readonly { readonly feature: string }[] }
  } | undefined,
  sample: CorpusCase,
): void {
  expect(JSON.stringify(compatibility?.unknownFields)).toContain(sample.expected.marker)
  expect(compatibility?.lossReport?.items.map(item => item.feature)).toEqual(sample.expected.disabledFeatures)
}

function countKinds(items: readonly CorpusCase[]): Record<CorpusCase['kind'], number> {
  const counts: Record<CorpusCase['kind'], number> = {
    'character-json': 0, 'world-info': 0, preset: 0, chat: 0, png: 0, charx: 0,
  }
  for (const item of items) counts[item.kind] += 1
  return counts
}

function pngCard(card: Record<string, unknown>, keyword: 'chara' | 'ccv3'): Uint8Array {
  const text = encodePngText(keyword, Buffer.from(JSON.stringify(card)).toString('base64'))
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk(text.name, text.data),
    pngChunk('IEND', new Uint8Array()),
  ])
}

function pngChunk(name: string, data: Uint8Array): Buffer {
  const type = Buffer.from(name, 'ascii')
  const body = Buffer.from(data)
  const chunk = Buffer.alloc(12 + body.byteLength)
  chunk.writeUInt32BE(body.byteLength, 0)
  type.copy(chunk, 4)
  body.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([type, body])), 8 + body.byteLength)
  return chunk
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('corpus input must be an object')
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('corpus input must be an array')
  return value
}
