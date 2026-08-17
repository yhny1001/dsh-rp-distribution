# @dsh-rp/pipeline-runtime

English | [中文](README.zh.md)

`ctx.rpPipelines` registers and executes Turn, Workflow, and Sidecar pipelines as deterministic DAGs. `after` and `before` constraints compile into topological levels; stages in one level receive the same immutable frame and run concurrently, then their JSON outputs merge in stable stage-id order.

Compilation rejects missing references, duplicate stages, and cycles. `capture()` recursively freezes the executable top-level graph and every nested Pipeline into an opaque `RpPipelinePlan`; dependency hashes feed the top-level SHA-256 identity. `runPlan()` therefore keeps executing the admitted functions after a registration is replaced or removed, while `run()` captures a fresh plan for each new call. A stage can declare cooperative timeout, retry count, and fatal or continue failure handling. Output keys are single-writer for the complete run; a second writer fails instead of silently overwriting state.

An optional synchronous observer receives start, Stage, completion, and failure facts for the top-level and all nested runs. Durable consumers can reject execution when their audit append fails instead of silently losing the trace. Run identities include Pipeline kind, id, random run id, and the exact recursively bound snapshot hash. Every custom Stage also receives that run id and an immutable Host metadata object; nested Pipelines preserve the metadata without merging it into data outputs.

Declarative capability stages receive only the intersection of the run authority and stage ceiling. Nested pipelines preserve the caller's permissions, trust, network/file allowlists, policy layers, and remaining budget; a graph definition cannot grant itself L1 or L2 authority.

Installable runtime packages may contribute only declarative graphs. Their Lifecycle adapter registers each graph here before publishing its matching Catalog capability, and Catalog invocation delegates back to `run()` instead of implementing a second Pipeline executor. A custom-function graph does not require the Capability Catalog; `invoke-capability` resolves it only when that Stage executes and fails explicitly when it is unavailable.

Every Pipeline definition declares its implementation trust and required permissions. Those fields are frozen into the content hash and checked before a constrained run starts, so a low-trust graph cannot hide a higher-trust nested graph. Calls that omit both trust and permissions are explicitly Host-internal dispatches; Agent, package, and remote entry points must use the Capability Catalog or supply constrained authority.

## Model Experience

Indirectly, through stages that call model-facing Tool, Skill, Agent, or Prompt consumers. This runtime adds no prompt text or tool schema itself.

#### KV Cache effect

None directly. The snapshot hash lets prompt and agent consumers identify graph changes before assembling a request.

## Known Limitations and Deferred Work

- **Cooperative timeout** — timeout aborts the stage signal and rejects the run, but JavaScript work that ignores its signal can continue until its own promise settles.
