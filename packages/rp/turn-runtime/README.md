# @dsh-rp/turn-runtime

English | [中文](README.zh.md)

`ctx.rpTurn` coordinates `prepare → execute → validate → commit` and `abort`. `run()` owns that complete transaction and records an abort automatically when execution or validation fails. Prepare resolves the component composition and captures an executable plan for the named Turn Pipeline plus every nested graph before any Stage runs. Execute uses that exact plan after hot replacement or removal and refuses a result whose recursively bound snapshot hash differs from the prepared snapshot.

The service captures its component, Pipeline, Projection, and Journal dependencies when its own Cordis injections activate. Public calls therefore remain valid from a restricted consumer plugin or retained HTTP handler; caller tracing cannot replace the runtime's private dependency authority.

The Turn's Session receives the exact input and Host context in versioned `rp/context-activated` data, followed by `rp/pipeline-started`, `rp/pipeline-stage`, and terminal Pipeline facts through the runtime observer. Nested graphs retain their own kind, id, and snapshot hash under the same Turn correlation id, so replay never infers Stage ownership from timing.

Prepare also folds the authoritative Event Log into a scope-specific `RpTurnContextSnapshot`, namespaces caller-supplied context separately, and freezes both into the draft and Pipeline metadata. At each prepare boundary it late-resolves the optional `ctx.rpPresets` service and captures the nearest active preset as an immutable content-addressed snapshot. This keeps load order replaceable while ensuring an activation or hot update affects only the next Turn. The exact preset snapshot is recorded in `rp/context-activated`. State patches require their complete resulting document and are checked against the captured owner revision; relationship revisions and duplicate memories are checked against the same boundary before commit.

A normal Turn Pipeline publishes a JSON object at `turn.effects`; the runtime decodes and validates its assistant message, state, memory, relationships, scene, branch, usage, and metadata. Supplying effects directly to `execute()` remains a compatibility path for adapters migrating from the former caller-owned output boundary.

Commit stores the assistant output, state, memory, relationships, scene, branch, traces, and snapshot identities in one `rp/turn-committed` Session event. Abort writes only `rp/turn-aborted`; neither path can follow another terminal operation for the same live transaction.

## Model Experience

Indirectly, through the selected Turn Pipeline. This coordinator adds no prompt text or schema.

#### KV Cache effect

None directly. The frozen composition and pipeline hashes let model-facing consumers decide whether an assembled prefix remains reusable.

## Known Limitations and Deferred Work

- **Live transaction ownership** — prepared transactions are process-local until commit or abort; a crash leaves the durable prepare diagnostics without a terminal RP commit and recovery policy may append an abort.
