# @dsh-rp/workflow-router

English | [中文](README.zh.md)

Policy-aware routing for replaceable deterministic, Worker Thread, isolated-process, QuickJS, WASM, and remote RP workflow backends. Backends are reversible plugins; selection is deterministic and each run has cancellation, timeout, trust, and audit events. A backend above L0 is never selected unless the request carries an effective authority at least as trusted as that backend.

The bundled deterministic backend executes a bounded declarative expression language and never evaluates JavaScript. The distribution also mounts L0 Worker Thread and sanitized isolated-process providers from `@dsh-rp/workflow-backends-local`, plus independently permission-checked L1 QuickJS and no-import WASM providers from `@dsh-rp/workflow-backends-sandbox`. Worker Thread is containment, not a security sandbox.

## Model Experience

Indirectly, through the selected workflow backend and its Agent consumers.

#### KV Cache effect

The router contributes no prompt text; a selected backend owns any model request and cache behavior.

## Known Limitations and Deferred Work

- The distribution includes local containment and L1 language sandboxes. Remote workers and hardened OS-policy sandboxes remain independently installed Providers.
