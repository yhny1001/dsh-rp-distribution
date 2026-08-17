/** Standalone RP plugin-development workflow. @module @dsh-rp/cli */

import { spawnSync } from 'node:child_process'
import { createPublicKey } from 'node:crypto'
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  buildRpPackage,
  createRpPackageManifest,
  createRpPackageSbom,
  createRpSigningKeyId,
  DEFAULT_RP_RUNTIME_ARCHIVE_LIMITS,
  hashRpPackageManifest,
  migrateRpPackageManifest,
  validateRpPackageManifest,
  verifyRpPackageIntegrity,
  verifyRpPackageSbom,
  verifyRpPackageSignature,
  type RpPackageBuild,
} from '@dsh-rp/sdk'
import type { JsonValue, RpPackageManifest } from '@dsh-rp/contracts'
import { RpCapabilityId, RpPipelineId } from '@dsh-rp/contracts'
import { evaluateRpSuite } from '@dsh-rp/eval'
import {
  parseRpRuntimeArchive,
  RP_RUNTIME_DESCRIPTOR,
  RP_RUNTIME_V1,
  type RpRuntimeArchiveFile,
  type RpRuntimeDescriptor,
} from '@dsh-rp/package-runtime'

const MANIFEST = 'rp.package.json'
const PAYLOAD = 'rp.package.tgz'
const SBOM = 'rp.sbom.json'
const EVAL_SUITE = 'rp.eval.json'
const RELEASE_DIRECTORY = join('dist', 'rp-release')
const MAX_JSON_BYTES = 4 * 1024 * 1024
const PACKAGE_VERSION = packageVersion()
const HELP = `dsh-rp — RP plugin SDK (also available through dsh rp)

Commands:
  init [directory] [opts]   create an executable MIT RP plugin scaffold
  validate [path] [opts]    validate source or packed Registry artifacts
  inspect [path]            print normalized package metadata
  migrate [path] [--write]  migrate schema v0 to v1 (stdout by default)
  build [directory] [opts]  run an optional build script, then emit a verified release
  test [directory] [opts]   strict-build in memory, then run an optional test script
  pack [directory] [opts]   emit rp.package.json, rp.package.tgz, and rp.sbom.json
  sbom [path]               print a CycloneDX-style package SBOM
  install <source> [opts]   commit a package through the running Host Registry
  update <source> [opts]    replace an installed root through the Host Registry
  uninstall <root> [opts]   remove an installed root through the Host Registry
  publish [directory] [opts] build and publish to npm or an open RP Registry

Release options:
  --template <kind>         init template: echo, orchestration, quickjs-critic, or ui-panel
  --out <directory>         release output (default: dist/rp-release)
  --sign-key <pem>          Ed25519 private key; required for trust L2
  --key-id <id>             publisher key id (derived from the key when omitted)
  --verify-key <pem>        trusted Ed25519 public key for signed validation
  --registry <origin>       publish to a self-hosted RP Registry instead of npm

Registry mutation options:
  --host <origin>           Host API origin (default: http://127.0.0.1:3080)
`

/** Execute one RP SDK command and return a process exit code. */
export async function runRpCli(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args
  try {
    switch (command) {
      case undefined:
      case '-h':
      case '--help':
        process.stdout.write(HELP)
        return 0
      case '-v':
      case '--version':
        process.stdout.write(`${PACKAGE_VERSION}\n`)
        return 0
      case 'init': return init(rest)
      case 'validate': return await validate(rest)
      case 'inspect': return inspect(rest)
      case 'migrate': return migrate(rest)
      case 'build': return await build(rest)
      case 'test': return await test(rest)
      case 'pack': return await packRelease(rest)
      case 'sbom': return sbom(rest)
      case 'install': return await registryMutation('install', rest)
      case 'update': return await registryMutation('update', rest)
      case 'uninstall': return await registryMutation('uninstall', rest)
      case 'publish': return await publish(rest)
      default:
        throw new Error(`unknown RP command ${JSON.stringify(command)}; run 'dsh-rp --help'`)
    }
  } catch (error: unknown) {
    process.stderr.write(`dsh-rp: ${renderError(error)}\n`)
    return 1
  }
}

function packageVersion(): string {
  const value: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const version = (value as { version?: unknown }).version
  if (typeof version !== 'string' || version === '') throw new Error('@dsh-rp/cli package.json has no version')
  return version
}

function sbom(args: readonly string[]): number {
  if (args.length > 1) throw new Error('sbom takes at most one path')
  const { value } = readManifest(args[0])
  const result = validateRpPackageManifest(value)
  if (!result.valid || result.manifest === undefined) throw new Error(result.diagnostics.map(item => `${item.path}: ${item.message}`).join('; '))
  process.stdout.write(`${JSON.stringify(createRpPackageSbom(result.manifest), undefined, 2)}\n`)
  return 0
}

function init(args: readonly string[]): number {
  const options = initOptions(args)
  const dir = resolve(options.directory ?? '.')
  const path = join(dir, MANIFEST)
  if (existsSync(path)) throw new Error(`${path} already exists`)
  const descriptorPath = join(dir, RP_RUNTIME_DESCRIPTOR)
  if (existsSync(descriptorPath)) throw new Error(`${descriptorPath} already exists`)
  const inferred = safePackageName(basename(dir))
  const scaffold = rpScaffold(inferred, options.template)
  const { manifest, descriptor } = scaffold
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`, { flag: 'wx' })
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, undefined, 2)}\n`, { flag: 'wx' })
  for (const file of scaffold.files) {
    const filePath = join(dir, file.path)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, file.content, { flag: 'wx' })
  }
  const packagePath = join(dir, 'package.json')
  if (!existsSync(packagePath)) {
    writeFileSync(packagePath, `${JSON.stringify({
      name: inferred,
      version: manifest.version,
      type: 'module',
      license: 'MIT',
      files: [PAYLOAD, SBOM],
      dshRp: manifest,
    }, undefined, 2)}\n`, { flag: 'wx' })
  }
  process.stdout.write(`Created ${options.template} ${inferred} at ${dir}\n`)
  return 0
}

type RpInitTemplate = 'echo' | 'orchestration' | 'quickjs-critic' | 'ui-panel'

function initOptions(args: readonly string[]): {
  readonly directory?: string
  readonly template: RpInitTemplate
} {
  let directory: string | undefined
  let template: RpInitTemplate = 'echo'
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string
    if (argument === '--template') {
      const value = args[index + 1]
      if (value !== 'echo' && value !== 'orchestration' && value !== 'quickjs-critic' && value !== 'ui-panel') {
        throw new Error('--template must be echo, orchestration, quickjs-critic, or ui-panel')
      }
      template = value
      index += 1
    } else if (argument.startsWith('--')) throw new Error(`unsupported init option ${JSON.stringify(argument)}`)
    else if (directory === undefined) directory = argument
    else throw new Error('init takes at most one directory')
  }
  return Object.freeze({ ...(directory === undefined ? {} : { directory }), template })
}

function rpScaffold(
  id: string,
  template: RpInitTemplate,
): {
  readonly manifest: RpPackageManifest
  readonly descriptor: RpRuntimeDescriptor
  readonly files: readonly { readonly path: string; readonly content: string }[]
} {
  const prefix = id.replace(/[^a-z0-9._-]+/gu, '-')
  if (template === 'ui-panel') {
    return {
      manifest: {
        ...createRpPackageManifest(id),
        uiSlots: ['overview-panel'],
        assets: ['ui/index.html', 'ui/styles.css'],
        compatibility: { runtime: RP_RUNTIME_V1 },
      },
      descriptor: {
        schemaVersion: 1,
        components: [],
        capabilities: [],
        uiSlots: [{
          schemaVersion: 1,
          id: 'overview-panel',
          title: 'RP Overview Panel',
          placement: 'studio.overview',
          entry: 'ui/index.html',
          assets: ['ui/index.html', 'ui/styles.css'],
          script: 'none',
          height: 240,
        }],
      },
      files: [
        {
          path: 'ui/index.html',
          content: '<!doctype html>\n<html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><main><p class="eyebrow">INSTALLABLE UI SLOT</p><h1>Everything is Plugin</h1><p>This panel runs in an opaque-origin iframe with no script or network authority.</p></main></body></html>\n',
        },
        {
          path: 'ui/styles.css',
          content: ':root{color-scheme:dark;font-family:system-ui,sans-serif}body{margin:0;color:#e8edf6;background:#151827}main{padding:24px}.eyebrow{color:#9fa8ff;font-size:11px;letter-spacing:.14em}h1{margin:.25rem 0;font-size:24px}p{line-height:1.55}\n',
        },
      ],
    }
  }
  if (template === 'orchestration') {
    const actor = RpCapabilityId(`${prefix}.actor`)
    const memory = RpCapabilityId(`${prefix}.memory`)
    const turn = RpPipelineId(`${prefix}.turn`)
    const turnCapability = RpCapabilityId(String(turn))
    return {
      manifest: {
        ...createRpPackageManifest(id),
        capabilities: [actor, memory, turnCapability],
        compatibility: { runtime: RP_RUNTIME_V1 },
      },
      descriptor: {
        schemaVersion: 1,
        components: [],
        capabilities: [
          {
            id: actor, kind: 'agent', title: 'Actor', description: 'Deterministic L0 Actor.',
            scopes: ['conversation'], implementation: { kind: 'expression', expression: { op: 'input' } },
          },
          {
            id: memory, kind: 'memory', title: 'Memory', description: 'Deterministic L0 Memory.',
            scopes: ['conversation'], implementation: { kind: 'expression', expression: { op: 'input' } },
          },
          {
            id: turnCapability, kind: 'pipeline', title: 'Turn Pipeline',
            description: 'Actor and Memory composed as a code-free DAG.', scopes: ['conversation'],
          },
        ],
        pipelines: [{
          id: turn, kind: 'turn', description: 'Actor then Memory.', stages: [
            { id: 'actor', operation: { kind: 'invoke-capability', capabilityId: String(actor) } },
            {
              id: 'memory', after: ['actor'],
              operation: { kind: 'invoke-capability', capabilityId: String(memory), inputKey: 'stage.actor.result' },
            },
          ],
        }],
      },
      files: [],
    }
  }
  if (template === 'quickjs-critic') {
    const critic = RpCapabilityId(`${prefix}.critic`)
    const workflow = RpPipelineId(`${prefix}.workflow`)
    const workflowCapability = RpCapabilityId(String(workflow))
    return {
      manifest: {
        ...createRpPackageManifest(id),
        trust: 'L1',
        capabilities: [critic, workflowCapability],
        permissions: ['script.execute'],
        compatibility: { runtime: RP_RUNTIME_V1 },
      },
      descriptor: {
        schemaVersion: 1,
        components: [],
        capabilities: [
          {
            id: critic, kind: 'agent', title: 'Continuity Critic', description: 'Sandboxed QuickJS Critic.',
            scopes: ['conversation'], permissions: ['script.execute'],
            implementation: { kind: 'quickjs', path: 'runtime/critic.js' },
          },
          {
            id: workflowCapability, kind: 'pipeline', title: 'Critic Workflow',
            description: 'Runs the sandboxed Critic.', scopes: ['conversation'], permissions: ['script.execute'],
          },
        ],
        pipelines: [{
          id: workflow, kind: 'workflow', description: 'Sandboxed Critic workflow.', stages: [{
            id: 'critic',
            operation: {
              kind: 'invoke-capability', capabilityId: String(critic),
              grantedPermissions: ['script.execute'], grantedTrust: 'L1',
            },
          }],
        }],
      },
      files: [{ path: 'runtime/critic.js', content: "({ role: 'continuity-critic', input })\n" }],
    }
  }
  const capability = RpCapabilityId(`${prefix}.echo`)
  return {
    manifest: {
      ...createRpPackageManifest(id),
      capabilities: [capability],
      compatibility: { runtime: RP_RUNTIME_V1 },
    },
    descriptor: {
      schemaVersion: 1,
      components: [],
      capabilities: [{
        id: capability,
        kind: 'tool',
        title: 'Echo',
        description: 'Returns the invocation input through the deterministic L0 engine.',
        scopes: ['conversation'],
        implementation: { kind: 'expression', expression: { op: 'input' } },
      }],
    },
    files: [],
  }
}

async function validate(args: readonly string[]): Promise<number> {
  const options = validationOptions(args)
  const { path, value } = readManifest(options.path)
  const result = validateRpPackageManifest(value)
  if (!result.valid || result.manifest === undefined) {
    for (const item of result.diagnostics) process.stderr.write(`${path}:${item.path}: ${item.message}\n`)
    return 1
  }
  const manifest = result.manifest
  const dir = dirname(path)
  if (manifest.integrity?.sha256 !== undefined && options.signKey !== undefined) {
    throw new Error('--sign-key is only valid when validating source files without finalized integrity')
  }
  if (manifest.integrity?.sha256 !== undefined) {
    const archive = readBoundedBytes(join(dir, PAYLOAD), DEFAULT_RP_RUNTIME_ARCHIVE_LIMITS.maxUnpackedBytes)
    if (!verifyRpPackageIntegrity(archive, manifest)) throw new Error(`${PAYLOAD} does not match Manifest SHA-256`)
    if (manifest.integrity.sbom !== undefined) {
      const packageSbom = readJsonValue(join(dir, SBOM))
      if (!verifyRpPackageSbom(packageSbom, manifest)) throw new Error(`${SBOM} does not match Manifest SBOM hash`)
    }
    await parseRpRuntimeArchive(archive, manifest, DEFAULT_RP_RUNTIME_ARCHIVE_LIMITS)
  } else if (manifest.compatibility?.runtime === RP_RUNTIME_V1) {
    const signing = options.signKey === undefined ? undefined : signingAuthority(options.signKey, options.keyId)
    await buildProject(dir, signing)
  }
  if (manifest.integrity?.signature !== undefined) {
    if (options.verifyKey === undefined) throw new Error('signed RP packages require --verify-key for CLI validation')
    const publicKey = Buffer.from(readBoundedBytes(options.verifyKey, 1024 * 1024))
    if (!verifyRpPackageSignature(manifest, publicKey)) throw new Error('RP package signature is invalid for --verify-key')
  } else if (options.verifyKey !== undefined) throw new Error('--verify-key was supplied for an unsigned RP package')
  process.stdout.write(`valid ${manifest.id} sha256:${result.sha256}\n`)
  return 0
}

function validationOptions(args: readonly string[]): {
  readonly path?: string
  readonly verifyKey?: string
  readonly signKey?: string
  readonly keyId?: string
} {
  let path: string | undefined
  let verifyKey: string | undefined
  let signKey: string | undefined
  let keyId: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string
    if (argument === '--verify-key' || argument === '--sign-key' || argument === '--key-id') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      if (argument === '--verify-key') verifyKey = resolve(value)
      else if (argument === '--sign-key') signKey = resolve(value)
      else keyId = value
      index += 1
    } else if (argument.startsWith('--')) throw new Error(`unsupported validate option ${JSON.stringify(argument)}`)
    else if (path === undefined) path = argument
    else throw new Error('validate takes at most one path')
  }
  if (keyId !== undefined && signKey === undefined) throw new Error('--key-id requires --sign-key')
  if (verifyKey !== undefined && signKey !== undefined) throw new Error('--verify-key and --sign-key cannot be combined')
  return Object.freeze({
    ...(path === undefined ? {} : { path }),
    ...(verifyKey === undefined ? {} : { verifyKey }),
    ...(signKey === undefined ? {} : { signKey }),
    ...(keyId === undefined ? {} : { keyId }),
  })
}

function inspect(args: readonly string[]): number {
  if (args.length > 1) throw new Error('inspect takes at most one path')
  const { value } = readManifest(args[0])
  const result = validateRpPackageManifest(value)
  if (!result.valid || result.manifest === undefined) {
    throw new Error(result.diagnostics.map(item => `${item.path}: ${item.message}`).join('; '))
  }
  process.stdout.write(`${JSON.stringify({ ...result.manifest, sha256: result.sha256 }, undefined, 2)}\n`)
  return 0
}

function migrate(args: readonly string[]): number {
  const write = args.includes('--write')
  const positional = args.filter(argument => argument !== '--write')
  if (positional.length > 1) throw new Error('migrate takes at most one path plus --write')
  const { path, value } = readManifest(positional[0])
  const manifest = migrateRpPackageManifest(value)
  const rendered = `${JSON.stringify(manifest, undefined, 2)}\n`
  if (write) {
    writeFileSync(path, rendered)
    process.stdout.write(`Migrated ${path} to schemaVersion 1 (sha256:${hashRpPackageManifest(manifest)})\n`)
  } else {
    process.stdout.write(rendered)
  }
  return 0
}

async function build(args: readonly string[]): Promise<number> {
  const options = releaseOptions(args)
  assertValidDirectory(options.dir)
  const script = runOptionalPackageScript('build', options.dir)
  if (script !== 0) return script
  await emitRelease(options)
  return 0
}

async function test(args: readonly string[]): Promise<number> {
  const options = releaseOptions(args)
  const signing = options.signKey === undefined ? undefined : signingAuthority(options.signKey, options.keyId)
  await buildProject(options.dir, signing)
  const evalPath = join(options.dir, EVAL_SUITE)
  if (existsSync(evalPath)) {
    const report = evaluateRpSuite(readJsonValue(evalPath))
    for (const diagnostic of report.diagnostics) {
      process.stderr.write(`${EVAL_SUITE}:${diagnostic.path}: ${diagnostic.message}\n`)
    }
    for (const scenario of report.scenarios) {
      for (const diagnostic of scenario.diagnostics) {
        process.stderr.write(`${EVAL_SUITE}:${scenario.id}:${diagnostic.path}: ${diagnostic.message}\n`)
      }
    }
    if (!report.passed) return 1
    process.stdout.write(`RP eval: ${report.scenarios.length} scenario(s) passed\n`)
  }
  const status = runOptionalPackageScript('test', options.dir)
  if (status === 0) process.stdout.write(`Verified runtime package at ${options.dir}\n`)
  return status
}

async function packRelease(args: readonly string[]): Promise<number> {
  await emitRelease(releaseOptions(args))
  return 0
}

async function publish(args: readonly string[]): Promise<number> {
  const options = releaseOptions(args)
  const release = await emitRelease(options)
  if (options.registry !== undefined) return await publishToRegistry(release, options.registry)
  return spawnPackageManager(['publish', options.out, '--access', 'public'], options.dir)
}

interface ReleaseOptions {
  readonly dir: string
  readonly out: string
  readonly signKey?: string
  readonly keyId?: string
  readonly registry?: URL
}

function releaseOptions(args: readonly string[]): ReleaseOptions {
  let directory: string | undefined
  let out: string | undefined
  let signKey: string | undefined
  let keyId: string | undefined
  let registry: URL | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string
    if (argument === '--out' || argument === '--sign-key' || argument === '--key-id' || argument === '--registry') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--') || value.trim() === '') throw new Error(`${argument} requires a value`)
      if (argument === '--out') out = value
      else if (argument === '--sign-key') signKey = value
      else if (argument === '--key-id') keyId = value
      else registry = rpRegistryOrigin(value)
      index += 1
    } else if (argument.startsWith('--')) {
      throw new Error(`unsupported release option ${JSON.stringify(argument)}`)
    } else if (directory === undefined) directory = argument
    else throw new Error('release commands take at most one directory')
  }
  if (keyId !== undefined && signKey === undefined) throw new Error('--key-id requires --sign-key')
  const dir = resolve(directory ?? '.')
  const releaseOut = resolve(dir, out ?? RELEASE_DIRECTORY)
  if (releaseOut === dir || !within(dir, releaseOut)) {
    throw new Error('release output must be a child of the RP package directory')
  }
  return Object.freeze({
    dir,
    out: releaseOut,
    ...(signKey === undefined ? {} : { signKey: resolve(signKey) }),
    ...(keyId === undefined ? {} : { keyId }),
    ...(registry === undefined ? {} : { registry }),
  })
}

async function emitRelease(options: ReleaseOptions): Promise<RpPackageBuild> {
  const sourceManifest = assertValidDirectory(options.dir)
  if (sourceManifest.trust === 'L2' && options.signKey === undefined) {
    throw new Error('trust L2 releases require --sign-key')
  }
  const signing = options.signKey === undefined ? undefined : signingAuthority(options.signKey, options.keyId)
  const release = await buildProject(options.dir, signing)
  const parent = dirname(options.out)
  mkdirSync(parent, { recursive: true })
  const canonicalRoot = realpathSync(options.dir)
  const canonicalParent = realpathSync(parent)
  if (!within(canonicalRoot, canonicalParent)) throw new Error('release output parent escapes the RP package directory')
  const target = join(canonicalParent, basename(options.out))
  if (existsSync(target)) {
    const info = lstatSync(target)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('release output must be a real directory')
  }
  const staging = mkdtempSync(join(canonicalParent, `.${basename(target)}-stage-`))
  const backup = `${staging}.previous`
  try {
    writeFileSync(join(staging, PAYLOAD), release.archive)
    writeFileSync(join(staging, SBOM), `${JSON.stringify(release.sbom, undefined, 2)}\n`)
    writeFileSync(join(staging, MANIFEST), `${JSON.stringify(release.manifest, undefined, 2)}\n`)
    writeFileSync(join(staging, 'package.json'), `${JSON.stringify({
      name: String(release.manifest.id),
      version: release.manifest.version,
      type: 'module',
      license: 'MIT',
      files: [PAYLOAD, SBOM],
      dshRp: release.manifest,
    }, undefined, 2)}\n`)
    if (existsSync(target)) renameSync(target, backup)
    try { renameSync(staging, target) }
    catch (error: unknown) {
      if (existsSync(backup) && !existsSync(target)) renameSync(backup, target)
      throw error
    }
    removeReleaseResidue(backup)
  } finally {
    removeReleaseResidue(staging)
  }
  process.stdout.write(`Packed ${release.manifest.id}@${release.manifest.version} to ${target}\n`)
  return release
}

async function publishToRegistry(release: RpPackageBuild, origin: URL): Promise<number> {
  const token = process.env.DSH_RP_REGISTRY_TOKEN
  if (token === undefined || token === '') {
    throw new Error('Registry publication requires DSH_RP_REGISTRY_TOKEN')
  }
  const response = await fetch(new URL('/api/rp/v1/releases', origin), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      manifest: release.manifest,
      payloadBase64: Buffer.from(release.archive).toString('base64'),
      sbom: release.sbom,
    }),
  })
  const result = await readBoundedResponseJson(response, 1024 * 1024)
  if (!response.ok) {
    const message = isRecord(result) && typeof result.error === 'string' ? result.error : `HTTP ${response.status}`
    throw new Error(`RP Registry rejected publication: ${message}`)
  }
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
  return 0
}

function rpRegistryOrigin(value: string): URL {
  const url = registryHostOrigin(value)
  return new URL(url.origin)
}

function removeReleaseResidue(path: string): void {
  if (!existsSync(path)) return
  try { rmSync(path, { recursive: true, force: true }) }
  catch (error: unknown) { process.stderr.write(`dsh-rp: warning: cannot remove release residue ${path}: ${renderError(error)}\n`) }
}

function signingAuthority(path: string, keyId?: string): { readonly privateKey: Buffer; readonly keyId: string } {
  const privateKey = readFileSync(path)
  if (privateKey.byteLength > 1024 * 1024) throw new Error('RP signing key exceeds 1 MiB')
  return {
    privateKey,
    keyId: keyId ?? createRpSigningKeyId(createPublicKey(privateKey)),
  }
}

function runOptionalPackageScript(script: string, dir: string): number {
  const packagePath = join(dir, 'package.json')
  if (!existsSync(packagePath)) return 0
  const manifest = readJson(packagePath)
  if (!isRecord(manifest.scripts) || typeof manifest.scripts[script] !== 'string') return 0
  return spawnPackageManager(['run', script], dir)
}

async function registryMutation(
  action: 'install' | 'update' | 'uninstall',
  args: readonly string[],
): Promise<number> {
  let target: string | undefined
  let host = process.env.DSH_RP_HOST ?? 'http://127.0.0.1:3080'
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string
    if (argument === '--host') {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('--host requires an origin')
      host = value
      index += 1
    } else if (argument.startsWith('--')) throw new Error(`unsupported Registry option ${JSON.stringify(argument)}`)
    else if (target === undefined) target = argument
    else throw new Error(`${action} takes exactly one source or root id`)
  }
  if (target === undefined || target.trim() === '') throw new Error(`${action} requires one source or root id`)
  const origin = registryHostOrigin(host)
  const body = action === 'uninstall'
    ? { action, rootId: target }
    : { action, source: target }
  const response = await fetch(new URL('/api/rp/v1/registry', origin), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      origin: origin.origin,
    },
    body: JSON.stringify(body),
  })
  const result = await readBoundedResponseJson(response, 1024 * 1024)
  if (!response.ok) {
    const message = isRecord(result) && typeof result.error === 'string' ? result.error : `HTTP ${response.status}`
    throw new Error(`Host Registry rejected ${action}: ${message}`)
  }
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
  return 0
}

function registryHostOrigin(value: string): URL {
  const url = new URL(value)
  const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
  if (url.protocol !== 'https:' && !loopback) throw new Error('RP Host must use HTTPS unless it is loopback')
  if (url.username !== '' || url.password !== '') throw new Error('RP Host URL must not contain credentials')
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') throw new Error('RP Host must be an origin without a path, query, or fragment')
  return url
}

async function readBoundedResponseJson(response: Response, maxBytes: number): Promise<unknown> {
  if (response.body === null) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`Host Registry response exceeds ${maxBytes} bytes`)
      }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  catch (error: unknown) { throw new Error(`Host Registry returned invalid JSON: ${renderError(error)}`) }
}

async function buildProject(
  dir: string,
  signing?: { readonly privateKey: Buffer; readonly keyId: string },
): ReturnType<typeof buildRpPackage> {
  const manifest = assertValidDirectory(dir)
  if (manifest.compatibility?.runtime !== RP_RUNTIME_V1) {
    throw new Error(`${MANIFEST} must declare compatibility.runtime ${JSON.stringify(RP_RUNTIME_V1)}`)
  }
  const descriptorValue: unknown = readJson(join(dir, RP_RUNTIME_DESCRIPTOR))
  const descriptor = descriptorValue as RpRuntimeDescriptor
  const files = collectProjectFiles(dir, manifest, descriptor)
  return await buildRpPackage({ manifest, descriptor, files }, signing === undefined ? {} : { signing })
}

function collectProjectFiles(
  dir: string,
  manifest: RpPackageManifest,
  descriptor: RpRuntimeDescriptor,
): readonly RpRuntimeArchiveFile[] {
  const paths = new Set<string>(manifest.assets ?? [])
  for (const capability of descriptor.capabilities) {
    const implementation = capability.implementation
    if (implementation !== undefined && implementation.kind !== 'expression') paths.add(implementation.path)
  }
  return Object.freeze([...paths].sort().map(path => Object.freeze({
    path,
    bytes: readProjectFile(dir, path),
  })))
}

function readProjectFile(dir: string, path: string): Uint8Array {
  if (path === '' || isAbsolute(path) || path.includes('\\')) throw new Error(`unsafe RP package path ${JSON.stringify(path)}`)
  const root = realpathSync(dir)
  const target = realpathSync(resolve(root, path))
  if (!within(root, target)) throw new Error(`RP package path ${JSON.stringify(path)} escapes the project root`)
  return readBoundedBytes(target, DEFAULT_RP_RUNTIME_ARCHIVE_LIMITS.maxFileBytes)
}

function assertValidDirectory(dir: string): RpPackageManifest {
  const { value } = readManifest(dir)
  const result = validateRpPackageManifest(value)
  if (!result.valid || result.manifest === undefined) {
    throw new Error(result.diagnostics.map(item => `${item.path}: ${item.message}`).join('; '))
  }
  return result.manifest
}

function readManifest(input?: string): { path: string; value: unknown } {
  const target = resolve(input ?? '.')
  const path = existsSync(target) && statSync(target).isDirectory() ? join(target, MANIFEST) : target
  return { path, value: readJson(path) }
}

function readJson(path: string): Record<string, unknown> {
  const value = readJsonUnknown(path)
  if (!isRecord(value)) throw new Error(`${path} must contain a JSON object`)
  return value
}

function readJsonValue(path: string): JsonValue {
  const value = readJsonUnknown(path)
  if (!isJsonValue(value)) throw new Error(`${path} must contain finite JSON data`)
  return value
}

function readJsonUnknown(path: string): unknown {
  try {
    const info = statSync(path)
    if (!info.isFile() || info.size > MAX_JSON_BYTES) throw new Error('must be a bounded regular JSON file')
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error: unknown) {
    throw new Error(`cannot read ${path}: ${renderError(error)}`)
  }
}

function readBoundedBytes(path: string, limit: number): Uint8Array {
  const info = statSync(path)
  if (!info.isFile() || info.size > limit) throw new Error(`${path} must be a regular file no larger than ${limit} bytes`)
  return new Uint8Array(readFileSync(path))
}

function spawnPackageManager(args: readonly string[], cwd: string): number {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(executable, [...args], { cwd, stdio: 'inherit', shell: false })
  if (result.error !== undefined) throw result.error
  return result.status ?? 1
}

function safePackageName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized === '' ? 'rp-plugin' : normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function within(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function renderError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unrenderable error]'
  }
}
