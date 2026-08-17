/** Bump the one shared RP plugin version, refresh the lockfile, and commit the release state. */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { releaseFamily } from './families.ts'
import { capture, isEntry } from './process.ts'

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/

/** Resolve a release keyword or explicit version against the current plugin version. */
export function nextVersion(current: string, request: string): string {
  const currentMatch = VERSION.exec(current)
  if (currentMatch === null) throw new Error(`cannot parse current RP version ${current}`)
  if (request !== 'major' && request !== 'minor' && request !== 'patch') {
    if (!VERSION.test(request)) throw new Error(`invalid RP version ${request}`)
    return request
  }
  const major = Number(currentMatch[1])
  const minor = Number(currentMatch[2])
  const patch = Number(currentMatch[3])
  if (request === 'major') return `${String(major + 1)}.0.0`
  if (request === 'minor') return `${String(major)}.${String(minor + 1)}.0`
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`
}

/** Replace one manifest's exact current version. */
function writeVersion(path: string, current: string, target: string): void {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  if (manifest.version !== current) {
    throw new Error(`${path} changed version during release: expected ${current}, got ${String(manifest.version)}`)
  }
  manifest.version = target
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Execute the RP-only bump command. */
function main(): void {
  const { values, positionals } = parseArgs({
    options: {
      family: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })
  if (values.family !== 'rp' || positionals.length !== 1) {
    throw new Error('usage: release:rp <major|minor|patch|x.y.z> [--dry-run]')
  }
  const family = releaseFamily('rp')
  const root = process.cwd()
  const members = family.members(root)
  family.verifyVersions(members)
  const current = members[0]?.version
  if (current === undefined) throw new Error('RP release family is empty')
  const target = nextVersion(current, positionals[0]!)
  const manifests = ['package.json', ...members.map(member => join(member.directory, 'package.json'))]

  console.log(`release bump: rp ${current} -> ${target}`)
  if (values['dry-run']) return
  for (const path of manifests) writeVersion(join(root, path), current, target)
  capture('pnpm', ['install', '--lockfile-only'])
  capture('git', ['add', 'pnpm-lock.yaml', ...manifests])
  capture('git', ['commit', '-m', `release(rp): ${target}`])
  console.log(`release bump: committed; after merge, tag the merge commit as rp-v${target}`)
}

if (isEntry(import.meta.url)) main()
