# `@dsh-rp/memory-vector`

English | [中文](README.zh.md)

Reversible local vector retrieval Provider for `ctx.rpMemory`. It uses a deterministic 256-dimensional signed token hash, requires no model or network call, and becomes the preferred retriever while installed.

## Model Experience

Indirectly, through a Prompt or Agent consumer that selects the Provider's ranked memory hits for model context.

#### KV Cache effect

The Provider adds no prompt text; consumers own hit rendering and cache placement.

## Known Limitations and Deferred Work

- Hash vectors improve deterministic ranking and replacement mechanics but are not semantic embedding models. External embedding and durable vector-database implementations remain separate Providers with explicit network and storage permissions.
