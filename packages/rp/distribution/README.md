# `@dsh-rp/distribution`

English | [中文](README.zh.md)

Installable external DSH plugin bundle that composes `@dsh-rp/distribution-core` and `@dsh-rp/distribution-web`. It mounts the complete RP runtime and browser Studio without making RP code part of the DSH application package.

Install it into an ordinary DSH Web profile; the plugin manager adds it as a later bundle layer and removing the dependency removes the layer again:

```sh
dsh plugin --profile web add @dsh-rp/distribution
dsh --profile web
dsh plugin --profile web remove @dsh-rp/distribution
```

For Headless, install `@dsh-rp/distribution-core` instead so the profile never loads browser packages. Every inserted row remains replaceable by a later profile patch.

## Host compatibility

The package uses DSH's public `dsh.bundle` manifest and profile-plugin lifecycle. The Core and Web layers declare their Host peers separately so an unsupported installation fails during dependency or compatibility checks. See the [Host compatibility reference](../../../docs/compatibility.md).

The bundled durable Memory Provider injects Harness `storageDomain`. The standard Web profile already mounts a durable backend and the Domain facility; a Headless deployment must mount and route those infrastructure plugins explicitly.

The default bundle mounts `rp_capability` with an L2 ceiling, the narrow `script.execute`, `native.execute`, `rp.pipeline.execute`, `rp.sidecar.start`, and `agent:spawn` permissions, and no network or file roots. A top-level Agent can therefore discover and invoke bounded package runtimes, first-party RP Pipelines, executable RP role templates, and owner-fenced asynchronous Sidecars. The Harness Agent Provider prefers `fork` and falls back to `spawn`, enforces depth, timeout, cancellation, and token ceilings, and records concrete child delegation in the parent Session. Sidecars return a Harness Job id immediately, inherit the target graph's authority and budget, and journal their frozen Pipeline lifecycle. The bundle still cannot reach L2 native Workflow Backends because `workflow.native` is absent, nor can it widen any allowlist.

## Model Experience

Indirectly, through the mounted RP and Harness plugins selected by the active Experience.

#### KV Cache effect

The bundle itself adds no model context; mounted consumers own their cache effects.

## Known Limitations and Deferred Work

- **Host version range** — the currently pinned upstream Harness baseline lacks some Web submission and slot APIs used by the Studio. Publish this bundle only with the matching DSH compatibility range; do not patch installed `node_modules` during installation.
