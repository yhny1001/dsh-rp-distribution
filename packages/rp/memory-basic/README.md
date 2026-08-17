# @dsh-rp/memory-basic

English | [中文](README.zh.md)

`ctx.rpMemory` is a bounded, parent-aware canonical memory projection with idempotent append plus reversible retrieval and durable-store Provider registries. Its built-in lexical Provider is the zero-infrastructure fallback. `hydrate()`, `appendDurable()`, and `releaseDurable()` route IO to the selected store while preserving the same live search API; failed durable writes never publish partial live state.

`searchEvents()` applies the selected Retriever to a caller-supplied immutable Event Log projection without inserting those facts into process-local memory. Turn Pipelines use this path so replay is authoritative while retrieval algorithms remain replaceable.

## Model Experience

Indirectly, through the prompt consumer that selects retrieved facts for a model request.

#### KV Cache effect

Retrieved facts change the dynamic prompt suffix; stable facts retain deterministic ordering.

## Known Limitations and Deferred Work

- Plain `append()` remains an explicitly process-local compatibility path. Production Experiences use the durable APIs when a store is mounted.
- Durable compaction and external semantic embeddings belong to permission-declared sidecar and retrieval Provider plugins.
