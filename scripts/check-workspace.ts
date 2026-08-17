/** Validate the package and dependency rules owned by the plugin-only workspace. */

import { globSync, readFileSync } from 'node:fs'

interface Manifest {
  name?: unknown
  version?: unknown
  private?: unknown
  repository?: { directory?: unknown }
  exports?: Record<string, unknown>
  files?: unknown
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: unknown } }
}

const manifests = globSync('packages/rp/*/package.json').sort()
const errors: string[] = []
const rootVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as Manifest).version
for (const path of manifests) {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest
  const directory = path.slice(0, -'/package.json'.length)
  if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@dsh-rp/')) {
    errors.push(`${path}: name must use the @dsh-rp scope`)
  }
  if (manifest.private === true) errors.push(`${path}: publishable plugin packages cannot be private`)
  if (manifest.version !== rootVersion) errors.push(`${path}: version must match workspace ${String(rootVersion)}`)
  if (manifest.repository?.directory !== directory) {
    errors.push(`${path}: repository.directory must be ${directory}`)
  }
  if (manifest.exports?.['./src/*'] !== undefined) errors.push(`${path}: published exports cannot expose src`)
  if (!Array.isArray(manifest.files) || manifest.files.some(file => typeof file === 'string' && file.startsWith('src'))) {
    errors.push(`${path}: files must select compiled output only`)
  }
  for (const [field, dependencies] of Object.entries({
    dependencies: manifest.dependencies,
    peerDependencies: manifest.peerDependencies,
    devDependencies: manifest.devDependencies,
  })) {
    for (const [name, range] of Object.entries(dependencies ?? {})) {
      if (name.startsWith('@dsh-rp/') && !range.startsWith('workspace:')) {
        errors.push(`${path}: ${field}.${name} must use workspace:`)
      }
      if (name.startsWith('@deepseek-ai/') && range.startsWith('workspace:')) {
        errors.push(`${path}: ${field}.${name} must resolve from the external Host registry`)
      }
      if (name.startsWith('@deepseek-ai/') && field === 'dependencies') {
        errors.push(`${path}: ${field}.${name} must be a Host peer, not an owned runtime dependency`)
      }
      if (name.startsWith('@deepseek-ai/') && field === 'peerDependencies'
        && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(range)) {
        errors.push(`${path}: ${field}.${name} must use one exact Host version`)
      }
    }
  }
  if (manifest.dsh?.bundle !== undefined && manifest.dsh.bundle.patch !== './cordis.patch.yml') {
    errors.push(`${path}: dsh.bundle.patch must be ./cordis.patch.yml`)
  }
}

if (manifests.length !== 56) errors.push(`expected 56 RP packages, found ${String(manifests.length)}`)
if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`workspace: ${String(manifests.length)} independently published RP packages conform`)
}
