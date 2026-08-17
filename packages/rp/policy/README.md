# @dsh-rp/policy

English | [中文](README.zh.md)

Computes effective plugin and Agent authority as an intersection of reversible deployment/product layers and per-call plugin, user, Agent, and budget layers. Permissions, domain allowlists, file roots, trust ceilings, and numeric budgets are immutable in the returned decision.

An L2 request is denied rather than silently downgraded when any layer limits the operation to L0 or L1. An empty explicit allowlist denies that entire dimension; an omitted allowlist does not constrain it.

The service registers itself as a reversible Capability Catalog authorizer. Deployment and product layers therefore apply to every unified capability call, together with the plugin descriptor, user/Agent ceiling, and per-call layer, before the owning adapter receives control.

## Model Experience

None, as the policy service filters authority and contributes no prompt or provider request content.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Canonical domain and filesystem path normalization belongs to the concrete network/filesystem sandbox provider; this service intersects declared names.
- Cryptographic publisher trust is separate from runtime trust level.
