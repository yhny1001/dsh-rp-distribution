# `@dsh-rp/scene`

English | [中文](README.zh.md)

Owner-scoped active-scene projection with complete replacement, optimistic revisions, participant validation, and immutable snapshots.

## Model Experience

Indirectly, through an Agent or Prompt consumer that selects the current scene for model context.

#### KV Cache effect

The service adds no prompt text; consumers own scene rendering and cache placement.

## Known Limitations and Deferred Work

- The live projection is rebuilt by a Session consumer; this package intentionally owns no persistence medium or model-facing rendering.
