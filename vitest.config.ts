import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/** Unit-test only the independently maintained RP packages and release tools. */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] })],
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-runtime/client': resolve(import.meta.dirname, 'tests/host/client-runtime.ts'),
      '@deepseek-ai/dsh-client-ui-attachment': resolve(import.meta.dirname, 'tests/host/client-ui-attachment.tsx'),
    },
  },
  test: {
    include: [
      'packages/rp/*/tests/**/*.spec.{ts,tsx}',
      'scripts/**/*.spec.ts',
    ],
    exclude: [
      'packages/rp/web/tests/client-apply.client.spec.tsx',
      'packages/rp/web/tests/client-loader-composition.client.spec.tsx',
      'packages/rp/web/tests/loader-composition.spec.ts',
    ],
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['packages/rp/*/src/**/*.{ts,tsx}'],
      exclude: [
        'packages/rp/*/src/types.ts',
        'packages/rp/*/src/bin.ts',
      ],
    },
  },
})
