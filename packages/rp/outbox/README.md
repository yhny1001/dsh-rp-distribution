# @dsh-rp/outbox

English | [中文](README.zh.md)

Idempotent outbox and compensating saga runtime for effects that cannot be part of an RP turn's atomic local commit. Handlers are reversible plugins; entries have bounded retries, stable idempotency keys, deterministic inspection, and explicit terminal states.

Saga steps execute sequentially and compensate successful steps in reverse order after a failure. The runtime never describes network, media, or filesystem work as a database transaction.

## Model Experience

None, as the service executes committed external-effect intents and contributes no model request content.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Durable storage and distributed leases are Provider responsibilities; the bundled implementation is a process-local reference runtime.
