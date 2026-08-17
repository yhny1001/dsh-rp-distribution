# DSH RP plugins

English | [中文](README.zh.md)

`dsh-rp-distribution` is the independent RP plugin family for DeepSeek Harness. This repository does not distribute or maintain a fork of DSH. DSH is the Host; every package maintained here is an installable plugin, plugin bundle, compatibility adapter, package tool, or RP-specific test/example.

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

The standalone package-authoring CLI is `@dsh-rp/cli` and exposes `dsh-rp`.

## Entry packages

| Package | Responsibility |
|---|---|
| `@dsh-rp/distribution-core` | Character, Persona, Lore, Memory, Policy, Pipeline, Registry, Outbox, package lifecycle, and other Headless RP services. |
| `@dsh-rp/distribution-web` | RP Studio, conversation routing, session resources, and trusted UI Slot integration. |
| `@dsh-rp/distribution` | Thin full-Web aggregate over Core and Web. |
| `@dsh-rp/cli` | RP package init, validation, build, test, pack, install, update, uninstall, SBOM, and publication operations. |
| `@dsh-rp/registry-server` | Standalone RP package Registry HTTP service. |

The aggregate packages use DSH's public `dsh.bundle.patch` Manifest. Installing or removing a bundle uses the ordinary DSH Profile lifecycle and never rewrites Host files or `node_modules`.

## Development

```sh
corepack enable
pnpm install
pnpm run check
```

The repository does not install a DSH application graph. `pnpm run host:sdk` reads exact `@deepseek-ai/*` Peer versions from plugin Manifests, downloads only their npm Tarballs into `.cache/host-sdk`, and creates temporary development links. This provides real Host declarations and the reachable runtime API without making DSH source part of this repository.

The full unit suite covers 55 packages. Browser component tests use minimal Host contract implementations under `tests/host`; assembled DSH application compatibility belongs to the Host's integration suite. See [architecture](docs/architecture.md) and [Host compatibility](docs/compatibility.md).

## Release

All 55 packages share one version and publish in dependency order from an `rp-v<version>` tag:

```sh
pnpm run release:rp -- 0.1.0
git tag rp-v0.1.0
git push origin main rp-v0.1.0
```

The RP release workflow builds, tests, packs, installs the exact Tarballs in a throwaway consumer, generates SHA-256 checksums, an SPDX SBOM, and a source-bound release Manifest, then publishes only `@dsh-rp/*` packages.

MIT licensed. See [LICENSE](LICENSE).
