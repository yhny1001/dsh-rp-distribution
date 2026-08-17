# Preset Definition package-boundary projection

Date: 2026-08-17. Status: implemented locally.

## Problem

`@dsh-rp/compat-sillytavern` Prompt Definitions own `systemPrompt`, `forbidOverrides`, and injection metadata for faithful import, while core `@dsh-rp/preset` Definitions own only `schemaVersion`, `id`, `name`, `role`, `content`, and `marker`. Web Creator's `toPresetRecord()` passed the complete adapter IR directly, so the core strict Zod schema rejected every definition with `unrecognized_keys`. Product-focused tests did not exercise this cross-package Creator path, leaving `packages/rp/web/tests/preset-api.spec.ts` as the sole GitHub CI failure.

## Decision

The core Preset schema is not widened and Core receives no silent compatibility-key stripping fallback. The Web boundary explicitly constructs each core Definition from its six owned fields; SillyTavern-specific data remains owned by compatibility IR, the source document, and Product adaptation resources. Adapter knowledge stays in the Adapter/Web Consumer rather than becoming a core persistence dependency, while Prompt content, role, marker, complete order, enablement, and generation data remain intact.

## Verification

Cross-package input now includes `system_prompt`, `forbid_overrides`, `injection_position`, `injection_depth`, `injection_order`, and `injection_trigger`. The test requires the saved core Definition to equal the exact six-field record with no compatibility keys, while save, activate, in-place edit, Host-restart recovery, and deactivate continue to pass. Verification runs the formerly failing test, complete `pnpm run check`, and `pnpm run release:verify` before push, then waits for GitHub Actions to pass.
