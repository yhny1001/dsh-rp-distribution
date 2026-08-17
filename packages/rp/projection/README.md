# @dsh-rp/projection

English | [中文](README.zh.md)

`projectRpSession()` reconstructs current RP state and execution topology from the complete ordered Session log. `ctx.rpProjection` exposes the same fold for a live `Session`. The package keeps no cache and rejects a turn id that has more than one commit-or-abort terminal event.

`projectRpScope()` and `ctx.rpProjection.projectScope()` materialize owner-keyed state, memory, relationships, scene, branches, and dialogue history for one exact scope at a recorded Session event boundary. Turn preparation freezes this result directly from the log, so the next turn sees the previous commit without copying effects into several mutable Stores; restored Sessions use the identical fold after a crash.

Turn commits update state and scene by latest committed value, memories by id, relationships by directed entity pair, and branches by branch id. This keeps edit, replay, resume, and fork behavior dependent on one durable source.

Capability authorization and terminal settlement events rebuild the Agent decision timeline by tool-call id, including effective trust, permissions, budget, network domains, file roots, policy layers, and failure diagnostics.

Composition, context, Pipeline stages, delegated Agents, state validation, branch activation, memory acceptance and compaction, and external media work each rebuild into typed lifecycle projections. Every Stage carries its Pipeline id, kind, and snapshot hash, so nested or concurrent graphs remain unambiguous. The fold is a strict state machine: a completion without its start, a duplicate terminal, or a changed frozen identity fails rather than inventing missing history. Atomic Turn commits can supply their own complete composition, Pipeline, state, memory, branch, and Agent trace when no standalone lifecycle event exists.

## Model Experience

Indirectly, through prompt or context plugins that render selected projection fields.

#### KV Cache effect

None directly. Projection consumers decide which appended facts enter later requests.

## Known Limitations and Deferred Work

- **Full-log fold** — checkpoint and incremental projection providers can replace this implementation without changing its result type.
