# @dsh-rp/tool-capability

English | [中文](README.zh.md)

Registers the model-facing `rp_capability` tool. `action=list` returns only executable capabilities within the configured Agent trust and permission ceiling. `action=invoke` routes the exact id and JSON input through `ctx.rpCapabilities`; it never calls a Provider directly.

The default configuration is deny-by-default L0 with no permissions, network domains, or file roots. A deployment may opt into L1 `script.execute`; L2 native workflows require a separate explicit grant. The configured ceiling is also supplied as a per-Agent policy layer, so Catalog authorizers and deployment/product policy may narrow it again.

Authorization is fail-closed and audited before execution. The tool appends `rp/capability-authorized` with the immutable effective authority and pairs it with `rp/capability-settled` as completed, failed, or denied. The RP Projection and Studio Timeline can reconstruct the decision without process-local state.

## Model Experience

### Tool schema

#### What the model sees

The model sees the registered `rp_capability` schema. Its description directs discovery before invocation and states that Policy intersection is authoritative.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Registry changes affect list results rather than the schema.

### Discovery, result, and denial

#### What the model sees

`action=list` returns bounded capability metadata. `action=invoke` returns the owning adapter's JSON result. Denials and failures are normalized as `Error: <message>`; audit events are Timeline and replay state, not an additional model message.

#### Token effect

List tokens scale with the authorized live catalog. Invocation tokens scale with the selected adapter's bounded JSON result and remain in call history until compaction.

#### KV Cache effect

Append-only; newly visible call results follow the reusable request prefix.

## Known Limitations and Deferred Work

- **Generic JSON boundary** — capability-specific schemas are returned during discovery, but the selected owning adapter remains responsible for validating its input.
- **One deployment ceiling** — finer user/profile grants are supplied by Policy layers; this tool intentionally does not maintain a second permission database.
