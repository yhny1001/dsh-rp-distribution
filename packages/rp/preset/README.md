# @dsh-rp/preset

English | [中文](README.zh.md)

`ctx.rpPresets` durably saves prompt presets, binds one preset to an exact RP scope, resolves the nearest binding through the scope ancestry, and freezes a content-addressed snapshot before a Turn executes. The immutable snapshot includes every definition and order profile, the selected profile, effective sections, generation data, compatibility provenance, and the exact binding scope. The Storage Domain route selects the persistence backend.

## Model Experience

Indirectly, through the Turn Pipeline that places the frozen active preset sections into the Agent request.

#### KV Cache effect

An unchanged active preset preserves stable section ids, order, and content; saving or activating different content changes the request prefix on the next Turn.

## Known Limitations and Deferred Work

- Provider-specific sampler fields remain data until the selected Agent or model Provider explicitly maps them; prompt sections are applied independently.
