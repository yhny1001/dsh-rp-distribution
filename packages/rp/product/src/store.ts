/** Atomic local storage for RP product catalogs and Session compositions. */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  bindSession,
  defaultProductState,
  normalizeEntity,
  normalizeProductState,
  removeEntity,
  upsertEntity,
  type ProductEntityKind,
  type ProductState,
} from './model.ts'

const STATE_FILE = 'product-state.json'

/** Resolve the product-owned directory under the active Harness home. */
export function productDataRoot(): string {
  const home = process.env.DSH_HOME?.trim()
  return join(resolve(home === undefined || home === '' ? join(homedir(), '.dsh') : home), 'rp-product')
}

/** Resolve the one durable state document shared by Host and Agent entries. */
export function productStatePath(): string { return join(productDataRoot(), STATE_FILE) }

/** Read the latest state synchronously for per-request system prompt assembly. */
export function readProductStateSync(): ProductState {
  const path = productStatePath()
  if (!existsSync(path)) return defaultProductState()
  return normalizeProductState(JSON.parse(readFileSync(path, 'utf8')) as unknown)
}

/** Serialized mutation owner for the local product state document. */
export class ProductStore {
  private mutationTail: Promise<void> = Promise.resolve()
  private state: ProductState

  private constructor(private readonly path: string, state: ProductState) { this.state = state }

  /** Open the product store, returning default content when no file exists. */
  static async open(path = productStatePath()): Promise<ProductStore> {
    let state = defaultProductState()
    try { state = normalizeProductState(JSON.parse(await readFile(path, 'utf8')) as unknown) }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return new ProductStore(path, state)
  }

  /** Return an immutable detached state snapshot. */
  snapshot(): ProductState { return structuredClone(this.state) }

  /** Create or update one catalog entity under optimistic revision control. */
  async upsert(kind: ProductEntityKind, value: unknown, baseRevision: number): Promise<ProductState> {
    return await this.mutate(() => upsertEntity(this.state, kind, normalizeEntity(kind, value), baseRevision))
  }

  /** Remove one catalog entity and repair every binding that referenced it. */
  async remove(kind: ProductEntityKind, id: string, baseRevision: number): Promise<ProductState> {
    return await this.mutate(() => removeEntity(this.state, kind, id, baseRevision))
  }

  /** Commit one Session's five-layer composition. */
  async bind(value: unknown, baseRevision: number): Promise<ProductState> {
    return await this.mutate(() => bindSession(this.state, value, baseRevision))
  }

  /** Commit a binding while serializing its cross-service activation and rollback. */
  async bindWithEffect(
    value: unknown,
    baseRevision: number,
    effect: (state: ProductState) => Promise<void>,
  ): Promise<ProductState> {
    let result: ProductState | undefined
    await this.enqueue(async () => {
      const previous = this.state
      const next = bindSession(previous, value, baseRevision)
      await writeAtomic(this.path, next)
      this.state = next
      try {
        await effect(structuredClone(next))
      } catch (error: unknown) {
        await writeAtomic(this.path, previous)
        this.state = previous
        throw error
      }
      result = structuredClone(next)
    })
    if (result === undefined) throw new Error('product binding effect completed without a state result')
    return result
  }

  private async mutate(factory: () => ProductState): Promise<ProductState> {
    let result: ProductState | undefined
    await this.enqueue(async () => {
      const next = factory()
      await writeAtomic(this.path, next)
      this.state = next
      result = structuredClone(next)
    })
    if (result === undefined) throw new Error('product mutation completed without a state result')
    return result
  }

  private async enqueue(task: () => Promise<void>): Promise<void> {
    const current = this.mutationTail.catch(() => undefined).then(task)
    this.mutationTail = current
    await current
  }
}

async function writeAtomic(path: string, state: ProductState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
