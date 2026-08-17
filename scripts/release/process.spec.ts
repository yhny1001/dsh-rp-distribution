import { describe, expect, test } from 'vitest'
import { attempt, capture } from './process.ts'

describe('release process helpers', () => {
  test('launch package-manager shims through the cross-platform resolver', () => {
    const result = attempt('pnpm', ['--version'])

    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+$/)
    expect(result.stderr).toBe('')
  })

  test('preserves non-zero exits for callers that implement retry policy', () => {
    const result = attempt(process.execPath, ['-e', 'process.exit(23)'])

    expect(result.status).toBe(23)
  })

  test('capture trims successful stdout', () => {
    expect(capture(process.execPath, ['-e', "process.stdout.write('release-ready\\n')"])).toBe('release-ready')
  })
})
