# RP package authoring

English | [中文](README.zh.md)

These installable MIT examples exercise the same SDK, archive reader, source Provider, Registry transaction, Lifecycle adapter, Capability Catalog, Pipeline Runtime, and sandbox used by the distribution. They are source projects rather than Cordis plugins: package code never receives `ctx` or a registration API.

## Build and install

Create the same starting structures with `pnpm dsh rp init <directory> --template orchestration`, `--template quickjs-critic`, or `--template ui-panel`. From the repository root, build any checked-in example with `pnpm dsh rp pack examples/rp-package-authoring/<example>`. The verified release appears under that example's `dist/rp-release`. A running Web Host whose `rp-registry-sources.localRoots` includes the example directory can install it with `pnpm dsh rp install <absolute-release-directory>` and remove it with `pnpm dsh rp uninstall <root-id>`.

## `l0-orchestration`

This code-free L0 package contributes one component, an Agent capability, a Memory capability, a Turn Pipeline, and a Sidecar Pipeline. The named graphs use `invoke-capability` stages; invoking a Pipeline through the unified Catalog delegates to the same graph in `ctx.rpPipelines`. Uninstall removes both graphs and all discovery entries.

## `l1-quickjs-critic`

This L1 package contributes a QuickJS Continuity Critic Agent and a Workflow Pipeline that invokes it. The Manifest and executable descriptor both request `script.execute`. Invocation needs an L1 trust ceiling and that permission; the sandboxed result demonstrates that `process` and `fetch` are absent.

## `l0-ui-panel`

This declarative package contributes a `studio.overview` UI Slot. Its HTML and CSS are Manifest-declared, integrity-bound archive assets. The Host serves them with a restrictive CSP and the Studio embeds the entry in an iframe without `allow-same-origin` or script authority. Uninstall removes the Slot and makes every package resource URL return 404.

## Trust choices

Use L0 for declarative transforms and code-free graphs. Use L1 for untrusted or semi-trusted QuickJS and no-import WebAssembly. L2 executes explicitly trusted in-process native code, requires an Ed25519 signer and Host key trust, and is intentionally not included as a copy-paste starter.
