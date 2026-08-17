# @dsh-rp/journal

English | [中文](README.zh.md)

`ctx.rpJournal` writes RP facts into the Harness `SessionEvent` log. The event vocabulary covers composition, context, pipelines, agents, capability authorization and settlement, state, branches, memory, media, turn commit, and turn abort. `RP_JOURNAL_EVENT_TYPES` exposes the type-checked required vocabulary to bounded import and evaluation consumers.

Every Pipeline Stage fact carries the complete Turn, Pipeline id, kind, and snapshot-hash identity. Concurrent or nested graphs can therefore share a Turn without making replay depend on listener timing.

The complete post-turn state is one `rp/turn-committed` event. This makes local commit atomic at the Session-log publication point: a failed validation or append produces no partial state, and replay consumers do not join several independently committed records to discover whether a turn completed.

## Model Experience

Indirectly, through projection and prompt consumers that render durable RP facts. The journal itself adds no model input.

#### KV Cache effect

Append-only. A consumer may append projected RP context after an already reusable request prefix.

## Known Limitations and Deferred Work

- **External effects excluded** — network, media, and other external side effects require an outbox or Saga plugin; this package guarantees atomicity only for the local Session event.
