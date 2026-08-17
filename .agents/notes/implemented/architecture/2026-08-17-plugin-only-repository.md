# Agent Note: Plugin-only repository

Status: implemented

## Problem

Maintaining RP plugins inside a complete DSH fork makes every Host application, platform, documentation, and release change appear to be an RP responsibility. It obscures the plugin contract and forces RP releases to carry unrelated source and CI infrastructure.

## Decision

This repository owns only the `@dsh-rp/*` plugin family. DSH and Cordis are external Hosts expressed through exact-version Peer dependencies. Development obtains published Host artifacts through an ignored generated SDK cache; no Host source or application dependency graph is committed. Core and Web bundles remain separate, and Web-only extensions are explicit type requirements without runtime shims.

The repository publishes one shared-version `rp-v<version>` family. Tests own RP behavior; assembled DSH application and platform compatibility remain in the Host repository.

## Alternatives considered

**Continue the complete DSH fork.** Rejected because it assigns unrelated Host maintenance and release work to the plugin project.

**Keep a Vendored DSH source snapshot.** Rejected because a snapshot becomes another Host implementation to update and review. Generated npm Artifact caches provide development declarations without source ownership.

**Patch an installed Host.** Rejected because hidden mutation is not reproducible or safely uninstallable. Missing Host extensions remain explicit compatibility failures.

## Consequences

The tracked repository is much smaller and its CI, versioning, documentation, and publication all describe plugins. Web compatibility remains narrower than Core until DSH publishes the required generic extension points. Host integration tests must run in a compatible DSH checkout instead of this repository.
