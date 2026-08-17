# Plugin architecture

English | [中文](architecture.zh.md)

This repository is one release family of Cordis plugins. It has no DSH application entry and no private copy of Host services.

## Package layers

The RP service packages own versioned contracts and reversible registrations. `distribution-core` declares the presentation-neutral mount order. `distribution-web` declares only `ui-slot-runtime` and `web`; `distribution` concatenates those two patch layers as the one-command Web entry. Tests keep the aggregate Patch byte-identical to its owners.

Every `@deepseek-ai/*` package is an external Peer. Exact development versions are read from package Manifests by `scripts/fetch-host-sdk.ts`; their npm artifacts form an ignored SDK cache. The cache can be deleted at any time and is never part of an npm payload.

## Compatibility ownership

Core code compiles against published Host service packages. The Web plugin additionally needs generic slots for RP Studio and conversation placement, plus the alternative conversation-submission API. Until those declarations ship in the selected public Host packages, `types/host-extensions.d.ts` records the exact type-only requirement. It contains no implementation or fallback.

Runtime compatibility therefore remains fail-closed: an older Host cannot acquire missing services by installing this plugin, and installation never modifies Host code. A DSH release supports the Web bundle only when it implements the extensions listed in [compatibility.md](compatibility.md).

## Testing split

RP unit tests own package behavior, lifecycle rollback, policy, persistence adapters, package compatibility, API validation, and browser presentation. Small browser Host contracts used by component tests live under `tests/host` and are not published. Full Host boot, DSH profile assembly, native platform behavior, and the resident Web shell remain DSH responsibilities.
