# @dsh-rp/persona

English | [中文](README.zh.md)

`ctx.rpPersonas` stores detached `PersonaIR` assets in exact lifecycle scopes. `context()` exposes only bounded identifiers, names, and descriptions; compatibility envelopes and extensions remain available to UI consumers through `get()` and `list()` but never enter this model view.

## Model Experience

Indirectly, through first-party or third-party prompt consumers that explicitly select the safe persona context view.

#### KV Cache effect

Persona context is stable for a frozen turn snapshot; deterministic identifier order avoids registration-order cache churn.

## Known Limitations and Deferred Work

- Selection is exact-scope only; profile-to-conversation activation policy belongs to an Experience or UI plugin.
- The runtime does not infer a single active persona when several are registered.
