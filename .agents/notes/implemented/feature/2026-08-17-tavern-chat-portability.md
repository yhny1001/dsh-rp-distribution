# Tavern chat-history portability

Date: 2026-08-17. Status: implemented locally.

## Decision

Chat portability belongs to the RP product plugin rather than DSH Session-format compatibility. The Client parses SillyTavern JSONL or JSON arrays, omits metadata, blank, and `is_system` rows, and converts `name`, `is_user`, and `mes` into bounded character/persona messages. The Host command validates roles, speakers, and body limits again before committing one product-state revision plus append-only Session events for the complete batch.

DSH does not let a plugin forge `assistant/message` while idle. Imported character history therefore uses user-role `plugin/recall`, with `<rp-assistant-history>` explicitly framing it as already-spoken character history. Persona history uses `plugin/notice`. RP Transcript stores the original role, speaker, and body so the UI still presents character versus persona while the next model request cannot mistake character history for a current human instruction. Store publishes its synchronous cache immediately after atomic rename so same-millisecond Prompt Assembly and State Keeper observe the imported revision.

Export reads only prose visible on the current RP Surface. The first row records ST user/character names and product provenance. Later rows carry `name`, `is_user`, `is_system:false`, `mes`, and time; `extra` adds DSH source sequence and edit revision. Immutable superseded prose, Tool/Reasoning blocks, and internal State Keeper steering do not enter the file.

## Limits

One file is capped at 4 MiB, one batch at 1–500 messages, each body at 32,000 characters, and aggregate prose at 1,000,000 characters. System rows stay outside Transcript because system rules, presets, lorebooks, and scene are independently owned product resources. This implementation does not import ST swipe arrays and an exported file is not a restorable DSH Session backup.

## Verification

The pure compatibility test parses JSONL containing metadata, system, character, and user rows, proves that the first two are omitted, and serializes the visible messages back to standard JSONL. The model test imports two rows into an existing Binding and verifies character id, persona id, speaker, prose, sequence, and synthetic markers. The Host command test proves that Session events use `recall` versus `notice` while Store Transcript retains original roles. The real browser renders **Import chat / Export chat** and downloads an eight-row JSONL containing one metadata row, four persona messages, and three character messages. Metadata names Katisia, `user`, and `@dsh-rp/product`; every message carries `mes` and a DSH source sequence.
