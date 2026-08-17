/** Durable content-addressed RP package archive cache. @module @dsh-rp/registry-artifacts-local */
import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import type { RpPackageArtifactStore } from '@dsh-rp/registry'
import { RpRegistryError } from '@dsh-rp/registry'

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/u

/** Filesystem location and maximum accepted archive size. */
export interface Config {
  /** Private cache root; defaults beneath the resolved Harness home. */
  root?: string
  /** Maximum bytes accepted by either cache operation. */
  maxBytes?: number
}

export const Config: z<Config> = z.object({
  root: z.string().default(dshHomePath('rp', 'package-artifacts')),
  maxBytes: z.number().step(1).min(1).max(512 * 1024 * 1024).default(DEFAULT_MAX_BYTES),
})

/** Filesystem-backed archive store keyed by verified lowercase SHA-256. */
export class RpLocalPackageArtifactStore implements RpPackageArtifactStore {
  readonly id = 'local-content-addressed-v1'
  private readonly root: string

  /**
   * @param config - Cache root and archive size ceiling.
   */
  constructor(private readonly config: Required<Config>) {
    this.root = resolve(expandHomePath(config.root))
  }

  /**
   * Read and re-verify one immutable archive without following a final symlink.
   * @param sha256 - Expected lowercase SHA-256 content identity.
   * @returns Detached bytes, or undefined when the cache has no entry.
   */
  async get(sha256: string): Promise<Uint8Array | undefined> {
    const path = this.pathFor(sha256)
    let info
    try { info = await lstat(path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > this.config.maxBytes) {
      throw invalid(`Cached RP package ${sha256} is not a bounded regular file`)
    }
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    const handle = await open(path, constants.O_RDONLY | noFollow)
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.size > this.config.maxBytes) {
        throw invalid(`Cached RP package ${sha256} is not a bounded regular file`)
      }
      const bytes = new Uint8Array(await handle.readFile())
      if (digest(bytes) !== sha256) throw invalid(`Cached RP package ${sha256} failed content verification`)
      return bytes
    } finally {
      await handle.close()
    }
  }

  /**
   * Atomically publish one verified archive; an existing corrupt entry fails closed.
   * @param sha256 - Expected lowercase SHA-256 content identity.
   * @param bytes - Detached archive bytes to persist.
   * @returns Completion after the archive file has been flushed and renamed.
   */
  async put(sha256: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathFor(sha256)
    if (bytes.byteLength > this.config.maxBytes) throw invalid(`RP package ${sha256} exceeds the cache size limit`)
    if (digest(bytes) !== sha256) throw invalid(`RP package ${sha256} does not match its cache key`)
    await mkdir(join(this.root, sha256.slice(0, 2)), { recursive: true, mode: 0o700 })
    await withFileLock(path, async () => {
      if (await this.get(sha256) !== undefined) return
      const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(bytes)
        await handle.sync()
        await handle.close()
        await rename(temporary, path)
      } catch (error) {
        await handle.close().catch(() => {})
        await rm(temporary, { force: true })
        throw error
      }
    })
  }

  private pathFor(sha256: string): string {
    if (!SHA256.test(sha256)) throw invalid('RP artifact cache key must be lowercase SHA-256')
    return join(this.root, sha256.slice(0, 2), sha256)
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function invalid(message: string): RpRegistryError {
  return new RpRegistryError(message, 'INTEGRITY')
}

export const name = 'rp-registry-artifacts-local'
export const inject = ['rpRegistry']

/** Register one durable archive cache through the owning plugin Effect. */
export function apply(ctx: Context, config: Config): void {
  const store = new RpLocalPackageArtifactStore({
    root: resolve(expandHomePath(config.root ?? dshHomePath('rp', 'package-artifacts'))),
    maxBytes: config.maxBytes ?? DEFAULT_MAX_BYTES,
  })
  ctx.effect(() => ctx.rpRegistry.registerArtifactStore(store))
}
