/** Durable RP Registry installations and startup restoration. @module @dsh-rp/registry-durable */
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { RpPackageInstallation, RpRegistryInstallationStore } from '@dsh-rp/registry'
import type {} from '@dsh-rp/registry'
import z from 'zod'

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
const source = z.object({
  kind: z.enum(['local', 'git', 'npm', 'registry']),
  locator: z.string().min(1),
  ref: z.string().min(1).optional(),
}).strict()
const lockEntry = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  manifestHash: sha256,
  source,
  dependencies: z.array(z.string().min(1)),
  payloadSha256: sha256.optional(),
  signingKeyId: z.string().min(1).optional(),
  sbomSha256: sha256.optional(),
  evidenceVerified: z.boolean(),
}).strict()
const installation = z.object({
  schemaVersion: z.literal(1),
  rootId: z.string().min(1),
  source,
  lock: z.object({
    schemaVersion: z.literal(1),
    generatedAt: z.number().int().nonnegative(),
    graphHash: sha256,
    packages: z.array(lockEntry).min(1),
  }).strict(),
  installedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict() as z.ZodType<RpPackageInstallation>

/** Storage-domain schema containing one record per installed root. */
export const RP_REGISTRY_DOMAIN = defineDomain({
  name: 'dsh_rp_registry',
  version: 1,
  tables: { installations: domainTable<string, RpPackageInstallation>(installation) },
})

/** Storage Domain implementation of the Registry durability boundary. */
export class RpDomainRegistryInstallationStore implements RpRegistryInstallationStore {
  readonly id = 'storage-domain-v1'
  private readonly table: KvTable<string, RpPackageInstallation>
  private chain: Promise<void> = Promise.resolve()

  constructor(domain: Domain<typeof RP_REGISTRY_DOMAIN>) {
    this.table = domain.table('installations')
  }

  /** @returns Detached durable installations in root identity order. */
  async load(): Promise<readonly RpPackageInstallation[]> {
    await this.chain
    return Object.freeze([...this.table.entries()]
      .map(([, record]) => structuredClone(record))
      .sort((left, right) => left.rootId.localeCompare(right.rootId)))
  }

  /**
   * Durably publish one complete exact root lock.
   * @param record - Validated immutable installation.
   * @returns Completion after backend durability.
   */
  put(record: RpPackageInstallation): Promise<void> {
    return this.enqueue(async () => {
      await this.table.put(record.rootId, structuredClone(record))
    })
  }

  /**
   * Durably remove one root record.
   * @param rootId - Installed root identity.
   * @returns Completion after backend durability.
   */
  delete(rootId: string): Promise<void> {
    return this.enqueue(async () => {
      await this.table.delete(rootId)
    })
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const result = this.chain.then(job)
    this.chain = result.then(() => {}, () => {})
    return result
  }
}

export const name = 'rp-registry-durable'
export const inject = ['rpRegistry', 'storageDomain']

/** Open durable installation state, restore verified locks, and own both through one Effect. */
export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(RP_REGISTRY_DOMAIN)
  const store = new RpDomainRegistryInstallationStore(domain)
  const releaseStore = ctx.rpRegistry.registerInstallationStore(store)
  try {
    await ctx.rpRegistry.restoreInstallations()
    ctx.effect(() => async () => {
      releaseStore()
      await domain.close()
    })
  } catch (error: unknown) {
    releaseStore()
    await domain.close()
    throw error
  }
}
