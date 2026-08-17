# `@dsh-rp/workflow-backends-local`

English | [中文](README.zh.md)

Local execution providers for `ctx.rpWorkflowRouter`. Each run receives a fresh Worker Thread or sanitized Node child process and evaluates only the bounded declarative expression language from the router.

## Model Experience

Indirectly, through Experiences or Agents that select a non-default workflow backend.

#### KV Cache effect

The backend contributes no prompt text; workflow consumers own any model request and cache behavior.

## Known Limitations and Deferred Work

- Worker Threads are containment, not a security sandbox. The isolated-process provider removes ambient environment variables and accepts no user program text, but it is not an OS policy sandbox. QuickJS, WASM, remote workers, and hardened platform sandboxes remain separate providers.
