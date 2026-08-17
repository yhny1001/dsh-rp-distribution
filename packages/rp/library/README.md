# @dsh-rp/library

English | [中文](README.zh.md)

`ctx.rpLibrary` durably owns normalized Character, Persona, and Lore assets independently from their process-local domain registries. Each asset family has one complete ordered selection per exact RP Scope. Resolution chooses the nearest selection independently for each family, so a conversation can override a profile Persona while inheriting deployment Lore. `capture()` freezes only the selected assets, their binding scopes, and a stable content hash for one Turn.

Removal prunes every reference in the same durable state publication. Saving and selecting publish storage before the live view or `rp/library-changed` event changes. The portable Storage Domain backend keeps Web and Headless behavior identical.

## Model Experience

Indirectly, through the Turn Pipeline that projects model-safe Character and Persona fields and deterministically activates selected Lore from the frozen library snapshot.

#### KV Cache effect

An unchanged selection preserves the snapshot hash and stable asset order. Saving selected content or changing a selection changes the next Turn's identity or Lore prefix without mutating a prepared Turn.

## Known Limitations and Deferred Work

- Library selection is explicit; automatic character choice and profile inheritance policy belong to Experience or product plugins.
- Binary avatar and embedded CHARX asset bytes remain media-provider concerns; the library stores normalized IR and compatibility provenance.
