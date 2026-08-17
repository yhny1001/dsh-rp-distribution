# `@dsh-rp/registry-sources`

English | [中文](README.zh.md)

Inert package-evidence source Providers for `ctx.rpRegistry`: canonical local packages, pinned GitHub/GitLab refs, exact npm versions with an embedded `dshRp` manifest, and open Registry endpoints. When a manifest declares payload or SBOM integrity, the Provider acquires matching sibling files, a bounded npm release envelope, or same-origin Registry URLs. Acquisition never executes package code.

Local manifests and evidence must resolve beneath an allowlisted canonical root. Network access is denied until exact origins are configured; redirects and credential-bearing URLs are rejected. JSON and archive bodies are streamed under independent size ceilings.

`@dsh-rp/registry-server` is the matching self-hosted MIT reference endpoint. Its release envelope is consumed without a special client path, so the same Provider and Host integrity checks apply to reference, third-party, and mirrored Registries.

## Model Experience

Indirectly, through Agent or Studio consumers that inspect resolved package metadata.

#### KV Cache effect

The Providers contribute no prompt text; consumers own any rendered package metadata.

## Known Limitations and Deferred Work

- Git adapters cover GitHub and GitLab clean-room raw-file URLs. npm packages embed the Manifest as `dshRp` and carry `rp.package.tgz` plus `rp.sbom.json` inside the distribution tarball. The Provider validates bounded outer entries and matching metadata, then returns the inner evidence to Registry verification; runtime archive parsing and execution remain lifecycle-adapter responsibilities.
