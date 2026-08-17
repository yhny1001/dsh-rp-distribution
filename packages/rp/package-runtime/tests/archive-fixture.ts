import { Buffer } from 'node:buffer'
import { gzipSync } from 'node:zlib'
import { pack } from 'tar-stream'

export interface RpTestArchiveEntry {
  readonly name: string
  readonly body?: string | Uint8Array
  readonly type?: 'file' | 'symlink'
  readonly linkname?: string
}

/** Build one deterministic-enough tar-gzip package fixture for runtime integration tests. */
export async function createRpTestArchive(entries: readonly RpTestArchiveEntry[]): Promise<Uint8Array> {
  const stream = pack()
  const chunks: Buffer[] = []
  const completed = new Promise<Buffer>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    stream.on('error', reject)
    stream.on('end', () => { resolve(Buffer.concat(chunks)) })
  })
  for (const entry of entries) {
    if (entry.type === 'symlink') {
      stream.entry({ name: entry.name, type: 'symlink', linkname: entry.linkname ?? 'target' })
    } else {
      const body = typeof entry.body === 'string' ? Buffer.from(entry.body) : Buffer.from(entry.body ?? [])
      stream.entry({ name: entry.name, type: 'file', size: body.byteLength }, body)
    }
  }
  stream.finalize()
  return gzipSync(await completed)
}
