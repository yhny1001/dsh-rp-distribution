# `@dsh-rp/distribution-core`

English | [中文](README.zh.md)

Presentation-neutral DSH bundle for the standalone RP runtime. Layer it after `@deepseek-ai/dsh-base` to mount characters, personas, lore, memory, state, scenes, relationships, branches, prompts, Agents, Pipelines, Registry, policy, package runtimes, and compatibility adapters without loading browser code.

Use this bundle for Headless deployments and as the first RP layer of Web deployments.

## Model Experience

Indirectly, through the mounted RP consumers selected by the active Experience.

#### KV Cache effect

The bundle adds no context itself; each mounted consumer owns its cache effect.

## Known Limitations and Deferred Work

- The durable Memory provider requires a Host storage-domain backend; deployments whose base profile does not mount one must add it in a later bundle or profile patch.
