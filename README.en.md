# dsh-rp-distribution

[中文](README.md) | English

> Open RP infrastructure, plugin framework, and shared contracts for DeepSeek Harness.

`dsh-rp-distribution` is open role-playing (RP) infrastructure, a plugin framework, and a shared contract layer built on DeepSeek Harness. Its primary output is not one Tavern UI: it is reusable domain IR, Cordis services, execution and authority boundaries, package lifecycle, Registry infrastructure, compatibility adapters, and aggregate Bundles. It reuses DSH's native AgentLoop, sessions, models, tools, and Web Host and does not distribute or maintain another DSH implementation.

`@dsh-rp/compat-sillytavern` and `@dsh-rp/product` are first-party SillyTavern compatibility and reference-product surfaces. They prove that Character Cards, personas, World Info, Prompt Presets, and Tavern Chat can enter the same infrastructure with retained provenance and explicit compatibility-loss reporting; they are not the only data source, interaction model, or product UI the framework permits.

## Project boundary

This repository owns:

- Versioned public contracts for characters, personas, lore, scenes, memory, state, media, packages, and experiences.
- Reversible Cordis services, Providers, Pipelines, and UI Slots registered through `ctx.effect()` or a disposer.
- Composition boundaries for turns, workflows, sidecars, capabilities, policy, journals, projections, and outboxes.
- Validation, authorization, activation, and cleanup for declarative L0, sandboxed L1, and explicitly trusted native L2 packages.
- Registry Sources, Artifact Stores, signatures, SBOMs, deterministic archives, the CLI, and release evidence.
- Adapters for the DSH Host, Web Slots, Agent Providers, and external content formats.

This repository does not own:

- A DSH application entry, AgentLoop, model Provider, browser shell, native launcher, or Python SDK.
- Copies or mutations of installed DSH/Cordis sources, Host Bundles, or `node_modules`.
- A reimplementation of the SillyTavern UI, script runtime, regex executor, or private TavernHelper behavior as a Host.
- One mandatory RP product shape. Third-party products may reuse the public contracts with completely different UIs and workflows.
- A Host-independent wire standard; the current shared contracts serve the DSH plugin ecosystem.

## Architecture layers

| Layer | Representative packages | Ownership and extension model |
|---|---|---|
| Public contracts | `@dsh-rp/contracts` | Client-safe versioned IR only; no storage, execution, or defaults. Breaking changes require a new schema and migration adapter. |
| Domain services | `character`, `persona`, `lore`, `memory-*`, `state`, `scene`, `relationship`, `media` | Bounded, deterministic, reversible Services or Provider registries. Stores, retrievers, and generators remain replaceable. |
| Execution and orchestration | `capability-catalog`, `agent-runtime`, `pipeline-runtime`, `turn-runtime`, `workflow-*`, `sidecar-jobs` | Freeze execution plans, compute least authority, route backends, and commit evidence at Turn or Workflow boundaries. |
| Packages and trust | `sdk`, `package-runtime`, `registry*`, `lifecycle-l0/l1/l2`, `cli` | Validate untrusted packages, bind integrity and SBOMs, and activate or uninstall capabilities by trust level. RP package code never receives Cordis `ctx`. |
| Host integration | `harness-bridge`, `agent-provider-harness`, `ui-slot-runtime`, `web` | Integrate only through published DSH Peers, events, services, and Slots. Compatibility fails closed and never patches an older Host. |
| First-party adapters and references | `compat-sillytavern`, `compat-stscript`, `first-party`, `product` | Prove the infrastructure with real formats and a product without freezing ST or the current UI into public contracts. |
| Aggregate distribution | `distribution-core`, `distribution-web`, `distribution` | Declare default membership and mount order only; leaf plugins remain independently installable, replaceable, and testable. |

See [architecture](docs/architecture.md) and [Host compatibility](docs/compatibility.md) for the complete ownership and mount rules.

## Choose a development surface

Before writing code, decide which artifact you are building:

1. **Infrastructure Cordis plugin**: lives under `packages/rp/*`, receives Host-provided `ctx`, and publishes as an `@dsh-rp/*` npm package. Use this for domain Services, Provider registries, executors, storage adapters, Host bridges, and aggregate Bundles.
2. **Installable RP package**: lives in a separate project or under `examples/rp-package-authoring/*` and consists of `rp.package.json`, `rp.runtime.json`, assets, and an SBOM. Package code receives no `ctx`; it may use only Manifest-declared L0/L1/L2 capabilities authorized by Policy.
3. **Compatibility adapter or product plugin**: an importer converts external formats into public IR while retaining provenance and a loss report; a product owns UI and workflow. Products may change their interaction freely but must not silently rewrite source semantics or mutate the Host.

The complete workflows, checklists, and commands are in the [development guide](docs/development.md). Executable installable-package examples are in [RP package authoring](examples/rp-package-authoring/README.md).

## Repository development

Node `^22.19.0 || >=24.0.0` and pnpm 11 are required:

```sh
corepack enable
pnpm install
pnpm run host:sdk
```

`pnpm run host:sdk` reads exact `@deepseek-ai/*` Peer versions from plugin Manifests, downloads their npm Tarballs into the ignored `.cache/host-sdk`, and creates temporary links only for type checking and unit tests. It does not install, start, or validate a complete DSH application.

Run the smallest affected checks while modifying an existing package:

```sh
pnpm exec vitest run packages/rp/character/tests/character.spec.ts
pnpm exec tsc -b packages/rp/character --pretty false
```

Run the complete gate before handing off a release-bound change:

```sh
pnpm run check
```

`check` validates Workspace policy, lint, unit tests, declaration/runtime builds, and publication payloads. Unit tests and `tests/host` doubles do not replace real DSH integration evidence. A change to Host events, public Slots, Bundle Patches, Agent Presets, or Session behavior must also be tested with a real Tarball and disposable `DSH_HOME` against the target Profile.

## Install aggregate distributions

Install the complete Web distribution into a compatible DSH Profile:

```sh
dsh plugin --profile web add @dsh-rp/distribution
dsh --profile web
```

For a Headless deployment, install only presentation-neutral infrastructure:

```sh
dsh plugin --profile headless add @dsh-rp/distribution-core
dsh --profile headless
```

Aggregate packages use DSH's public `dsh.bundle.patch` Manifest. Installation and removal use the normal DSH Profile lifecycle and never rewrite Host files or `node_modules`.

## Entry packages

| Package | Responsibility |
|---|---|
| `@dsh-rp/contracts` | Client-safe RP IR shared by Hosts, Web clients, package tooling, and adapters. |
| `@dsh-rp/sdk` / `@dsh-rp/cli` | RP package initialization, validation, build, test, pack, signing, SBOM, installation, and publication. |
| `@dsh-rp/package-runtime` | Integrity-bound `dsh-rp-runtime-v1` archives and executable-descriptor boundary. |
| `@dsh-rp/distribution-core` | Presentation-neutral composition of domain services, execution, policy, Registry, and package lifecycle. |
| `@dsh-rp/distribution-web` | RP Studio, conversation routing, Session resources, and trusted UI Slot integration. |
| `@dsh-rp/distribution` | Thin full-Web aggregate over Core and Web. |
| `@dsh-rp/registry-server` | Standalone RP Package Registry HTTP service. |
| `@dsh-rp/compat-sillytavern` | Clean-room, non-executing compatibility adapter for ST characters, personas, lore, and presets. |
| `@dsh-rp/product` | First-party ST-compatible reference Product Bundle, not the framework's only UI. |

## First-party ST compatibility reference product

`@dsh-rp/product` installs directly into a DSH `0.1.0-rc.6` Web Profile and verifies ST import, Prompt ordering, five-layer resource composition, and native AgentLoop integration:

```sh
pnpm run build
pnpm --dir packages/rp/product pack --pack-destination /tmp/dsh-rp-product
dsh plugin --profile web add /tmp/dsh-rp-product/dsh-rp-product-0.1.0-rc.5.tgz
dsh --profile web
```

It retains ST source resources and creates a separate Harness adaptation only after an explicit user action; scripts, regexes, remote resources, and unknown extensions remain inert. It is an integration and product-design reference, but new infrastructure capabilities should not model only its private UI or default content.

## Testing and maturity

The current checks cover the internal logic, lifecycle rollback, policy, persistence adapters, package compatibility, builds, and publication payloads of 56 independently published packages. Browser component tests use minimal Host contracts under `tests/host`; these implementations are unit-test-only and never published.

`@dsh-rp/product` has been verified against a real DSH `0.1.0-rc.6` Web Profile using a disposable Home and actual Tarball, including Profile initialization, Bundle Patch, Node API, Client ModuleLoader, official Web Slots, Agent Presets, Session events, the native AgentLoop, and a streaming model reply. The complete `distribution-core` / `distribution-web` family still needs a separate Host assembly acceptance run for its 55 foundation packages; SDK caches and test doubles are not substitutes for that evidence.

## Release

All 56 packages share one version and publish in dependency order from an `rp-v<version>` tag:

```sh
pnpm run release:rp -- 0.1.0
git tag rp-v0.1.0
git push origin main rp-v0.1.0
```

The RP release workflow builds, tests, packs, installs exact Tarballs in a throwaway consumer, generates SHA-256 checksums, an SPDX SBOM, and a source-bound release Manifest, and publishes only `@dsh-rp/*` packages.

MIT licensed. See [LICENSE](LICENSE).
