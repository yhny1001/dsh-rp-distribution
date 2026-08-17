#!/usr/bin/env node

/** Standalone `dsh-rp` executable. @module @dsh-rp/cli/bin */

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.length === 1 && (args[0] === '-v' || args[0] === '--version')) {
  const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const version = (manifest as { version?: unknown }).version
  if (typeof version !== 'string' || version === '') throw new Error('@dsh-rp/cli package.json has no version')
  process.stdout.write(`${version}\n`)
} else {
  const { runRpCli } = await import('./index.ts')
  process.exitCode = await runRpCli(args)
}
