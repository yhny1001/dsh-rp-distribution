# `@dsh-rp/lifecycle-l1`

English | [中文](README.zh.md)

Independent lifecycle plugin for L1 `dsh-rp-runtime-v1` packages. It accepts QuickJS source and no-import WebAssembly implementations only when both the package Manifest and capability descriptor request `script.execute`. Integrity-bound named DAGs register in `ctx.rpPipelines`, while their Catalog capabilities retain the same L1 permission and trust ceiling.

Invocations preserve the Capability Catalog's least effective authority and route back through the canonical Workflow Router. QuickJS runs in a bounded isolated child process with no bridged Host APIs. WebAssembly runs in a fresh bounded worker, accepts only a numeric ABI, and forbids imports. A deployment can pin exact backend ids without changing package code.

## Model Experience

Indirectly, through sandboxed capabilities selected by an Agent or Pipeline.

#### KV Cache effect

Capability consumers own all context and cache effects; this adapter adds none by itself.

## Known Limitations and Deferred Work

- The WebAssembly v1 ABI accepts finite numeric arguments and returns one finite number.
- QuickJS isolation is a defense-in-depth process boundary; its security contract depends on the no-Host-API bridge and resource controls of the selected reviewed backend.
