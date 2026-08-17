# `@dsh-rp/agent-runtime`

English | [中文](README.zh.md)

`ctx.rpAgents` is the provider-neutral execution seam for RP Agent roles. A role registration publishes one executable `kind: agent` contribution into the unified Capability Catalog; the Catalog remains the only authorization route. After authorization, the runtime deterministically selects the role's exact Provider or the highest-priority compatible Provider and forwards the immutable effective authority without widening it.

Roles declare instructions, scopes, permissions, trust, budgets, schemas, and allowed capability families. Mutable registration inputs are copied; nested schemas are validated as lossless finite JSON and deeply frozen before publication. Providers own execution and may use Harness Subagents, a remote worker, a deterministic test engine, or another transport. Provider removal blocks new runs without mutating role definitions. Role, Provider, and run lifecycle events are observe-only; durable Agent records remain the owning Provider's responsibility because only it knows the concrete child identity.

Every role and Provider registration is a reversible Cordis Effect. Removing a role also removes its Catalog entry; removing the runtime fiber releases all owned contributions without a process singleton.

## Model Experience

### Executable role context

#### What the model sees

The parent model sees role metadata only through a consumer such as `rp_capability`. Role instructions reach a child model only when the selected Provider deliberately composes them for that Agent run; the runtime itself adds no prompt text.

#### Token effect

Catalog discovery adds the bounded role descriptor selected by its consumer. An invocation adds only the selected Provider's child request and the bounded result returned to the caller.

#### KV Cache effect

Role Catalog metadata is prefix-stable while registrations are unchanged. Provider selection and process-local lifecycle events do not alter a model request by themselves.

## Known Limitations and Deferred Work

- One invocation consumes one Agent unit. Cross-stage aggregate `maxAgents` accounting belongs to the Pipeline or turn budget owner rather than this provider-neutral router.
- The runtime does not silently fall back from a missing explicitly pinned Provider.
