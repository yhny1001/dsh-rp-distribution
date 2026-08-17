# `@dsh-rp/lifecycle-l2`

English | [中文](README.zh.md)

Independent lifecycle plugin for explicitly trusted native `dsh-rp-runtime-v1` packages. Activation requires an integrity-bound payload, a Registry-trusted signature, a hash-bound SBOM, and `native.execute` in both the Manifest and every executable capability descriptor. Signed named DAGs register in `ctx.rpPipelines`; their Catalog entry delegates to the graph without evaluating native code during installation.

A native source file must evaluate to one function: `(input, effectiveAuthority, signal) => JsonValue | Promise<JsonValue>`. The adapter exposes no Cordis Context or registration API to package code, validates and bounds JSON output, forwards cancellation, and applies deployment timeout ceilings. Install preparation compiles syntax but does not evaluate the package expression.

L2 is trusted native code, not a security sandbox. It runs in the Host process and can reach ambient Node globals. Install it only from a reviewed publisher whose signing key is explicitly trusted.

## Model Experience

Indirectly, through trusted native capabilities selected by an Agent or Pipeline.

#### KV Cache effect

Capability consumers own all context and cache effects; this adapter adds none by itself.

## Known Limitations and Deferred Work

- As with any in-process JavaScript, synchronous non-terminating native code cannot be preempted by an asynchronous timeout; untrusted or merely semi-trusted code belongs in L1.
- Native network and filesystem enforcement cannot be guaranteed inside the process. Manifest authority is passed for cooperative adapters and audit, while real isolation requires an isolated-process Provider.
