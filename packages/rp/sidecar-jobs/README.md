# `@dsh-rp/sidecar-jobs`

English | [中文](README.zh.md)

`ctx.rpSidecars` turns every registered `kind: sidecar` RP Pipeline into a separate executable `sidecar:<pipeline-id>` contribution in the unified Capability Catalog. Each contribution preserves the target graph's trust, permissions, budget, and version, adds the explicit `rp.sidecar.start` permission, and returns an accepted Harness Job identity without awaiting the DAG.

The exact initiating Harness Agent owns the Job. The adapter starts the recursively frozen Pipeline plan immediately, forwards the Catalog's effective authority and budget without widening them, links caller and Job cancellation, and bounds retained UTF-8 output. Its observer records exact start, Stage, and terminal facts for the top-level Sidecar and every nested Pipeline in the owner's Session. Harness Jobs retain their standard owner fence, wait, read, notice, and kill behavior.

Sidecar capability registrations are reversible and follow Pipeline hot updates. Plugin unload first retracts every published capability, then requests cancellation and drains all work it started within the configured cooperative grace bound. A non-cooperative Stage makes unload fail loudly instead of silently abandoning a Job.

## Model Experience

### Asynchronous Sidecar capabilities and Job results

#### What the model sees

Through `rp_capability`, the model can discover one bounded `sidecar:<pipeline-id>` descriptor per live Sidecar graph. A successful start returns its Job id, Pipeline id, frozen snapshot hash, correlation turn id, and `accepted` status. Ordinary Harness Job controls provide later status, bounded final output, and cancellation.

#### Token effect

Discovery adds the selected Sidecar descriptor. Starting adds one small acceptance result; completed output is data-dependent and bounded by `outputLimitBytes` before the Job controller adds its status metadata.

#### KV Cache effect

Descriptors remain prefix-stable while the Pipeline version and graph are unchanged. Acceptance and Job results are append-only suffixes; a Pipeline hot update changes only that Sidecar's future descriptor and snapshot hash.

## Known Limitations and Deferred Work

- **Cooperative cancellation** — native Pipeline Stages must observe their supplied `AbortSignal`; the adapter cannot hard-kill arbitrary same-process code.
- **Process-local Job registry** — the default Harness Jobs backend does not recover running Sidecars after a process crash; durable restart ownership requires a separate Jobs provider.
