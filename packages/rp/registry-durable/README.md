# `@dsh-rp/registry-durable`

English | [中文](README.zh.md)

Crash-restorable installation ownership for `@dsh-rp/registry` over Harness Storage Domain. Every committed root persists its complete exact-version lock before live Registry state is published. Startup reacquires every source, verifies package identity, version, Manifest hash, evidence level, and graph hash, then reactivates the graph through its lifecycle adapters. A mismatch fails Host startup rather than silently running different code.

The package inherits the deployment's backend route for domain `dsh_rp_registry`; the standard Web profile can use the JSON backend and deployments may route the same schema to another Storage Domain backend. Writes are serialized. Install and update roll runtime activation back when durable publication fails; uninstall restores released runtime registrations when durable deletion fails.

## Model Experience

Indirectly, through restored plugins whose capabilities become available only after their exact durable locks pass verification and activation.

#### KV Cache effect

None by itself. Restored capabilities affect context only when an owning Agent or Pipeline selects them.

## Known Limitations and Deferred Work

- The durable record stores locks and provenance, not package archives. The distribution's separate content-addressed cache can supply an integrity-bound payload, but startup still reacquires the exact manifest and any hash-bound SBOM from its configured source.
- A lifecycle disposer must be total and non-throwing. If third-party code violates that contract, restoration can fail closed but cannot prove the external side effect was removed.
- Storage backends provide per-record durability. Cross-machine distributed installation coordination requires a separate leader/lease plugin.
