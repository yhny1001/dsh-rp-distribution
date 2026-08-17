/** Materialize exact published DSH Host package artifacts without installing their application dependency graphs. */

import {
  existsSync,
  globSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { execaSync } from 'execa'

interface Manifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  version?: unknown
}

const repositoryRoot = resolve(import.meta.dirname, '..')
const cacheScope = resolve(repositoryRoot, '.cache/host-sdk/node_modules/@deepseek-ai')
const workspaceScope = resolve(repositoryRoot, 'node_modules/@deepseek-ai')
const closurePath = resolve(repositoryRoot, '.cache/host-sdk/closure.json')
const unavailablePath = resolve(repositoryRoot, '.cache/host-sdk/unavailable.json')
const unavailable = process.env.DSH_HOST_SDK_REFRESH === '1' || !existsSync(unavailablePath)
  ? new Set<string>()
  : new Set(JSON.parse(readFileSync(unavailablePath, 'utf8')) as string[])
const required = new Map<string, string>()

for (const path of globSync('packages/rp/*/package.json', { cwd: repositoryRoot })) {
  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8')) as Manifest
  for (const [name, version] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue
    if (name === '@deepseek-ai/dsh-web-app') continue
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error(`${path}: Host SDK peer ${name} must use an exact version, got ${version}`)
    }
    const previous = required.get(name)
    if (previous !== undefined && previous !== version) {
      throw new Error(`Host SDK peer ${name} has conflicting versions ${previous} and ${version}`)
    }
    required.set(name, version)
  }
}

if (process.env.DSH_HOST_SDK_REFRESH !== '1' && existsSync(closurePath)) {
  const cachedClosure = JSON.parse(readFileSync(closurePath, 'utf8')) as Record<string, string>
  for (const [name, version] of Object.entries(cachedClosure)) {
    if (!required.has(name)) required.set(name, version)
  }
}

mkdirSync(cacheScope, { recursive: true })
mkdirSync(workspaceScope, { recursive: true })

const linked = new Set<string>()
for (;;) {
  const pending = [...required]
    .filter(([name]) => !linked.has(name))
    .sort(([left], [right]) => left.localeCompare(right))
  if (pending.length === 0) break

  for (const [name, version] of pending) {
    const unscoped = name.slice('@deepseek-ai/'.length)
    const target = resolve(cacheScope, unscoped)
    const cachedManifest = resolve(target, 'package.json')
    const cachedVersion = existsSync(cachedManifest)
      ? (JSON.parse(readFileSync(cachedManifest, 'utf8')) as Manifest).version
      : undefined

    if (cachedVersion !== version) {
      const temporary = mkdtempSync(join(tmpdir(), 'dsh-rp-host-sdk-'))
      try {
        const packed = execaSync('npm', ['pack', `${name}@${version}`, '--pack-destination', temporary], {
          cwd: repositoryRoot,
        }).stdout.trim().split('\n').at(-1)
        if (packed === undefined || packed === '') throw new Error(`npm pack returned no tarball for ${name}@${version}`)
        rmSync(target, { recursive: true, force: true })
        mkdirSync(target, { recursive: true })
        execaSync('tar', ['-xzf', resolve(temporary, packed), '--strip-components=1', '-C', target])
      } finally {
        rmSync(temporary, { recursive: true, force: true })
      }
    }

    const materialized = JSON.parse(readFileSync(cachedManifest, 'utf8')) as Manifest
    const runtimeEdges = { ...materialized.peerDependencies, ...materialized.dependencies }
    for (const [dependency, range] of Object.entries(runtimeEdges)
      .sort(([left], [right]) => left.localeCompare(right))) {
      if (!dependency.startsWith('@deepseek-ai/dsh-') || required.has(dependency)) continue
      const dependencyVersion = resolveRegistryVersion(dependency, range)
      if (dependencyVersion !== undefined) required.set(dependency, dependencyVersion)
    }

    const link = resolve(workspaceScope, unscoped)
    if (existsSync(link) || lstatExists(link)) {
      const stat = lstatSync(link)
      if (!stat.isSymbolicLink()) {
        const installed = resolve(link, 'package.json')
        const installedVersion = existsSync(installed)
          ? (JSON.parse(readFileSync(installed, 'utf8')) as Manifest).version
          : undefined
        if (installedVersion !== version) {
          throw new Error(`${link} is not an SDK link and carries version ${String(installedVersion)}, expected ${version}`)
        }
        linked.add(name)
        continue
      }
      const current = resolve(dirname(link), readlinkSync(link))
      if (current === target) {
        linked.add(name)
        continue
      }
      rmSync(link)
    }
    symlinkSync(process.platform === 'win32' ? target : relative(dirname(link), target), link,
      process.platform === 'win32' ? 'junction' : 'dir')
    linked.add(name)
  }
}

writeFileSync(closurePath, `${JSON.stringify(Object.fromEntries([...required].sort()), null, 2)}\n`)
console.log(`host SDK: ${String(required.size)} DSH package artifact(s) linked from npm tarballs`)

/** Whether lstat can observe a possibly dangling link. */
function lstatExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** Resolve one published version satisfying a Host package dependency range. */
function resolveRegistryVersion(name: string, range: string): string | undefined {
  const key = `${name}@${range}`
  if (unavailable.has(key)) return undefined
  const result = execaSync('npm', ['view', `${name}@${range}`, 'version', '--json'], { reject: false })
  if (result.failed) {
    console.warn(`host SDK: ${name}@${range} is not published; reachable imports remain test failures`)
    unavailable.add(key)
    writeFileSync(unavailablePath, `${JSON.stringify([...unavailable].sort(), null, 2)}\n`)
    return undefined
  }
  const output = result.stdout
  const value: unknown = JSON.parse(output)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const version = value.at(-1)
    if (typeof version === 'string') return version
  }
  throw new Error(`npm view returned no version for ${name}@${range}`)
}
