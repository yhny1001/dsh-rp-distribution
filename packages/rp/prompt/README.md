# @dsh-rp/prompt

English | [中文](README.zh.md)

`ctx.rpPrompt` composes uniquely owned prompt sections using explicit before/after constraints and deterministic priority tie-breaking. Missing dependencies and cycles fail loudly.

## Model Experience

Indirectly, through the Agent consumer that places composed sections into a model request.

#### KV Cache effect

Stable section ids and ordering make the reusable prefix explicit.

## Known Limitations and Deferred Work

- Token-aware truncation belongs to a separate context-budget policy plugin.
