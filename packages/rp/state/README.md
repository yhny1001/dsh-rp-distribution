# @dsh-rp/state

English | [中文](README.zh.md)

`ctx.rpState` stores owner-isolated state documents per RP scope and applies RFC 6901-style JSON Pointer patches against an exact base revision. A patch is evaluated on a detached clone and becomes visible only after every operation succeeds.

## Model Experience

Indirectly, through the prompt consumer that selects committed state fields for a model request.

#### KV Cache effect

None directly. Prompt plugins decide how much committed state enters the model prefix.

## Known Limitations and Deferred Work

- Durability is supplied by journal projection; this service intentionally owns only the live scoped projection.
