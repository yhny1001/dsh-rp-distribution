# DSH RP plugins

[中文](README.md) | English

`dsh-rp-distribution` is an independent RP plugin repository rebuilt on the DeepSeek Harness plugin model. DSH is the external Host; this repository maintains only installable plugins, plugin bundles, compatibility adapters, RP package tools, and related examples. It does not distribute or maintain another DSH implementation.

## Install

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

The existing checks cover the internal logic, builds, and publication payloads of 55 plugin packages. Browser component tests use minimal Host interfaces under `tests/host`; those implementations are unit-test-only, are never published, and do not replace real DSH integration tests. See [architecture](docs/architecture.md) and [Host compatibility](docs/compatibility.md).

## Harness integration testing

Real Host assembly tests will be added after a compatible DeepSeek Harness is available locally. They should install the actual Tarballs into a disposable DSH Profile, start both Headless and Web entries, and verify Loader assembly, service injection, Session lifecycles, Registry operations, and browser Slots. Until then, this repository does not present declaration caches or test doubles as evidence of Harness compatibility.

## Release

All 55 packages share one version and publish in dependency order from an `rp-v<version>` tag:

```sh
pnpm run release:rp -- 0.1.0
git tag rp-v0.1.0
git push origin main rp-v0.1.0
```

The RP release workflow builds, tests, packs, installs the exact Tarballs in a throwaway consumer, generates SHA-256 checksums, an SPDX SBOM, and a source-bound release Manifest, then publishes only `@dsh-rp/*` packages.

MIT licensed. See [LICENSE](LICENSE).
