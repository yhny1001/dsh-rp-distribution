# @dsh-rp/capability-catalog

English | [中文](README.zh.md)

`ctx.rpCapabilities` provides one discovery directory over Tool, Skill, Subagent, Agent, Pipeline, Memory, Lore, Media, and Rules adapters. The catalog never replaces an owning registry: each executable contribution carries a bridge that delegates to its owner after scope, permission, and budget checks.

`list()` returns only metadata and supports conjunctive kind, scope, tag, permission, and trust-ceiling filters. `invoke()` requires explicit caller permissions and trust, intersects descriptor and caller budgets, then runs reversible authorizers in deterministic order. Authorizers may only narrow permissions, trust, budgets, network domains, and file roots; an attempted widening fails closed.

The resolved adapter request carries one immutable `effectiveAuthority`. An optional synchronous audit hook runs after authorization and before the owning adapter, so a Host can durably record the exact decision without opening a second execution path.

## Model Experience

Indirectly, through an agent-facing consumer that renders discovered descriptors or invokes their owning adapters.

#### KV Cache effect

Catalog changes can alter an agent consumer's tool or skill description. That consumer owns prompt ordering and cache invalidation.

## Known Limitations and Deferred Work

- **Schema metadata only** — JSON Schema execution belongs to the adapter that owns the external input boundary; this catalog does not validate same-process typed values twice.
