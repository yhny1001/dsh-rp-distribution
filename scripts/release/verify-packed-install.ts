/**
 * Install packed tarballs into a throwaway consumer outside the repository and
 * drive the installed executable with plain Node.
 *
 * RP tarballs come from `--from`; peer installation stays disabled so the
 * artifact probe does not mistake an incomplete Host distribution for an RP
 * package failure.
 *
 * What this proves is that `files` selected a complete payload, internal RP
 * dependency ranges resolve, and the installed executable can bootstrap without
 * loading the Host. A workspace link or stale checkout output cannot stand in
 * for a missing file here.
 */

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { releaseFamily } from './families.ts'
import { capture, isEntry } from './process.ts'
import { packedIdentity } from './tarball.ts'

/**
 * Render the dependency root installed by the packed-artifact probe.
 * @param familyId - release family whose executable the probe drives.
 * @param packed - every locally packed package and its exact tarball URL.
 * @returns The private npm consumer manifest.
 */
export function packedConsumerManifest(
  familyId: string,
  packed: ReadonlyMap<string, { url: string; version: string }>,
) {
  return {
    name: `dsh-packed-install-${familyId}`,
    version: '0.0.0',
    private: true,
    dependencies: Object.fromEntries([...packed].map(([name, entryPacked]) => [name, entryPacked.url])),
  }
}

/**
 * Environment for the installed artifact: no host Node hooks, no host DeepSeek
 * Harness home, no host build-tool override, and a private npm cache.
 * @param consumerRoot - the throwaway consumer directory.
 * @param ambient - the host environment to isolate from.
 * @returns The child environment.
 */
export function consumerEnvironment(
  consumerRoot: string,
  ambient: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = { ...ambient }
  delete environment.npm_config_user_agent
  delete environment.NPM_CONFIG_USER_AGENT
  delete environment.NPM_CONFIG_CACHE
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  delete environment.ESBUILD_BINARY_PATH
  environment.npm_config_cache = resolve(consumerRoot, '.npm-cache')
  environment.DSH_HOME = resolve(consumerRoot, '.dsh')
  environment.DSH_AGENTS_HOME = resolve(consumerRoot, '.agents')
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
}

/**
 * Every packed tarball in the given directories, as `file:` dependency entries.
 *
 * The directories are read by their contents rather than a pack order file: a
 * directory here can hold tarballs packed only to satisfy a cross-sequence
 * dependency, which no release order describes.
 * @param directories - absolute directories holding packed tarballs.
 * @returns Package name to tarball file URL, and the version each carries.
 */
function packedDependencies(directories: readonly string[]): Map<string, { url: string; version: string }> {
  const dependencies = new Map<string, { url: string; version: string }>()
  for (const directory of directories) {
    const tarballs = readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()
    if (tarballs.length === 0) throw new Error(`${directory} holds no packed tarball`)
    for (const filename of tarballs) {
      const tarball = join(directory, filename)
      const { name, version } = packedIdentity(tarball)
      dependencies.set(name, { url: pathToFileURL(tarball).href, version })
    }
  }
  return dependencies
}

/**
 * Build npm arguments for the packed consumer on one platform.
 *
 * Linux release jobs omit optional Host-native packages; other platforms keep
 * matching prebuilt dependencies so the probe never builds foreign native code.
 *
 * @param platform - Node platform identifier.
 * @returns npm install arguments for that platform.
 */
export function packedInstallArguments(platform: NodeJS.Platform): string[] {
  const args = ['install', '--no-audit', '--no-fund', '--package-lock=false', '--legacy-peer-deps']
  if (platform === 'linux') args.push('--omit=optional')
  return args
}

/** Install every tarball under `--from` and drive the `--family` entry. */
function main(): void {
  const { values } = parseArgs({
    options: { family: { type: 'string' }, from: { type: 'string', multiple: true } },
    allowPositionals: false,
  })
  if (values.family === undefined || values.from === undefined || values.from.length === 0) {
    throw new Error('usage: verify-packed-install.ts --family rp --from <packed directory> [--from ...]')
  }

  const family = releaseFamily(values.family)
  const entry = family.installedEntry
  if (entry === undefined) {
    console.log(`release verify-packed-install: family ${family.id} publishes no executable, nothing to drive`)
    return
  }

  const root = process.cwd()
  const packed = packedDependencies(values.from.map(directory => resolve(root, directory)))
  const expected = packed.get(entry.packageName)
  if (expected === undefined) throw new Error(`${entry.packageName} is not among the packed tarballs`)

  const consumerRoot = mkdtempSync(join(tmpdir(), `dsh-packed-${family.id}-`))
  try {
    writeFileSync(
      join(consumerRoot, 'package.json'),
      `${JSON.stringify(packedConsumerManifest(family.id, packed), null, 2)}\n`,
    )

    const environment = consumerEnvironment(consumerRoot)
    console.log(`release verify-packed-install: installing ${String(packed.size)} tarball(s) into ${consumerRoot}`)
    // The platform policy keeps Linux independent from unpublished Landlock
    // binaries without stripping koffi's required prebuilds on other hosts.
    capture('npm', packedInstallArguments(process.platform),
      { cwd: consumerRoot, env: environment })

    const bin = join(consumerRoot, 'node_modules', ...entry.packageName.split('/'), entry.binPath)
    const version = capture(process.execPath, [bin, '--version'], { cwd: consumerRoot, env: environment })
    if (version !== expected.version) {
      throw new Error(`installed ${entry.packageName} --version reported ${JSON.stringify(version)}, expected ${expected.version}`)
    }
    console.log(`release verify-packed-install: installed ${entry.packageName} reports ${version}`)
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true })
  }
}

if (isEntry(import.meta.url)) main()
