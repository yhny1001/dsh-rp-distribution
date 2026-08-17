import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('@dsh-rp/distribution-web', () => {
  it('contains only the RP browser integration rows', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch.match(/name: '@dsh-rp\//gu)).toHaveLength(2)
    expect(patch).toContain("name: '@dsh-rp/ui-slot-runtime'")
    expect(patch).toContain("name: '@dsh-rp/web'")
    expect(patch).not.toContain("name: '@dsh-rp/turn-runtime'")
  })
})
