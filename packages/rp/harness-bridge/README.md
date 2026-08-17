# @dsh-rp/harness-bridge

English | [中文](README.zh.md)

This plugin mirrors live Harness Tool schemas, model-invocable Skills, Subagent providers, RP Pipelines, and Workflow Backends into `ctx.rpCapabilities`. Tool and Subagent entries remain discovery-only because their native execution requires an owning Agent; Skill, Pipeline, and Workflow Backend entries delegate invocation back to their native registries.

Each Workflow Backend receives a separate capability id and its declared L0/L1/L2 trust. L1 execution requires `script.execute`; L2 execution requires `workflow.native`. The bridge forwards only the Catalog's effective authority and budget, so discovery never becomes an alternate permission route.

Each RP Pipeline is mirrored with the Pipeline definition's own trust and permission declaration instead of an ambient bridge default. Catalog authorization and the Pipeline Runtime therefore validate the same contract before any Stage begins.

All mirrored registrations are replaced on native registry change events and withdrawn when the bridge unloads. The bridge does not copy provider state or implement a second permission path.

## Model Experience

Indirectly, through a consumer that renders the unified catalog. Native Tool and Skill consumers continue to own their existing prompt text and schemas.

#### KV Cache effect

Catalog changes can alter downstream discovery text. The bridge itself does not assemble a model request.

## Known Limitations and Deferred Work

- **Agent-required execution** — Tool and Subagent entries are discovery-only; the owning Harness Agent and its native tools execute them with caller identity and permission state.
