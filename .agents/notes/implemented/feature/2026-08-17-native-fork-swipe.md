# RP branch rewrite with native Session Fork

Date: 2026-08-17. Status: implemented locally.

## Decision

RP regeneration cannot resend the previous user message in the parent Session: the original round may have committed time, NPC, relationship, objective, inventory, and choice changes, so replay would mix mutually exclusive world lines in one Ledger. The product uses native DSH `session.fork` at the last completed Turn before the target Assistant Turn. A first reply has no prior completed Turn and therefore exposes an explicitly disabled rewrite control.

Every RP Tool resolves its matching `tool/call` event from the Agent Session and records Turn, Step, and Source Seq on Runtime Effects and choice provenance. After native child creation, `rp-studio-fork-adopt` validates that `session.header.parentSession` matches the source and that the inherited Agent preset matches the source RP mode, then treats `seedLength` as the sole event cut. Transcript records survive only when both source and current Surface seq are inside the Seed. Ledger keeps only sourced Effects inside the Seed/Turn, and choices after the cut are cleared. Older unsourced Effects are conservatively omitted from historical forks to prevent future-state leakage.

The Client opens the child, submits the adopt command, and prompts it with the target Turn's original user prose. Native AgentLoop, model target, State Keeper, and Tool roster continue in the child. The parent receives no product-state or log mutation. UI calls this operation **Rewrite in branch** rather than promising SillyTavern's same-bubble swipe-array semantics.

## Verification

The model test creates two turns of sourced clock state plus second-turn choices and forks at the first-turn seed. Child Projection keeps only first-turn time and the two prefix Transcript rows while dropping second-turn state and choices. The Host command test proves native parent, inherited preset, Binding, and Transcript adoption. The Tool test proves that real `tool/call` Turn/Step/Seq enters the Effect.

Real browser verification adds two source-addressable rounds to a `REV 4` parent and clicks **Rewrite in branch** on the latter. DSH creates sidebar child `开始写一个nsfw故事 (1)`. The adopt command reports a fork from the end of Turn 5, and Kaon replays the target user message with a new Ledger commit in the child. Parent remains `REV 4`; child inherits only the previous round's newly sourced Effect and reaches `REV 2` after regeneration. Both Sessions remain visible, while reasoning and State Keeper acknowledgement remain absent from RP prose.
