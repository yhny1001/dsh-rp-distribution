# @dsh-rp/registry

English | [中文](README.zh.md)

MIT reference registry core for RP packages. It validates manifests without execution, supports reversible local/Git/npm/registry source providers, resolves dependency graphs into deterministic locks, verifies payload SHA-256, hash-bound SBOMs, and trusted Ed25519 signatures, and fails closed on package or signing-key revocations.

Deployment plugins reversibly register trusted public keys and conjunctive policies. Policies can require payload integrity, signatures, and SBOMs for selected trust levels. Locks bind the manifest hash, payload hash, signer, SBOM hash, source, exact version, and dependency graph.

Metadata-only `publish()` remains available for open catalog mirroring and is explicitly marked `evidenceVerified: false`. Evidence policies require the Provider-backed `install()` path and prevent unverified releases from resolving or entering a lock.

`install()`, `update()`, and `uninstall()` are serialized lifecycle transactions. A committed root stores its exact graph and each active package tracks its owners, so identical dependencies are shared and conflicting versions fail closed. Lifecycle adapters use asynchronous side-effect-free preparation followed by synchronous reversible activation. Activation failure rolls back dependencies; update prepares a restoration path before replacing the previous graph. L1 and L2 releases require an explicit adapter, while L0 releases may remain inert data.

The Registry exposes detached installations, active-package ownership, source Providers, lifecycle adapters, and evidence policies for Headless and Web permission inspection. Observer errors after commit are logged without changing the transaction result.

One optional `RpRegistryInstallationStore` forms the durability boundary. Registry persists a replacement before publishing its live ownership and restores runtime state when a durable mutation fails. `@dsh-rp/registry-durable` supplies the default Storage Domain implementation and verified startup replay used by the distribution.

One optional `RpPackageArtifactStore` caches integrity-bound archives by lowercase SHA-256. Registry verifies source or cached bytes before use, publishes newly verified source bytes to the cache before committing an installation, and gives lifecycle adapters detached payload and SBOM copies. `@dsh-rp/registry-artifacts-local` supplies the distribution's durable local implementation.

Network and package-manager behavior is intentionally supplied by source-provider plugins, so deployments can apply their own credentials, proxy, signature, and sandbox policy without coupling those concerns to the registry graph.

`@dsh-rp/registry-server` supplies the separate MIT self-hosted publication side: immutable artifacts, atomic catalog, append-only revocations, a zero-script Web catalog, and the open HTTP response consumed by Registry source Providers.

## Model Experience

Indirectly, through Agent consumers that inspect package metadata or dependency locks.

#### KV Cache effect

Registry changes affect model context only when a consumer renders the changed catalog.

## Known Limitations and Deferred Work

- Core-only deployments without an installation store remain process-local. Without an artifact store, archives are reacquired from their configured source. Transparency logs, vulnerability scanners, persistent revocation mirrors, archive extraction, and distributed publication remain separate plugins.
- Lifecycle disposers are required to be total and non-throwing. A broken third-party disposer can make its own external effects uncertain even though Registry ownership is removed.
