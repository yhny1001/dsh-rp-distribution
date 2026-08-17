import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('@dsh-rp/distribution-core', () => {
  it('mounts the RP runtime without browser packages', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toContain("name: '@dsh-rp/turn-runtime'")
    expect(patch).toContain("name: '@dsh-rp/first-party'")
    expect(patch).toContain("name: '@dsh-rp/compat-sillytavern'")
    expect(patch).not.toContain("name: '@dsh-rp/ui-slot-runtime'")
    expect(patch).not.toContain("name: '@dsh-rp/web'")
  })
})
