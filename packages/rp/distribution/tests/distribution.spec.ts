import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('@dsh-rp/distribution', () => {
  it('declares a standard external DSH bundle manifest', () => {
    const manifest = JSON.parse(read('../package.json')) as {
      dsh?: { bundle?: { patch?: string } }
      dependencies?: Record<string, string>
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toEqual({
      '@dsh-rp/distribution-core': 'workspace:^',
      '@dsh-rp/distribution-web': 'workspace:^',
    })
  })

  it('is exactly the Core and Web bundle layers in order', () => {
    const core = read('../../distribution-core/cordis.patch.yml').trimEnd()
    const web = read('../../distribution-web/cordis.patch.yml').trimEnd()
    const full = read('../cordis.patch.yml').trimEnd()
    expect(full).toBe(`${core}\n\n${web}`)
  })

  it('mounts each browser and presentation-neutral package once', () => {
    const patch = read('../cordis.patch.yml')
    expect(patch.match(/name: '@dsh-rp\/turn-runtime'/gu)).toHaveLength(1)
    expect(patch.match(/name: '@dsh-rp\/ui-slot-runtime'/gu)).toHaveLength(1)
    expect(patch.match(/name: '@dsh-rp\/web'/gu)).toHaveLength(1)
    expect(patch.indexOf("name: '@dsh-rp/compat-stscript'"))
      .toBeLessThan(patch.indexOf("name: '@dsh-rp/ui-slot-runtime'"))
  })
})
