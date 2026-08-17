# @dsh-rp/component-runtime

English | [中文](README.zh.md)

`ctx.rpComponents` is the dynamic registry for RP package contributions. Each registration returns a disposer; resolution validates exact dependencies, supported scopes, and granted capabilities before publishing an immutable `RpCompositionSnapshot`.

Composition ids hash the scope, authority, component versions, dependencies, and declared capabilities. `createdAt` is observational and is not part of the hash, so equivalent resolutions have the same identity while retaining their own publication time.

Version requirements currently accept an exact version or `*`. Missing optional dependencies are skipped; missing required dependencies, cycles, scope mismatches, and denied required capabilities fail resolution.

## Model Experience

Indirectly, through consumers that use a frozen composition to assemble prompts, tools, agents, and pipelines.

#### KV Cache effect

None directly. Consumers can use the deterministic composition id to retain or invalidate their own assembled prefixes.

## Known Limitations and Deferred Work

- **Exact version matching** — range negotiation is intentionally absent until the package registry owns one canonical semver resolver.
