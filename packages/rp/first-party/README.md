# `@dsh-rp/first-party`

English | [中文](README.zh.md)

This plugin installs the first-party component metadata, executable role templates, Turn/Workflow/Sidecar DAGs, and nine Experience profiles. It owns no privileged execution path: role templates register through provider-neutral `ctx.rpAgents`, while Agent Providers, domain plugins, and deployment policy remain replaceable registrations.

The default `rp-adaptive` Experience gives its top-level Actor access to Tool, Skill, Subagent, and Pipeline families. First-party Turn graphs declare L2 trust plus `rp.pipeline.execute` and `agent:spawn`; they assemble bounded identity, lore, memory, scene, relationship, prompt, and capability context, invoke `rp.agent.actor` through the unified Catalog, and adapt the Provider result into `turn.effects`. Workflow and Sidecar graphs route Director, Actor, Critic, Scheduler, Character, World, Narrator, Creator, Reviewer, State Keeper, and Memory Curator stages through the same boundary. Multi-character and world graphs fan out independent Agent stages in parallel and join their detached JSON results before continuing.

Turn graphs consume the frozen Event Log scope projection for bounded dialogue history, state, memory, scene, relationships, and branches. When the Turn snapshot contains an active prompt preset, its selected enabled order replaces the generic identity, lore, prompt, and history section assembly. Character, Persona, Lore, and history markers resolve from the same frozen context; marker slots with no value are omitted rather than sent as empty model messages, while their identities remain in the audited preset snapshot. Prompt macros such as `{{char}}`, `{{charIfNotGroup}}`, and `{{user}}` resolve at this boundary. Without an active preset, the existing generic assembly is unchanged.

The graphs never let stale process-local domain Stores override a committed Session fact. The permission-gated `rp.memory.append` capability remains available for explicit durable external memory writes. `rp-fast` invokes exactly one Actor Provider and therefore preserves its one-generation contract without Director, Critic, or Sidecar work. Other profiles select directed, multi-character, world-simulation, TRPG, companion, creator, or premium compositions.

## Model Experience

Indirectly, through the Experience-selected Agent and Pipeline consumers. Role instructions do not add prompt text until the selected Agent Provider composes a concrete child request.

#### KV Cache effect

First-party ids and graph hashes are stable. Selecting a different Experience can change downstream prompt and tool assembly.

## Known Limitations and Deferred Work

- **Provider required** — this package intentionally does not perform model calls itself. A deployment must register a compatible `ctx.rpAgents` Provider; the distribution supplies the Harness Subagent Provider, while remote Providers can replace it.
