# `@dsh-rp/product`

English | [中文](README.zh.md)

Local-first RP product plugin for an installed DSH `0.1.0-rc.6` Web profile. One self-contained Bundle registers the Node API, separate `rp-tavern` and `rp-agent` native Agent presets, a Chinese-first authoring workspace, a character-oriented conversation view, a Session header control, and a compact selected-composition control above the composer. Upgrade removes the old `rp-studio` Agent preset; **RP Studio** remains only the management-surface name.

## Tavern-style product model

Each Session selects one Prompt preset, then composes system rules, a world/lorebook, a character cast, a user persona, and the current scene. A preset retains every prompt definition, role, marker, ST injection metadata, complete order profile, per-entry enablement, and generation setting. Up to 1,024 definitions are retained and each order may contain 256 switchable entries; unassigned definitions remain visible and can be appended. The manager provides search, enabled-only filtering, counts, toggles, and reordering. Imported `temperature` and `openai_max_tokens` map to DSH `temperature` and `maxTokens`. ST `reasoning_effort=min` is retained as normalized DSH `minimal`, while request assembly first reads the selected exact provider/model route: the preset overrides only an advertised effort and otherwise preserves the current model selection or provider default. Other imported parameters remain inert retained data.

Built-in marker resolution covers common identifiers such as `worldInfoBefore`/`worldInfoAfter`, `personaDescription`, `charDescription`, `charPersonality`, `scenario`, `dialogueExamples`, and `chatHistory`. Chat history stays in the native DSH Session position. Markers order structured resources without collapsing world, character, persona, and scene data into one uneditable text field. Safe macro assembly supports `{{user}}`, `{{char}}`, ordered pure-text `setvar/getvar`, comment removal, and a semantic `lastUserMessage` placeholder; TavernHelper and regex scripts never execute.

## Character cards and batch import

The batch importer directly reuses the repository's clean-room `@dsh-rp/compat-sillytavern` package. It supports Character Card V1/V2/V3 JSON, PNG cards carrying `chara`/`ccv3` metadata, CHARX, World Info, Persona, and Chat Completion preset JSON. Results are reported per file: one invalid document does not discard valid siblings, and scripts, regexes, remote assets, and unknown extensions never execute. The original JSON document stays attached to a selectable `ST COMPAT` resource. After import, the UI explicitly asks whether to create a separate `HARNESS` adaptation; this conversion is non-destructive, both presets remain independently selectable, and adapting again refreshes the deterministic copy.

Character cards retain the primary greeting, alternate greetings, scenario, dialogue examples, tags, and source report. A PNG card's original image is stored as a content-addressed local product asset and used in resource, editor, and conversation avatars. One shared avatar container enforces a square `cover` crop with portrait focus shifted toward the face, so the original image never projects into the conversation background or escapes an avatar boundary. After applying a composition, a greeting can be appended from either the composer screen or RP conversation view. It enters model context as explicitly labeled character history and never claims human authority.

## Named conversation and body editing

The **RP Conversation** view labels each human message with the persona selected when it landed and each model reply with the primary character selected when it was generated. Changing the primary character does not relabel old messages, so one Session can distinguish multiple speakers.

User and character message bodies are editable. The product preserves the original append-only log and adds a Session Surface replacement carrying complete `sourceEventSeqs`; later model calls consume the edited body and the view shows its revision. DSH `0.1.0-rc.6` permits `assistant/message` writes only while a model Step is open, so idle-time character edits use a `plugin/recall` user-role Surface node containing explicitly framed edited-assistant history. The RP view preserves the character semantics, the operation remains auditable, and AgentLoop is unchanged.

## Lorebooks and two runtime modes

Standalone World Info and Character Card lore retain individual World Entries instead of collapsing only into one prose field. Each entry keeps its id, primary and secondary keys, constant marker, enabled state, priority, and content. The lorebook editor supports search, per-entry toggles, creation, removal, and editing. Enabled entries enter the world marker in deterministic priority order; disabled entries remain stored but model-invisible.

Every Session explicitly selects `Tavern Chat` or `Agent RP`. Tavern Chat uses the separate `rp-tavern` Agent preset: it still reuses native DSH AgentLoop for Session semantics but registers no RP state tools, preserving the traditional single-generation Tavern experience. Agent RP uses `rp-agent` and registers domain tools around the same imported Prompt preset, Character Card, persona, and lorebook. Its Experience field retains product intent for adaptive, world simulation, multi-character, TRPG, and companion profiles.

The new-session Agent-preset selector and the RP quick setup above the composer share one selection state. Tavern Chat immediately exposes Prompt preset, Character Card, persona, lorebook, and scene controls; Agent RP adds Experience to the same resource controls. When the landing page has no Session yet, applying the setup asks the DSH Workspace Runtime to reuse or create a blank Session, applies the selected Agent preset, and then binds the complete RP composition. Standard coding presets do not render the RP quick setup.

After application, the composer keeps only one compact **Selected** control. Its summary names only the runtime mode, primary character, and Prompt preset; persona, lorebook, and scene collapse into an additional-item count, and clicking reopens the full setup. Internal Prompt Seat order no longer spreads horizontally across the conversation entry; it stays in Prompt Manager and the full composition view.

Agent RP currently exposes `rp_update_state` and `rp_propose_choices`. The former commits world, time, scene, character, persona, relationship, or memory Effects; the latter commits 1–8 choices carrying stable ids, visible labels, and exact submitted prompts. Native tool calls/results stay in the Session log, product state holds a rebuildable projection, and the next request reads committed facts through `<rp-dynamic-state>`. The RP view renders character dialogue beside world/time/scene/relationship/memory cards and clickable choices; selecting one submits its prompt to the same native Agent Session.

## Local installation

```sh
pnpm run build
pnpm --dir packages/rp/product pack --pack-destination /tmp/dsh-rp-product
dsh plugin --profile web add /tmp/dsh-rp-product/dsh-rp-product-0.1.0-rc.5.tgz
dsh --profile web
```

Open **RP Studio** from the sidebar footer or Session header. The native DSH composer, model selector, streaming, cancellation, persistence, Trajectory, Session export, and statistics remain Host-owned; the plugin never starts a second model loop.

## Current limitations

- Source prompt roles are retained and displayed, but the public DSH `0.1.0-rc.6` extension assembles these sections into one system Prompt string; it cannot insert arbitrary system/user/assistant Messages into the middle of history.
- PNG card images are persisted as local avatar assets; raw embedded CHARX asset bytes remain omitted according to the compatibility adapter policy, while their inert metadata is retained.
- A message already shadowed by Compaction is no longer a current Surface node and cannot be replaced locally; the view retains it, while the edit command fails explicitly.
- Swipe/regenerate, SillyTavern Chat JSONL import/export, automatic group-speaker scheduling, regex/STscript, and Kobold Text Completion are not yet product surfaces. Multi-character Sessions currently switch the primary speaker explicitly.
- Agent RP domain tools work, but strict per-turn State Keeper auditing still requires a dedicated Sidecar. The strengthened prompt requires tool commits for prose-implied changes, yet a model can still omit a tool call until a Turn-boundary audit enforces it.
- Product data is written atomically to `$DSH_HOME/rp-product/product-state.json`. Schema v2 rejects the prerelease schema v1, and external Storage Providers are not yet selectable.
