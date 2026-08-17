/** Deterministic checksums, SPDX SBOM, and release-manifest evidence for packed artifacts. */

import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { releaseFamily } from './families.ts'
import { capture, isEntry } from './process.ts'
import { packedIdentity, readPublishOrder } from './tarball.ts'

/** Checksum inventory consumed by `actions/attest`. */
export const RELEASE_CHECKSUMS = 'SHA256SUMS'
/** SPDX 2.3 release SBOM attached to every packed tarball. */
export const RELEASE_SBOM = 'release.spdx.json'
/** Human- and machine-readable local release evidence manifest. */
export const RELEASE_MANIFEST = 'release-manifest.json'

/** One immutable packed release subject. */
export interface ReleaseEvidenceArtifact {
  readonly filename: string
  readonly name: string
  readonly version: string
  readonly sha256: string
  readonly size: number
}

/** Reproducible source identity attached to one release evidence set. */
export interface ReleaseEvidenceContext {
  readonly family: string
  readonly repository: string
  readonly commit: string
  readonly ref: string
  readonly created: string
}

/** Rendered files written beside the packed tarballs. */
export interface RenderedReleaseEvidence {
  readonly checksums: string
  readonly sbom: string
  readonly manifest: string
}

/**
 * Render deterministic checksum, SPDX, and source-manifest evidence.
 * @param artifacts - Packed subjects in deterministic publication order.
 * @param context - Exact source and release family identity.
 * @returns Three newline-terminated evidence files.
 */
export function renderReleaseEvidence(
  artifacts: readonly ReleaseEvidenceArtifact[],
  context: ReleaseEvidenceContext,
): RenderedReleaseEvidence {
  validateContext(context)
  validateArtifacts(artifacts)
  const checksums = artifacts.map(artifact => `${artifact.sha256} *${artifact.filename}`).join('\n') + '\n'
  const bundleSha256 = sha256(checksums)
  const packages = artifacts.map((artifact, index) => ({
    SPDXID: `SPDXRef-Package-${String(index + 1)}-${spdxToken(artifact.name)}`,
    name: artifact.name,
    versionInfo: artifact.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    checksums: [{ algorithm: 'SHA256', checksumValue: artifact.sha256 }],
    externalRefs: [{
      referenceCategory: 'PACKAGE-MANAGER',
      referenceType: 'purl',
      referenceLocator: `pkg:npm/${encodeURIComponent(artifact.name)}@${encodeURIComponent(artifact.version)}`,
    }],
  }))
  const sbomValue = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${context.family}-npm-release-${context.commit.slice(0, 12)}`,
    documentNamespace: `https://github.com/${context.repository}/attestations/${context.commit}/${bundleSha256}/release.spdx.json`,
    creationInfo: { created: context.created, creators: ['Tool: dsh-release-evidence-1'] },
    packages,
    relationships: packages.map(pkg => ({
      spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: pkg.SPDXID,
    })),
  }
  const sbom = `${JSON.stringify(sbomValue, null, 2)}\n`
  const manifest = `${JSON.stringify({
    schemaVersion: 1,
    family: context.family,
    source: {
      repository: context.repository,
      commit: context.commit,
      ref: context.ref,
      created: context.created,
    },
    artifacts,
    checksums: { path: RELEASE_CHECKSUMS, sha256: bundleSha256 },
    sbom: { path: RELEASE_SBOM, sha256: sha256(sbom), format: 'SPDX-2.3' },
    attestations: {
      provenance: 'GitHub actions/attest SLSA provenance over all release output',
      sbom: 'GitHub actions/attest SPDX predicate over packed tarball subjects',
      npm: 'npm Sigstore provenance generated during publication',
    },
  }, null, 2)}\n`
  return { checksums, sbom, manifest }
}

/**
 * Read and hash every tarball in a packed publication directory.
 * @param directory - Absolute or relative pack output directory.
 * @returns Validated subjects in publication order.
 */
export function collectReleaseArtifacts(directory: string): ReleaseEvidenceArtifact[] {
  const root = resolve(directory)
  const filenames = readPublishOrder(root)
  if (filenames.length === 0) throw new Error(`${root} contains no packed release subjects`)
  const seen = new Set<string>()
  return filenames.map((filename): ReleaseEvidenceArtifact => {
    if (filename !== basename(filename) || !filename.endsWith('.tgz')) {
      throw new Error(`release evidence rejects unsafe tarball name ${JSON.stringify(filename)}`)
    }
    if (seen.has(filename)) throw new Error(`release evidence contains duplicate tarball ${JSON.stringify(filename)}`)
    seen.add(filename)
    const path = join(root, filename)
    const info = statSync(path)
    if (!info.isFile()) throw new Error(`${path} is not a packed tarball file`)
    const identity = packedIdentity(path)
    return {
      filename,
      name: identity.name,
      version: identity.version,
      sha256: sha256(readFileSync(path)),
      size: info.size,
    }
  })
}

function validateContext(context: ReleaseEvidenceContext): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(context.repository)) {
    throw new Error('release evidence repository must be an owner/name pair')
  }
  if (!/^[a-f0-9]{40,64}$/u.test(context.commit)) {
    throw new Error('release evidence commit must be a lowercase Git object id')
  }
  if (context.family.length === 0 || context.ref.length === 0) {
    throw new Error('release evidence family and ref must be non-empty')
  }
  if (!Number.isFinite(Date.parse(context.created))) {
    throw new Error('release evidence created must be an ISO timestamp')
  }
}

function validateArtifacts(artifacts: readonly ReleaseEvidenceArtifact[]): void {
  if (artifacts.length === 0 || artifacts.length > 1_024) {
    throw new Error('release evidence must contain between 1 and 1024 artifacts')
  }
  const filenames = new Set<string>()
  const identities = new Set<string>()
  for (const artifact of artifacts) {
    if (artifact.filename !== basename(artifact.filename) || !artifact.filename.endsWith('.tgz')) {
      throw new Error(`release evidence rejects unsafe artifact name ${JSON.stringify(artifact.filename)}`)
    }
    if (!/^[a-f0-9]{64}$/u.test(artifact.sha256)) throw new Error(`${artifact.filename} has no SHA-256 digest`)
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) throw new Error(`${artifact.filename} has invalid size`)
    if (artifact.name.length === 0 || artifact.version.length === 0) throw new Error(`${artifact.filename} lacks package identity`)
    const identity = `${artifact.name}@${artifact.version}`
    if (filenames.has(artifact.filename) || identities.has(identity)) throw new Error(`duplicate release artifact ${identity}`)
    filenames.add(artifact.filename)
    identities.add(identity)
  }
}

function spdxToken(value: string): string {
  return value.replace(/[^A-Za-z0-9.-]/gu, '-').replace(/^-+|-+$/gu, '') || 'package'
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function sourceDate(): string {
  const epoch = process.env.SOURCE_DATE_EPOCH ?? capture('git', ['show', '-s', '--format=%ct', 'HEAD'])
  if (!/^\d+$/u.test(epoch)) throw new Error('SOURCE_DATE_EPOCH must be whole Unix seconds')
  const milliseconds = Number(epoch) * 1_000
  if (!Number.isSafeInteger(milliseconds)) throw new Error('SOURCE_DATE_EPOCH is outside the safe date range')
  return new Date(milliseconds).toISOString()
}

/** Generate release evidence for one packed family directory. */
function main(): void {
  const { values } = parseArgs({
    options: { family: { type: 'string' }, from: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.family === undefined || values.from === undefined) {
    throw new Error('usage: evidence.ts --family rp --from <packed directory>')
  }
  const family = releaseFamily(values.family)
  const directory = resolve(values.from)
  const artifacts = collectReleaseArtifacts(directory)
  for (const artifact of artifacts) {
    if (!family.acceptsPackageName(artifact.name)) {
      throw new Error(`${artifact.name} does not belong to release family ${family.id}`)
    }
  }
  const context: ReleaseEvidenceContext = {
    family: family.id,
    repository:
      process.env.RELEASE_REPOSITORY ??
      process.env.GITHUB_REPOSITORY ??
      'yhny1001/dsh-rp-distribution',
    commit: process.env.GITHUB_SHA ?? capture('git', ['rev-parse', 'HEAD']),
    ref: process.env.GITHUB_REF ?? `refs/heads/${capture('git', ['branch', '--show-current']) || 'detached'}`,
    created: sourceDate(),
  }
  const evidence = renderReleaseEvidence(artifacts, context)
  writeFileSync(join(directory, RELEASE_CHECKSUMS), evidence.checksums)
  writeFileSync(join(directory, RELEASE_SBOM), evidence.sbom)
  writeFileSync(join(directory, RELEASE_MANIFEST), evidence.manifest)
  console.log(`release evidence: ${String(artifacts.length)} subject(s) in ${values.from}`)
}

if (isEntry(import.meta.url)) main()
