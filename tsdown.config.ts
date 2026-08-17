import { defineConfig } from 'tsdown'

/** Bundle every RP package from TypeScript output emitted under `lib/types`. */
export default defineConfig({
  workspace: ['packages/rp/*'],
  entry: ['lib/types/{index,invariant}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
