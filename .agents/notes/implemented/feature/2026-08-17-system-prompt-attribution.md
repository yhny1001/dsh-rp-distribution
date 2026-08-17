# System Prompt injection attribution

Date: 2026-08-17. Status: implemented locally.

## Problem

The RP product already writes imported presets, characters, personas, lorebooks, scenes, and runtime protocols to `request/header.header.system` through `ctx.systemPrompt.section()`, but native DSH conversation renders only a dynamic Context Snapshot attributed to `@deepseek-ai/dsh-system-prompt`. That snapshot contains sandbox, workspace, and approval policy only, yet the generic “context injection” label reasonably suggests that the complete preset never entered DeepSeek's `system` field. Character Card `first_mes` appears separately as `@dsh-rp/product` `plugin/recall` history, further obscuring the distinction between System and History carriers.

## Decision

The preset is not duplicated into the dynamic Context Snapshot, and Session History provenance remains unchanged. Quick setup, the Session header, compact Composer control, full composition, and Prompt Manager consistently expose `Preset → @deepseek-ai/dsh-system-prompt → request.system`. The compact control uses `SYSTEM ✓` rather than restoring the wide Prompt Stack previously removed from the Composer. Composition preview calls only non-History layers System Prompt and explains that the chat-history marker plus Character Card `first_mes` remain in native Session History. The `rp-studio-bind` receipt and `rp-agent`/`rp-tavern` selector descriptions record the same route so durable trajectory, launch surface, and management surface agree.

## Verification

A unit test requires the bind receipt to name `@deepseek-ai/dsh-system-prompt` and `request.system`. After installing the actual Tarball into a disposable DSH home, the Codex in-app browser verifies quick setup, Agent Preset descriptions, Composer `SYSTEM ✓`, full-composition route, and Prompt Manager route. The resulting `request/header.header.system` is then checked to contain one complete preset while native `user/message` retains only real user input, the dynamic permission snapshot, and explicitly framed character history.
