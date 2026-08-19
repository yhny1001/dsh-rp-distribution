# dsh-rp-distribution development guide

English | [中文](development.zh.md)

This guide describes how to develop DSH RP infrastructure without expanding the repository boundary or coupling public contracts to one reference product. The repository supports both infrastructure Cordis plugins and installable RP packages; their authority, directories, and execution models are different and must not be conflated.

## 1. Choose the correct owner first

| Requirement | Owner | Reason |
|---|---|---|
| New pure data IR shared across plugins | `@dsh-rp/contracts` | Contracts must remain client-safe, storage-neutral, and versioned. |
| New domain runtime for characters, memory, state, and similar concepts | A new or existing leaf `packages/rp/*` Service | The smallest owner supplies behavior and Cordis lifecycle rollback. |
| New replaceable algorithm or backend | The relevant Service's Provider interface, preferably an independent plugin | Registration and disposers keep the core independent of concrete implementations. |
| New Turn, Workflow, or Sidecar orchestration | `pipeline-runtime`, `turn-runtime`, `workflow-router`, or an independent Backend | Orchestration depends on frozen plans, capabilities, and least authority rather than product UI. |
| New user-installable content or capability package | A separate RP package project | RP package code receives no `ctx` and runs through archives, Manifests, Policy, and L0/L1/L2 lifecycle adapters. |
| New external content format | An independent `compat-*` adapter | It parses untrusted data into public IR, provenance, and a compatibility loss report without executing source scripts. |
| New DSH Web or Session integration | `web`, `ui-slot-runtime`, or a new Host bridge | Host integration uses published Peers and Slots and fails closed when incompatible. |
| New end-user experience | A separate Product plugin or `@dsh-rp/product` | Products own UI and defaults but must not elevate private interaction models into public contracts. |

When a change touches a Contract, Runtime, and UI, split it along a clear dependency direction: stabilize public IR first, implement the runtime second, and integrate the product last. `contracts` must never depend back on a Runtime, and Core must not add fields solely for a private Product component.

## 2. Environment setup

Requirements:

- Node `^22.19.0 || >=24.0.0`
- pnpm 11
- A local `dsh` installation only for real Host integration testing

```sh
corepack enable
pnpm install
pnpm run host:sdk
```

`host:sdk` downloads npm artifacts for the exact Host Peer versions declared by the packages into `.cache/host-sdk` and creates ignored development links. The cache is disposable, never enters an npm Tarball, and is not evidence that DSH has been run.

## 3. Modify an existing infrastructure plugin

### 3.1 Find the smallest owner

Prefer the leaf package that owns the state or lifecycle:

- Data shape belongs to `contracts`.
- Character registration and model-safe projection belong to `character`.
- Retrieval and Store selection belong to `memory-basic`; concrete algorithms and persistence belong in independent Providers.
- Capability discovery and least authority belong to `capability-catalog` / `policy`.
- Execution graphs belong to `pipeline-runtime`; backend selection belongs to `workflow-router`.
- Turn owns prepare/execute/validate/commit/abort coordination only, not concrete domain implementations.
- DSH Session, Agent, and Web Slot translation belongs in Bridge/Web layers.

Do not put new behavior directly into `distribution-core`, `distribution-web`, or `distribution` merely because an aggregate already depends on many Services. These packages own membership and mount order only.

### 3.2 Preserve dependency direction

- Internal `@dsh-rp/*` ranges use `workspace:^`.
- Internal runtime interfaces required by a leaf plugin normally appear in both `peerDependencies` and `devDependencies`.
- Aggregate Bundles put members they install in `dependencies`, still using `workspace:^`.
- Every `@deepseek-ai/*` runtime dependency is an external exact-version `peerDependency`; it must not use a Workspace range or appear in ordinary `dependencies`.
- Core packages must not depend on React, DOM, or browser APIs; those belong only to `distribution-web`, `web`, or a Product.
- Never copy Cordis, DSH application sources, or generated Host Bundles.

### 3.3 Use reversible lifecycle ownership

Every runtime contribution must uninstall and restore the original Host state:

```ts
ctx.effect(() => ctx.rpMemory.registerRetriever(retriever))
```

Alternatively, a registration method may return an idempotent disposer. A disposed Service must not leave behind:

- Context properties
- Event listeners
- Provider, Capability, or Pipeline registrations
- Timers, Workers, child processes, or file handles
- Web routes, commands, or UI Slots
- Mutable in-memory projections that remain reachable

Disposers for asynchronous resources should await shutdown. When external listeners fail, explicitly choose propagation or logging; one observer failure must not corrupt committed state accidentally.

### 3.4 Validate inputs and model projections

- Validate schemas, sizes, counts, depth, and string limits for every untrusted or persisted input.
- Detach stored objects from caller references; expose frozen snapshots or an equivalent read-only strategy.
- Define model-visible projections separately and bound entries, characters, or Token budgets.
- Compatibility envelopes, unknown fields, scripts, secrets, and Host-private objects are model-invisible by default.
- Deterministic ordering needs a stable tie-breaker and must not depend on incidental Map insertion order or wall-clock time.
- Idempotent operations accept identical retries and reject conflicting content under the same identity.

### 3.5 Keep documentation and tests paired

An ordinary infrastructure leaf package normally maintains:

- `README.md`
- `README.zh.md`
- `src/index.ts`
- `src/invariant.ts`
- `tests/*.spec.ts` or `tests/*.spec.tsx`
- `package.json`
- `tsconfig.json`

CLIs, Products, Registry Servers, and pure Bundles may add entry points or omit an inapplicable `invariant.ts`, but every public package must provide paired English and Chinese READMEs, explicit publication entries, and tests for affected behavior. Synchronize both READMEs whenever user-visible behavior changes. Runtime-plugin tests should cover the success path, input boundaries, duplicate registration, idempotent disposal, and complete plugin teardown.

Run the smallest scope while iterating:

```sh
pnpm exec vitest run packages/rp/character/tests/character.spec.ts
pnpm exec tsc -b packages/rp/character --pretty false
```

Pass multiple affected paths to one Vitest invocation when needed, then run the repository-wide gate at completion.

## 4. Add an infrastructure package

Copy the closest leaf-package structure rather than starting from an aggregate. An ordinary package contains at least:

```text
packages/rp/<name>/
├── package.json
├── tsconfig.json
├── README.md
├── README.zh.md
├── src/
│   ├── index.ts
│   └── invariant.ts
└── tests/
    └── <name>.spec.ts
```

Complete this checklist:

1. Use `@dsh-rp/<name>`, match the Workspace root version, and set the Repository Directory to the real package directory.
2. Publish only compiled `lib/`, declarations, README/License files, and explicitly declared Bundle Patches through `main`, `types`, `exports`, and `files`; never publish `src` or source maps.
3. Reference direct internal dependencies from `tsconfig.json` and emit declarations to `lib/types`.
4. Export the public API and Cordis plugin from `src/index.ts`; keep `src/invariant.ts` limited to stable invariants without Host-private implementation reads.
5. Prove installation, behavior, duplicate registration, failure rollback, and complete disposal in tests.
6. If the package belongs in the default Core or Web distribution, explicitly update the relevant `cordis.patch.yml` and Bundle `dependencies`; not every new package should enter the default aggregate.
7. Update `docs/compatibility.md` and `docs/compatibility.zh.md` for new Host requirements.
8. The current Workspace policy checks an explicit published-package count. An intentional addition or removal must update the expected count in `scripts/check-workspace.ts` and the root README's release statements.

Root TypeScript and `tsdown` configuration discover `packages/rp/*` automatically, but aggregate mounts, compatibility documentation, and release-count expectations still require explicit review.

## 5. Develop an installable RP package

An installable RP package is not a Cordis plugin. Its code receives no `ctx`, cannot call arbitrary Host registration APIs, and cannot depend on repository source paths.

Install the CLI in a separate project:

```sh
pnpm add -D @dsh-rp/cli
pnpm exec dsh-rp init ./my-rp-package --template orchestration
pnpm exec dsh-rp validate ./my-rp-package
pnpm exec dsh-rp test ./my-rp-package
pnpm exec dsh-rp pack ./my-rp-package
```

Templates:

- `orchestration`: code-free L0 Component, Capability, and Turn/Sidecar Pipelines.
- `quickjs-critic`: an L1 QuickJS Workflow capability.
- `ui-panel`: an L0, script-free, integrity-bound sandbox UI Slot.

Trust levels:

| Level | Allowed content | Use |
|---|---|---|
| L0 | Declarative expressions, code-free graphs, HTML/CSS UI | Default choice; no scripts, network, files, or Host objects. |
| L1 | Bounded QuickJS and no-import WebAssembly | Semi-trusted computation; requests `script.execute` and passes Policy. |
| L2 | Explicitly trusted in-process native JavaScript | Audited signed publishers only; not a sandbox and requests `native.execute`. |

The Manifest and `rp.runtime.json` must agree exactly on Components, Capabilities, Pipelines, UI Slots, and permissions. Unknown fields fail closed and do not grant authority. See [RP package authoring](../examples/rp-package-authoring/README.md) for complete examples.

## 6. Develop a compatibility adapter

Treat every external format as untrusted input. An adapter should:

1. Parse bounded bytes without executing scripts, regexes, template helpers, or remote resources.
2. Produce stable public IR rather than leaking ST or another source's private types across every Runtime.
3. Retain provenance, unknown fields, warnings, and path-addressed loss items in `CompatibilityEnvelope`.
4. Separate retained data from retained executable behavior; unsupported behavior may remain inert.
5. Keep the original compatibility resource. If Prompt roles, order, or injection semantics must change, create a separate derived copy after an explicit user action.
6. Test a golden corpus, hostile inputs, and fuzz cases for prototype pollution, path traversal, oversized input, and malformed encoding.

ST is the current first-party compatibility target, not the namespace of the public contracts. Add a concept to `contracts` only when multiple sources and products can interpret it consistently.

## 7. Develop Web or a Product

- Use only public Client Modules, Services, Events, and UI Slots from the target DSH version.
- Fail closed when the Host lacks a requirement; a type declaration cannot fabricate runtime behavior.
- A Product may freely change navigation, editors, default resources, visual design, and workflow.
- Product upgrades must not overwrite imported or edited user data; private persistence schema changes require a migration or explicit rejection policy.
- External sources and Harness-derived resources retain separate identities and provenance.
- Put core behavior in testable Services or pure functions first; React components own projection and interaction only.
- After changing Slots, sessions, Agent Presets, the composer, or model request paths, pack an actual Tarball and run a real Host acceptance test.

`tests/host` implements only the minimum contracts required by browser unit tests. It is not Host compatibility evidence and must never be published.

## 8. Test layers

| Layer | Evidence | Typical command or environment |
|---|---|---|
| Pure function / IR | Validation, ordering, budgets, migrations, serialization | `pnpm exec vitest run <spec>` |
| Cordis lifecycle | Service installation, events, registration, rollback, disposal | Package Vitest with a real `Context` |
| Package and security boundary | Manifests, archives, signatures, SBOMs, trust, sandboxes | SDK/Runtime/Lifecycle tests |
| Browser component | Visible state, submission routing, error presentation | JSDOM with minimal `tests/host` contracts |
| Build and payload | Declarations, ESM, exports, Tarball files | `pnpm run build`, `pnpm run publint` |
| Real Host integration | Bundle Patch, Client Loader, Slots, sessions, AgentLoop | Actual Tarball + disposable `DSH_HOME` + target Profile |
| Release acceptance | Consumer install, checksums, SBOM, Release Manifest | `pnpm run release:verify` / `release:pack` |

Before publication or handoff:

```sh
pnpm run check
pnpm run release:verify
pnpm run release:pack --out dist/npm-rp
```

Run Release Pack only when auditing final artifacts or preparing a release. During ordinary iteration, start with the smallest affected test.

## 9. Definition of done

An infrastructure change is complete when:

- State and lifecycle belong to the smallest correct package, with no reverse edge or new dependency cycle.
- Every registration is reversible, repeated disposal is safe, and failure paths leave no resource behind.
- Inputs, outputs, model projections, and concurrency boundaries have explicit limits.
- Host authority comes from published Peers and Policy rather than patches or private imports.
- Public Contract compatibility, schema, and migration behavior are documented.
- English and Chinese READMEs are synchronized.
- The smallest tests, type checking, and `pnpm run check` pass.
- Real-Tarball integration evidence exists when actual Host behavior changed.
- Publication payloads contain no `src`, source maps, Host Bundles, SDK caches, or test doubles.

## 10. Release rules

Every `@dsh-rp/*` package belongs to one `rp-v<version>` release family:

- All members share one version.
- Release membership is discovered from `packages/rp/*/package.json`.
- Internal `dependencies` / `optionalDependencies` determine topological publication order.
- Publication occurs only from a matching `rp-v<version>` tag.
- Tarballs must pass Publint, throwaway-consumer installation, checksum, and SBOM verification.

See the root [README](../README.en.md#release) for release commands and workflow entry points.
