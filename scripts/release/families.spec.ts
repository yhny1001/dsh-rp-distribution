import { describe, expect, test } from 'vitest'
import { releaseFamily, tarballName, type ReleaseMember } from './families.ts'

function member(name: string, dependencies: Record<string, string> = {}): ReleaseMember {
  return {
    directory: `packages/rp/${name.slice('@dsh-rp/'.length)}`,
    name,
    version: '1.2.3',
    manifest: { name, version: '1.2.3', dependencies },
  }
}

describe('RP release family', () => {
  test('owns only the RP namespace and tag line', () => {
    const family = releaseFamily('rp')
    const cli = member('@dsh-rp/cli')
    expect(family.acceptsPackageName(cli.name)).toBe(true)
    expect(family.acceptsPackageName('@deepseek-ai/dsh-agent')).toBe(false)
    expect(family.tagFor(cli)).toBe('rp-v1.2.3')
    expect(tarballName(cli)).toBe('dsh-rp-cli-1.2.3.tgz')
    expect(family.installedEntry).toEqual({ packageName: '@dsh-rp/cli', binPath: 'lib/bin.js' })
  })

  test('publishes dependencies before consumers', () => {
    const contracts = member('@dsh-rp/contracts')
    const cli = member('@dsh-rp/cli', { '@dsh-rp/contracts': '^1.2.3' })
    expect(releaseFamily('rp').publishOrder([cli, contracts]).map(item => item.name))
      .toEqual(['@dsh-rp/contracts', '@dsh-rp/cli'])
  })

  test('requires one version for all plugin packages', () => {
    const family = releaseFamily('rp')
    const contracts = member('@dsh-rp/contracts')
    const cli = { ...member('@dsh-rp/cli'), version: '1.2.4' }
    expect(() => family.verifyVersions([contracts, cli])).toThrow('rp release members must share one version')
  })

  test('rejects source and source-map publication', () => {
    const family = releaseFamily('rp')
    const cli = member('@dsh-rp/cli')
    expect(() => family.validatePayload(cli, ['package/lib/index.js', 'package/src/index.ts']))
      .toThrow('publishes source file')
  })
})
