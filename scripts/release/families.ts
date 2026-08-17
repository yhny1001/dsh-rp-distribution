/** Release membership, ordering, payload policy, and tag naming for the RP plugin family. */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateTarballPayload } from '../publication-payload.ts'

/** Dependency sections that constrain publish order: a consumer must publish after its dependency. */
const ORDER_SECTIONS = ['dependencies', 'optionalDependencies'] as const

/** The workspace root manifest, which is never a release member. */
const WORKSPACE_ROOT_PACKAGE = '@dsh-rp/workspace'

/** One publishable package of a release family. */
export interface ReleaseMember {
  /** Repository-relative package directory, for example `packages/rp/contracts`. */
  readonly directory: string
  /** Package name from its manifest. */
  readonly name: string
  /** Package version from its manifest. */
  readonly version: string
  /** The parsed manifest, for payload policy and publication checks. */
  readonly manifest: Readonly<Record<string, unknown>>
}

/**
 * Read and parse a JSON file.
 * @param path - absolute file path.
 * @returns The parsed object.
 */
function readManifest(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Read a required string field.
 * @param manifest - parsed manifest.
 * @param field - field name.
 * @param context - manifest path for the error message.
 * @returns The field value.
 */
function requireString(manifest: Record<string, unknown>, field: string, context: string): string {
  const value = manifest[field]
  if (typeof value !== 'string' || value === '') throw new Error(`${context} must declare a string ${field}`)
  return value
}

/** The executable a family's installed artifacts are driven through. */
export interface InstalledEntry {
  /** Package that carries the executable. */
  readonly packageName: string
  /** Path to the executable inside that package. */
  readonly binPath: string
}

/** A release sequence: its members, its version baseline, and its tag naming. */
export abstract class ReleaseFamily {
  /** Workflow-facing identifier, also the `--family` argument. */
  abstract readonly id: string

  /** Glob patterns, relative to the repository root, that select this family's manifests. */
  abstract readonly patterns: readonly string[]

  /** Git tag prefix this family publishes from. */
  abstract readonly tagPrefix: string

  /** Package-name prefixes this release sequence is authorized to publish. */
  abstract readonly packageNamePrefixes: readonly string[]

  /**
   * Whether one package name belongs to this release sequence.
   * @param name - Full npm package name.
   * @returns True when a declared family prefix owns the name.
   */
  acceptsPackageName(name: string): boolean {
    return this.packageNamePrefixes.some(prefix => name.startsWith(prefix))
  }

  /**
   * Discover this family's members.
   * @param root - repository root.
   * @returns Members sorted by directory, with names validated and deduplicated.
   */
  members(root: string): ReleaseMember[] {
    const manifestPaths = globSync([...this.patterns], { cwd: root }).sort()
    if (manifestPaths.length === 0) throw new Error(`release family ${this.id} matched no manifests`)

    const members: ReleaseMember[] = []
    const seen = new Set<string>()
    for (const manifestPath of manifestPaths) {
      const normalized = manifestPath.replaceAll('\\', '/')
      const manifest = readManifest(resolve(root, manifestPath))
      const name = requireString(manifest, 'name', normalized)
      const version = requireString(manifest, 'version', normalized)
      if (name === WORKSPACE_ROOT_PACKAGE) throw new Error(`${normalized} selected the workspace root`)
      if (!this.acceptsPackageName(name)) {
        throw new Error(`${normalized} must name a package under ${this.packageNamePrefixes.join(' or ')}`)
      }
      if (seen.has(name)) throw new Error(`${name} appears twice in release family ${this.id}`)
      seen.add(name)
      members.push({
        directory: normalized.slice(0, normalized.length - '/package.json'.length),
        name,
        version,
        manifest,
      })
    }
    return members
  }

  /**
   * Order members so every package publishes after the family members it depends on.
   * @param members - this family's members.
   * @returns The same members in publish order; ties break by name for determinism.
   */
  publishOrder(members: readonly ReleaseMember[]): ReleaseMember[] {
    const byName = new Map(members.map(member => [member.name, member]))
    const ordered: ReleaseMember[] = []
    const placed = new Set<string>()
    const visiting = new Set<string>()

    const visit = (member: ReleaseMember, path: readonly string[]): void => {
      if (placed.has(member.name)) return
      if (visiting.has(member.name)) {
        throw new Error(`dependency cycle in release family ${this.id}: ${[...path, member.name].join(' -> ')}`)
      }
      visiting.add(member.name)
      for (const dependency of this.orderEdges(member, byName)) {
        visit(dependency, [...path, member.name])
      }
      visiting.delete(member.name)
      placed.add(member.name)
      ordered.push(member)
    }

    for (const member of [...members].sort((left, right) => left.name.localeCompare(right.name))) {
      visit(member, [])
    }
    return ordered
  }

  /**
   * The family members one member depends on at runtime.
   * @param member - the dependent member.
   * @param byName - every family member by package name.
   * @returns Dependencies inside this family, sorted by name.
   */
  private orderEdges(member: ReleaseMember, byName: ReadonlyMap<string, ReleaseMember>): ReleaseMember[] {
    const edges: ReleaseMember[] = []
    for (const section of ORDER_SECTIONS) {
      const dependencies = member.manifest[section]
      if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue
      for (const name of Object.keys(dependencies)) {
        const dependency = byName.get(name)
        if (dependency !== undefined && dependency.name !== member.name) edges.push(dependency)
      }
    }
    return edges.sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Assert this family's version baseline holds across its members.
   * @param members - this family's members.
   */
  abstract verifyVersions(members: readonly ReleaseMember[]): void

  /**
   * The tag prefix a member's versions are tagged under. Every tag for that
   * member starts with it, which is how the last published version is found.
   * @param member - the member being published.
   * @returns The prefix, ending in `-v`.
   */
  abstract tagPrefixFor(member: ReleaseMember): string

  /**
   * The tag a member publishes from.
   * @param member - the member being published.
   * @returns The full tag name, without `refs/tags/`.
   */
  tagFor(member: ReleaseMember): string {
    return `${this.tagPrefixFor(member)}${member.version}`
  }

  /**
   * Check what a member's packed tarball carries.
   * @param member - the packed member.
   * @param files - every path inside its tarball.
   */
  abstract validatePayload(member: ReleaseMember, files: readonly string[]): void

  /**
   * The executable that proves this family's artifacts install and run, or
   * `undefined` for a family that publishes no executable.
   */
  abstract readonly installedEntry: InstalledEntry | undefined
}

/** RP plugin packages: one independently bumped version across `packages/rp/*`. */
class RpFamily extends ReleaseFamily {
  readonly id = 'rp'
  readonly patterns = ['packages/rp/*/package.json'] as const
  readonly tagPrefix = 'rp-v'
  readonly packageNamePrefixes = ['@dsh-rp/'] as const

  /** Require one version across the independently published plugin family. */
  verifyVersions(members: readonly ReleaseMember[]): void {
    const versions = new Set(members.map(member => member.version))
    if (versions.size !== 1) {
      const detail = members.map(member => `${member.directory}: ${member.version}`).join('\n')
      throw new Error(`rp release members must share one version:\n${detail}`)
    }
  }

  /** Every RP package in a release is named by the same `rp-v` tag. */
  tagPrefixFor(): string {
    return this.tagPrefix
  }

  /** Apply the same compiled-artifact publication policy as Harness packages. */
  validatePayload(member: ReleaseMember, files: readonly string[]): void {
    validateTarballPayload(files, member.name)
  }

  readonly installedEntry = { packageName: '@dsh-rp/cli', binPath: 'lib/bin.js' }
}

/** The only release family owned by this plugin repository. */
function releaseFamilies(): readonly ReleaseFamily[] {
  return [new RpFamily()]
}

/**
 * Resolve a family by its `--family` identifier.
 * @param id - family identifier.
 * @returns The family.
 */
export function releaseFamily(id: string): ReleaseFamily {
  const family = releaseFamilies().find(candidate => candidate.id === id)
  if (family === undefined) {
    const known = releaseFamilies().map(candidate => candidate.id).join(', ')
    throw new Error(`unknown release family ${id}; expected one of ${known}`)
  }
  return family
}

/**
 * The npm tarball filename `pnpm pack` writes for a member.
 * @param member - the packed member.
 * @returns The tarball filename.
 */
export function tarballName(member: ReleaseMember): string {
  const unscoped = member.name.startsWith('@') ? member.name.slice(1).replace('/', '-') : member.name
  return `${unscoped}-${member.version}.tgz`
}
