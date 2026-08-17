# DSH RP plugins

[中文](README.md) | English

`dsh-rp-distribution` is an independent RP plugin repository rebuilt on the DeepSeek Harness plugin model. DSH is the external Host; this repository maintains only installable plugins, plugin bundles, compatibility adapters, RP package tools, and related examples. It does not distribute or maintain another DSH implementation.

## Install

### Local RP product

The repository's `@dsh-rp/product` is a self-contained product Bundle that can be installed directly into a DSH `0.1.0-rc.6` Web profile:

```sh
pnpm run build
pnpm --dir packages/rp/product pack --pack-destination /tmp/dsh-rp-product
dsh plugin --profile web add /tmp/dsh-rp-product/dsh-rp-product-0.1.0-rc.5.tgz
dsh --profile web
```

Open **RP Studio** from the sidebar footer or Settings. It keeps system rules, world facts, multiple characters, multiple user personas, and the current scene separate, then binds those five layers to the current blank Session. Conversation execution remains on the native DSH AgentLoop, composer, model selector, streaming, cancellation, persistence, and statistics.

### Complete plugin family

After the packages are published, install the complete Web bundle into a compatible DSH profile:

```sh
dsh plugin --profile web add @dsh-rp/distribution
dsh --profile web
```

For a Headless deployment, install only the presentation-neutral bundle:

```sh
dsh plugin --profile headless add @dsh-rp/distribution-core
dsh --profile headless
```

The standalone RP package-authoring CLI is `@dsh-rp/cli` and exposes `dsh-rp`.

## Entry packages

| Package | Responsibility |
|---|---|
| `@dsh-rp/product` | Locally installable Chinese-first RP product UI and five-layer native AgentLoop composition for system, world, characters, user persona, and scene. |
| `@dsh-rp/distribution-core` | Character, Persona, Lore, Memory, Policy, Pipeline, Registry, Outbox, package lifecycle, and other Headless RP services. |
| `@dsh-rp/distribution-web` | RP Studio, conversation routing, Session resources, and trusted UI Slot integration. |
| `@dsh-rp/distribution` | Thin full-Web aggregate over Core and Web. |
| `@dsh-rp/cli` | RP package initialization, validation, build, unit test, pack, install, update, uninstall, SBOM, and publication operations. |
| `@dsh-rp/registry-server` | Standalone RP package Registry HTTP service. |

The aggregate packages use DSH's public `dsh.bundle.patch` Manifest. Installing or removing a bundle uses the ordinary DSH Profile lifecycle and does not rewrite Host files or `node_modules`.

## Development

```sh
corepack enable
pnpm install
pnpm run check
```

The repository does not install a DSH application graph. `pnpm run host:sdk` reads exact `@deepseek-ai/*` Peer versions from plugin Manifests, downloads only their npm Tarballs into `.cache/host-sdk`, and creates temporary development links. This cache supports plugin type checking and package-level tests; it does not start or validate an assembled Harness.

The existing checks cover the internal logic, builds, and publication payloads of 56 plugin packages. Browser component tests use minimal Host interfaces under `tests/host`; those implementations are unit-test-only, are never published, and do not replace real DSH integration tests. See [architecture](docs/architecture.md) and [Host compatibility](docs/compatibility.md).

## Harness integration testing

`@dsh-rp/product` has been verified against a local DSH `0.1.0-rc.6` using a disposable Harness home and its actual npm Tarball: profile initialization, Bundle Patch, Node API, Client ModuleLoader, official Web Slots, Agent Preset recomposition, Session events, the five-layer context strip, the native AgentLoop, and a real streaming model reply all passed. The complete `distribution-core` / `distribution-web` family still needs a separate Host assembly test for its 55 foundation packages; declaration caches and test doubles do not substitute for that evidence.

## Release

All 56 packages share one version and publish in dependency order from an `rp-v<version>` tag:

```sh
pnpm run release:rp -- 0.1.0
git tag rp-v0.1.0
git push origin main rp-v0.1.0
```

The RP release workflow builds, tests, packs, installs the exact Tarballs in a throwaway consumer, generates SHA-256 checksums, an SPDX SBOM, and a source-bound release Manifest, then publishes only `@dsh-rp/*` packages.

MIT licensed. See [LICENSE](LICENSE).
