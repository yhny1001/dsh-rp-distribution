# `@dsh-rp/agent-provider-harness`

English | [中文](README.zh.md)

This plugin binds provider-neutral `ctx.rpAgents` roles to the Harness Agent/Subagent runtime. It requires an active initiating Harness Agent, chooses the first configured live Subagent Provider with the required persona and depth capabilities, and starts one owned child run. `fork` is preferred by default so a role can inherit completed conversation history; `spawn` is the explicit fresh-context fallback.

The Provider delivers role instructions as the child's scoped persona and sends detached JSON input as one identified prompt. Effective `maxTokens`, timeout, cancellation, and deployment depth ceilings are enforced without exposing Cordis Context to role packages. Every accepted child is disposed after settlement. Completed output is normalized to JSON; non-completed stop reasons fail the capability call instead of masquerading as success.

The parent Session receives paired `rp/agent-started`, `rp/agent-delegated`, and `rp/agent-completed` or `rp/agent-interrupted` facts containing the concrete child id, role, parent, RP Provider, Harness transport, and stop reason. The start fact includes the exact detached model input and completion includes the normalized output, so the model boundary is auditable without a process singleton or a second Agent registry.

## Model Experience

### Harness child request

#### What the model sees

The selected child sees the role instructions in its persona plus one request envelope containing the role id, scope, capability families, and JSON input. The parent sees only the bounded child result returned through `rp_capability` or the calling Pipeline.

#### Token effect

Each invocation creates one bounded child request whose variable cost is the detached JSON input and role instructions, then returns one bounded normalized result to the parent. Non-model RP lifecycle events add no request tokens.

#### KV Cache effect

Each child has its own request prefix. A fork reuses the parent's balanced completed-turn history where the Harness Provider permits it; a spawn begins with a fresh prefix. Parent history changes only by the ordinary capability result and durable non-model RP events.

## Known Limitations and Deferred Work

- Invocation requires a live initiating Harness Agent; agentless Headless callers must use a separate explicitly authenticated Provider rather than manufacturing parent identity.
- Cross-process remote Providers remain independent plugins behind `ctx.rpAgents`.
