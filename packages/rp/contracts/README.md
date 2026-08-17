# @dsh-rp/contracts

English | [中文](README.zh.md)

Client-safe RP data declarations shared by Host plugins, Web clients, package tooling, and compatibility adapters. Every durable or external representation carries `schemaVersion`; imported fields that the runtime does not understand stay inert in `CompatibilityEnvelope`.

Opaque identifiers use branded strings. The package owns no storage, registration, execution, or defaulting behavior.

## Model Experience

None, as this package contributes types but does not assemble prompts, schemas, messages, or model requests.

#### KV Cache effect

None; the package has no runtime model-context contribution.

## Known Limitations and Deferred Work

- **Schema version 1 only** — migrations are owned by the importing or persistence plugin because this package contains no runtime parser.
