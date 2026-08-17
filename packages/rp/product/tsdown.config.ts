import { defineConfig } from 'tsdown'

const clientModules = ['react', 'react/jsx-runtime'] as const

/** Build the self-contained local product Node, Agent, and DSH Client entries. */
export default defineConfig([
  {
    entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
    deps: {
      alwaysBundle: (moduleId: string) => moduleId.startsWith('@dsh-rp/compat-sillytavern')
        || ['fflate', 'png-chunk-text', 'png-chunks-extract'].includes(moduleId),
    },
  },
  {
    entry: ['lib/types/agent.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
    deps: {
      alwaysBundle: (moduleId: string) => moduleId === '@deepseek-ai/dsh-tools'
        || moduleId === '@deepseek-ai/schemastery',
    },
  },
  {
    entry: { client: 'lib/types/client/index.js' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    deps: {
      neverBundle: [...clientModules],
      alwaysBundle: (moduleId: string) => (clientModules.includes(moduleId as typeof clientModules[number])
        ? undefined
        : true),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.cjs',
      banner: 'window.__ModuleLoader__.load({ id: "@dsh-rp/product", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
