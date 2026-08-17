# @dsh-rp/lore

English | [中文](README.zh.md)

`ctx.rpLore` registers lorebooks per scope and activates enabled entries through bounded, deterministic literal matching.

## Model Experience

Indirectly, through the prompt consumer that selects activated world facts for a model request.

#### KV Cache effect

Activated lore is dynamic context; deterministic ordering avoids accidental cache churn.

## Known Limitations and Deferred Work

- Regex, vector, recursive, probabilistic, cooldown, and decorator semantics require explicit plugins.
