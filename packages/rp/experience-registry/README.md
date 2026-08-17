# @dsh-rp/experience-registry

English | [中文](README.zh.md)

`ctx.rpExperiences` owns dynamic immutable Experience manifests. The top-level Agent may supply `agentChoice`; explicit user selection has higher precedence, while task hints provide a deterministic fallback among the first-party profiles.

Selection is constrained by an optional caller allowlist. The policy never silently substitutes a denied or missing Experience.

## Model Experience

Indirectly, through the agents, pipelines, and components selected by the returned Experience.

#### KV Cache effect

Changing Experience can change prompt, tools, and agent topology; the consuming turn freezes the selected composition before request assembly.

## Known Limitations and Deferred Work

- **Policy inputs are explicit** — task classification is performed by the top-level Agent or product caller, not by a hidden secondary model call in this package.
