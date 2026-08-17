import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectReleaseArtifacts,
  RELEASE_CHECKSUMS,
  renderReleaseEvidence,
  type ReleaseEvidenceArtifact,
} from './evidence.ts'

const artifacts: readonly ReleaseEvidenceArtifact[] = [
  {
    filename: 'dsh-rp-contracts-1.0.0.tgz',
    name: '@dsh-rp/contracts',
    version: '1.0.0',
    sha256: 'a'.repeat(64),
    size: 128,
  },
  {
    filename: 'dsh-rp-cli-1.0.0.tgz',
    name: '@dsh-rp/cli',
    version: '1.0.0',
    sha256: 'b'.repeat(64),
    size: 256,
  },
]

const context = {
  family: 'rp',
  repository: 'yhny1001/dsh-rp-distribution',
  commit: 'c'.repeat(40),
  ref: 'refs/tags/rp-v1.0.0',
  created: '2026-08-14T00:00:00.000Z',
} as const

describe('release evidence', () => {
  it('renders deterministic attest-compatible checksums and SPDX subjects', () => {
    const first = renderReleaseEvidence(artifacts, context)
    const second = renderReleaseEvidence(artifacts, context)
    expect(first).toEqual(second)
    expect(first.checksums).toBe(
      `${'a'.repeat(64)} *dsh-rp-contracts-1.0.0.tgz\n${'b'.repeat(64)} *dsh-rp-cli-1.0.0.tgz\n`,
    )
    const sbom = JSON.parse(first.sbom) as {
      spdxVersion: string
      packages: { name: string; checksums: { checksumValue: string }[] }[]
      relationships: unknown[]
    }
    expect(sbom.spdxVersion).toBe('SPDX-2.3')
    expect(sbom.packages).toMatchObject([
      { name: '@dsh-rp/contracts', checksums: [{ checksumValue: 'a'.repeat(64) }] },
      { name: '@dsh-rp/cli', checksums: [{ checksumValue: 'b'.repeat(64) }] },
    ])
    expect(sbom.relationships).toHaveLength(2)
    expect(first.manifest).toContain('GitHub actions/attest SLSA provenance')
    expect(first.manifest).toContain('npm Sigstore provenance')
  })

  it('rejects unsafe, duplicate, and malformed subjects', () => {
    expect(() => renderReleaseEvidence([{ ...artifacts[0]!, filename: '../escape.tgz' }], context))
      .toThrow(/unsafe artifact name/u)
    expect(() => renderReleaseEvidence([artifacts[0]!, artifacts[0]!], context))
      .toThrow(/duplicate release artifact/u)
    expect(() => renderReleaseEvidence([{ ...artifacts[0]!, sha256: 'nope' }], context))
      .toThrow(/SHA-256/u)
    expect(() => renderReleaseEvidence(artifacts, { ...context, commit: 'branch-main' }))
      .toThrow(/Git object id/u)
  })

  it('reads exact identities and bytes from packed tarballs', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-release-evidence-'))
    try {
      const stage = join(root, 'stage')
      mkdirSync(join(stage, 'package'), { recursive: true })
      writeFileSync(join(stage, 'package', 'package.json'), JSON.stringify({
        name: '@dsh-rp/contracts', version: '1.0.0',
      }))
      const filename = 'dsh-rp-contracts-1.0.0.tgz'
      execFileSync('tar', ['-czf', join(root, filename), '-C', stage, 'package'])
      writeFileSync(join(root, 'publish-order.txt'), `${filename}\n`)
      const collected = collectReleaseArtifacts(root)
      expect(collected).toMatchObject([{
        filename, name: '@dsh-rp/contracts', version: '1.0.0',
      }])
      expect(collected[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(collected[0]?.size).toBeGreaterThan(0)
      expect(RELEASE_CHECKSUMS).toBe('SHA256SUMS')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
