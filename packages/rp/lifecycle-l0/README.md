# `@dsh-rp/lifecycle-l0`

English | [中文](README.zh.md)

Independent lifecycle plugin for L0 declarative packages using `dsh-rp-runtime-v1`. It publishes integrity-bound Component, named Pipeline, and Capability declarations and routes optional expression implementations through the built-in bounded deterministic workflow backend. Pipeline capabilities delegate to their registered DAGs through `ctx.rpPipelines`.

L0 package expressions receive only the invocation's JSON input. They have no script runtime, Host object, network, filesystem, secret, or ambient native authority. Discovery-only capabilities omit an implementation.

## Model Experience

Indirectly, through declarative capabilities selected by an Agent or Pipeline.

#### KV Cache effect

Capability consumers own all context and cache effects; this adapter adds none by itself.

## Known Limitations and Deferred Work

- The v1 expression language intentionally contains only input, get, object, array, and conditional composition.
- Richer declarative transforms must extend the deterministic backend under a new reviewed operation or compatibility version.
