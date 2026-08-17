# Plugin architecture

English | [中文](architecture.zh.md)

This repository is one release family of Cordis plugins. It has no DSH application entry and no private copy of Host services.

## Package layers

The RP service packages own versioned contracts and reversible registrations. `distribution-core` declares the presentation-neutral mount order. `distribution-web` declares only `ui-slot-runtime` and `web`; `distribution` concatenates those two patch layers as the one-command Web entry. Tests keep the aggregate Patch byte-identical to its owners.

`@dsh-rp/product` is a local-first product Bundle independent from the complete distribution family. It packs a Node API, Client UI, and `rp-studio` Agent preset into one installable Tarball and uses only the `webServer`, `commands`, `agentPresets`, and official Web Slots already present in DSH `0.1.0-rc.6`. It starts no second generation loop. Five separately named System Prompt sections project system rules, world facts, the character cast, the user persona, and the current scene while the native AgentLoop continues to execute the conversation.

Every `@deepseek-ai/*` package is an external Peer. Exact development versions are read from package Manifests by `scripts/fetch-host-sdk.ts`; their npm artifacts form an ignored SDK cache. The cache can be deleted at any time and is never part of an npm payload.

## Compatibility ownership

Core code compiles against published Host service packages. The Web plugin additionally needs generic slots for RP Studio and conversation placement, plus the alternative conversation-submission API. Until those declarations ship in the selected public Host packages, `types/host-extensions.d.ts` records the exact type-only requirement. It contains no implementation or fallback.

Runtime compatibility therefore remains fail-closed: an older Host cannot acquire missing services by installing this plugin, and installation never modifies Host code. A DSH release supports the Web bundle only when it implements the extensions listed in [compatibility.md](compatibility.md).

## Testing split

RP unit tests own package behavior, lifecycle rollback, policy, persistence adapters, package compatibility, API validation, and browser presentation. Small browser Host contracts used by component tests live under `tests/host` and are not published. The product Bundle is additionally verified with a disposable DSH home, its actual Tarball, a real Web Profile, and the Codex in-app Browser; the complete distribution family's Host assembly remains a separate acceptance surface.
