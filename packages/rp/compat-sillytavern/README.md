# @dsh-rp/compat-sillytavern

English | [中文](README.zh.md)

Clean-room Character Card V1/V2/V3 JSON, PNG metadata, bounded CHARX, World Info, Chat Completion preset, and chat JSONL adapters. Each format is an independently registered L0 component and capability. Imports produce public RP IR and retain original JSON inside a compatibility envelope; scripts, regex matching, remote assets, and advanced activation behavior remain inert.

Chat Completion preset import retains every prompt definition and every Prompt Manager order profile. It selects the SillyTavern global profile with `character_id: 100001` when present and otherwise selects the first source profile; only enabled entries from that selected profile become the effective `prompts` list. Missing prompt references, duplicate identifiers, and duplicate order ids are rejected instead of being silently dropped.

Every compatibility envelope now carries a versioned, path-addressed loss report. It separately states that source data remains retained and which executable behaviors were normalized, preserved inert, disabled, or omitted. Creator Studio presents these reports directly.

JSON unknown fields are retained losslessly. Binary transport reports are separate: PNG container/image bytes and CHARX container/entry bytes are currently omitted after bounded parsing, while declared asset metadata, byte lengths, and content hashes remain available.

The checked golden corpus contains exactly 100 samples: 30 Character Card JSON documents across V1/V2/V3, 15 World Info documents, 15 presets, 20 chat JSONL logs, 10 PNG cards, and 10 CHARX archives. Every sample pins its source hash, normalized counts, source format, disabled behaviors, unknown-field marker, and binary transport. CI regenerates the corpus description and rejects drift. Adversarial tests additionally cover prototype-shaped fields, shell/secret/endpoint payloads, script and catastrophic-regex text, negative zero, archive traversal, and 256 deterministic parser mutations without granting execution, network, filesystem, or Host authority.

The package's compatibility fixtures and focused tests own its behavioral baseline and preserve the version-independent IR used by the distribution.

## Model Experience

None, as import capabilities only parse data and never add source extension fields to model context automatically.

#### KV Cache effect

None until another plugin deliberately selects the resulting IR.

## Known Limitations and Deferred Work

- Export adapters remain separate future plugins.
- STscript and Quick Reply execution lives in the independent, permission-gated `@dsh-rp/compat-stscript` L1 plugin; TavernHelper remains preserved and disabled.
- Full SillyTavern runtime emulation is intentionally out of scope for this L0 importer.
