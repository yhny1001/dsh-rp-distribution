# AGENTS.md

This repository owns only the independently published `@dsh-rp/*` plugin family for DeepSeek Harness. DSH, Cordis, browser shells, native launchers, Python SDKs, and application assemblies are external dependencies and must not be copied into this repository.

## Layout

- `packages/rp/*`: the 55 publishable RP plugins, bundles, and CLIs.
- `types/`: type-only declarations for generic DSH extensions required by the Web plugin but not yet present in the selected public Host packages.
- `tests/host/`: unit-test-only implementations of small browser Host contracts; never published.
- `examples/rp-package-authoring/`: executable RP package examples.
- `scripts/release/`: the single `rp-v<version>` release family.
- `docs/`: plugin architecture and Host compatibility reference.

## Rules

- Every runtime capability remains a reversible Cordis plugin registered through `ctx.effect()` or a disposer-returning registry.
- `@dsh-rp/*` dependencies use `workspace:^`; `@deepseek-ai/*` packages are external exact-version peers, never Workspace dependencies.
- Host peers may be fetched as npm Tarball artifacts into `.cache/host-sdk` for development. The cache and its `node_modules` links are generated, ignored, and never published.
- Do not add DSH application source, Vendored Cordis source, generated Host bundles, or compatibility patches that mutate an installed Host.
- Core bundles must remain browser-independent. Web-only code belongs in `@dsh-rp/distribution-web` and `@dsh-rp/web`.
- Package payloads contain compiled `lib/`, declarations, README/license files, and declared Bundle Patch files only; never publish `src` or source maps.
- Update English and Chinese READMEs together when user-facing behavior changes.
- Run the smallest affected test while iterating, then `pnpm run check` before pushing.

## Commands

```sh
pnpm install
pnpm run host:sdk
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run publint
pnpm run release:verify
pnpm run release:pack --out dist/npm-rp
```

Node `^22.19.0 || >=24.0.0` and pnpm 11 are required.
