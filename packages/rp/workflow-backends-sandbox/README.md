# `@dsh-rp/workflow-backends-sandbox`

English | [中文](README.zh.md)

L1 execution Providers for `ctx.rpWorkflowRouter`. Installation grants no execution authority: every call needs effective L1 trust plus `script.execute`.

The WebAssembly backend accepts a versioned base64 module envelope and a deliberately narrow numeric ABI. It rejects imports, start sections, unbounded or oversized memory and tables, oversized modules, non-finite arguments, and non-finite results. Each call runs in a fresh terminable Worker. WebAssembly's no-import boundary removes ambient Host capabilities; the Worker adds cancellation and failure containment but is not itself described as a security sandbox.

The QuickJS backend evaluates one JSON-producing expression in a fresh Node child process. The VM receives only deeply frozen JSON input. Node, filesystem, network, clock, randomness, WebAssembly, and host callbacks are not bridged. QuickJS heap, stack, source, input, output, and execution time are bounded; the parent kills non-cooperative work.

## Model Experience

Indirectly, through Experiences and Agents that explicitly route controlled scripts or portable rules modules to these Providers.

#### KV Cache effect

The package contributes no prompt text. A workflow that calls a model owns its own cache behavior.

## Known Limitations and Deferred Work

- The QuickJS dependency is pre-1.0 and upstream says it has not received a formal security audit. Process isolation, strict capability omission, hard limits, signatures, and package policy are still required defense in depth.
- The WebAssembly ABI currently accepts finite numeric arguments and one finite numeric result. Structured values require a future audited canonical-memory ABI rather than ambient imports.
- Neither backend grants network, files, secrets, subprocesses, model calls, or host tools. Such capabilities must use separate explicit Providers and policy.
