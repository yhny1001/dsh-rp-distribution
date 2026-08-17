# @dsh-rp/character

English | [中文](README.zh.md)

`ctx.rpCharacters` stores detached `CharacterIR` assets in exact lifecycle scopes. `context()` exposes a bounded, deterministic model view that excludes compatibility envelopes, extensions, and greeting alternatives.

## Model Experience

Indirectly, through first-party or third-party prompt consumers that explicitly select the safe character context view.

#### KV Cache effect

Character context is stable for a frozen turn snapshot; deterministic identifier order avoids registration-order cache churn.

## Known Limitations and Deferred Work

- Selection is exact-scope only; library-to-conversation activation policy belongs to an Experience or UI plugin.
- Character greetings remain UI or branch inputs and do not enter system context automatically.
