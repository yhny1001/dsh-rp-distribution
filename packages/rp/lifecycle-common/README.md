# `@dsh-rp/lifecycle-common`

English | [中文](README.zh.md)

Shared fail-closed preparation and reversible publication used by the independent L0, L1, and L2 package lifecycle plugins. It converts one Registry-verified archive into immutable Component, named Pipeline, and Capability registrations without executing package code during preparation.

Every executable package requires payload SHA-256 evidence. L2 callers can additionally require a Registry-trusted signature and a hash-bound SBOM. Capability permissions must be a subset of the Manifest, and each executable capability must repeat its trust-specific execution permission. Activation registers components, then Pipeline graphs, then Catalog capabilities; a Pipeline capability delegates to the graph with the least effective authority and returns its final frame values. Partial publication rolls back, and uninstall or plugin update releases every registration in reverse order.

## Model Experience

Indirectly, through capabilities later selected by an Agent or Pipeline.

#### KV Cache effect

None by itself. Selected capability consumers own any model-visible rendering.

## Known Limitations and Deferred Work

- The shared layer owns registration metadata and lifecycle atomicity, not trust-specific execution.
- Cleanup is deliberately total and best-effort because Registry teardown cannot recover from a disposer that throws; owning registries are expected to provide idempotent disposers.
