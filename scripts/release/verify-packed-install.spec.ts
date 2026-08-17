import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  consumerEnvironment,
  packedConsumerManifest,
  packedInstallArguments,
} from './verify-packed-install.ts'

describe('packed-install environment', () => {
  test('isolates the consumer from host package-manager and build-tool state', () => {
    const root = resolve('packed-consumer')
    const environment = consumerEnvironment(root, {
      npm_config_user_agent: 'host npm',
      NPM_CONFIG_USER_AGENT: 'host npm',
      npm_config_cache: '/host/lower-cache',
      NPM_CONFIG_CACHE: '/host/upper-cache',
      NODE_OPTIONS: '--import host-hook',
      NODE_PATH: '/host/modules',
      ESBUILD_BINARY_PATH: '/host/esbuild',
      PRESERVED: 'yes',
    })

    expect(environment).toMatchObject({
      npm_config_cache: resolve(root, '.npm-cache'),
      DSH_HOME: resolve(root, '.dsh'),
      DSH_AGENTS_HOME: resolve(root, '.agents'),
      DSH_TELEMETRY_DISABLED: '1',
      PRESERVED: 'yes',
    })
    expect(environment).not.toHaveProperty('npm_config_user_agent')
    expect(environment).not.toHaveProperty('NPM_CONFIG_USER_AGENT')
    expect(environment).not.toHaveProperty('NPM_CONFIG_CACHE')
    expect(environment).not.toHaveProperty('NODE_OPTIONS')
    expect(environment).not.toHaveProperty('NODE_PATH')
    expect(environment).not.toHaveProperty('ESBUILD_BINARY_PATH')
  })
})

describe('packed-install native dependencies', () => {
  test('keeps Linux verification independent from Landlock platform packages', () => {
    expect(packedInstallArguments('linux')).toContain('--omit=optional')
  })

  test.each(['win32', 'darwin'] as const)('installs koffi prebuilds on %s', (platform) => {
    expect(packedInstallArguments(platform)).not.toContain('--omit=optional')
  })
})

describe('packed-install dependency root', () => {
  test('contains only locally packed RP packages', () => {
    const manifest = packedConsumerManifest('rp', new Map([
      ['@dsh-rp/cli', { url: 'file:///release/dsh-rp-cli.tgz', version: '1.2.3' }],
    ]))

    expect(manifest).toMatchObject({
      name: 'dsh-packed-install-rp',
      dependencies: { '@dsh-rp/cli': 'file:///release/dsh-rp-cli.tgz' },
    })
    expect(manifest).not.toHaveProperty('overrides')
  })
})
