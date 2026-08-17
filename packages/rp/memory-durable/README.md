# `@dsh-rp/memory-durable`

English | [中文](README.zh.md)

Durable RP memory and a persisted local vector-index Provider over Harness `ctx.storage.domain`. The Provider inherits whichever backend the deployment routes for domain `dsh_rp_memory` (the standard Web profile uses its durable JSON backend; deployments can route the same contract to SQLite).

`appendDurable()` waits for backend durability before publishing a fact to the live memory projection. `hydrate()` validates and loads a scope once per Provider. Event ids are conflict-safe and idempotent; scope identity includes its complete parent chain. Each durable record carries a compact, precomputed 256-dimensional signed-FNV vector that is restored with the event and reused by the highest-priority local retriever.

## Model Experience

Indirectly, through long-running companion, world-simulation, and adaptive Experiences that restore accepted facts before context assembly.

#### KV Cache effect

Hydration and retrieval contribute only the selected memory text. The storage Provider itself adds no prompt text.

## Known Limitations and Deferred Work

- Retrieval is local and deterministic, not semantic embedding inference. A third-party embedding Provider can replace the retriever without changing durable event ownership.
- Scope release serializes record deletions through the domain write chain, but a backend failure can leave a recoverable subset to retry; it is not represented as a cross-record database transaction.
- Large deployments should add an indexed storage facet for direct scope scans. The portable domain implementation currently filters the validated in-memory table snapshot.
