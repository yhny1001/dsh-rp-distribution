# @dsh-rp/ui-slot-runtime

English | [中文](README.zh.md)

`ctx.rpUiSlots` is the Host-side registry for installable package UI. It is deliberately separate from the compile-time React Slot registry: trusted first-party client plugins may still contribute native React components, while a downloaded RP package contributes only a versioned descriptor and integrity-verified static resources.

Every registration copies its resource bytes, publishes immutable metadata, and returns an idempotent disposer. Package Lifecycle adapters register UI in the same activation transaction as Components, Pipelines, and Capabilities. A collision rolls the complete activation back; update and uninstall remove the Slot before its archive ownership is released.

The runtime accepts the fixed placements `studio.overview`, `studio.creator`, `studio.inspector`, `conversation.sidebar`, and `message.after`. Runtime v1 UI is declarative HTML/CSS for every package trust level; `script: sandbox` is reserved but fails closed. L1 QuickJS/WASM remains available for model capabilities, not browser DOM code. Trust never grants same-origin access: DSH Web embeds package entries in an iframe without `allow-same-origin`, scripts, forms, popups, downloads, top navigation, or Host APIs. HTML validation rejects active/navigating elements, external URLs, event handlers, and undeclared resources. Response headers restrict CSS, images, fonts, and media to the exact live package/Slot path and deny connections, nested frames, workers, objects, forms, referrers, and scripts.

An entry and every subresource must appear in the Slot asset list, the package Manifest asset list, and the integrity-bound archive. Unsafe paths, absent files, duplicate identities, declaration mismatches, and unsupported placements fail before publication. Resource lookup is scoped by package and Slot, returns detached bytes, and stops resolving immediately after disposal.

## Model Experience

None, as package UI observes Host-projected metadata outside model requests and receives no model, Tool, Session, filesystem, secret, or network authority.

#### KV Cache effect

None. UI resources do not enter model context.

## Known Limitations and Deferred Work

- DSH Web mounts all five placements. `conversation.sidebar` enters the session-bound additive Sidebar seat, while `message.after` follows user and Assistant rows; both reuse the same apply-scoped catalog snapshot as Studio and disappear when their package registration is disposed.
- Frames are intentionally declarative and one-way in v1: no browser script, `postMessage` Host bridge, or dynamic height protocol is exposed. Interactivity that needs Host data must go through a future versioned, permission-checked declarative event bridge.
