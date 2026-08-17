# `@dsh-rp/relationship`

English | [中文](README.zh.md)

Owner-scoped directed relationship graph with optimistic revisions, deterministic listing, bounded dimensions, and immutable notes.

## Model Experience

Indirectly, through an Agent or Prompt consumer that selects relationship state for model context.

#### KV Cache effect

The service adds no prompt text; consumers own relationship rendering and cache placement.

## Known Limitations and Deferred Work

- Relationship inference and durable replay remain separate Sidecar and Session consumers; this package owns only validated live projection.
