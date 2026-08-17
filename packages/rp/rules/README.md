# `@dsh-rp/rules`

English | [中文](README.zh.md)

Replaceable rules-engine registry with cancellation, reversible Provider registration, and a built-in bounded seeded-dice engine whose outcomes can be replayed exactly.

## Model Experience

Indirectly, through an authorized Agent or Pipeline that invokes `rp.rules.evaluate` and renders its structured outcome.

#### KV Cache effect

Rules results enter context only through the invoking Agent or Pipeline; repeated stable results can preserve the surrounding prompt prefix.

## Known Limitations and Deferred Work

- Seeded dice are reproducible simulation, not verifiable public randomness. System-specific combat, inventory, and character-sheet engines remain separate Providers.
