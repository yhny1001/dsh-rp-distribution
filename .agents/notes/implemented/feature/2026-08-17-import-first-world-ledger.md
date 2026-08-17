# Import-first setup and world ledger

Date: 2026-08-17. Status: implemented locally.

## Decision

Real RP users normally enter with Character Cards, presets, personas, and lorebooks rather than Harness composition knowledge. `@dsh-rp/product` therefore treats imported resources as product input and derives one complete recommendation from the newest imports: prefer a Harness-adapted preset, then its original ST preset; select the newest imported character, persona, and lorebook; derive the opening scene from Character Card Scenario before falling back to the world overview. Advanced fields remain expandable on the new-session surface, but the default view shows only the assembled character, mode, and resource summary.

Import results expose direct Tavern Chat and Agent RP start actions. They call only DSH Client Workspace, Session, and Agent Preset services: acquire or create a blank Session, select `rp-tavern`/`rp-agent`, and submit the existing `rp-studio-bind` command. The plugin does not introduce a second Session, chat service, model loop, or Workspace implementation.

DSH AgentLoop, Prompt Assembly, and streaming LLM calls remain the Actor from the reference design; the plugin owns Scenario Profile and World Ledger. Agent RP commits one round as an atomic N→N+1 transition through `rp_commit_turn`: one Tool Call accepts up to 32 world, time, scene, character, persona, NPC, relationship, memory, objective, or inventory changes and can replace 0–8 choices simultaneously. Each `data.key` or `data.target` is a cross-turn state identity. Current Projection is last-write-wins per key while up to 500 historical Effects remain an audit timeline. `rp_read_state` exposes the current Projection read-only, and the older single-state and separate-choice tools remain compatible with split calls.

RP Conversation presents current state instead of a raw tool stream. Up to twelve state cells show kind, title, and summary; Revision identifies atomic commits; collapsed history shows the latest twenty source Effects; choices still submit directly to the same Agent Session. Reasoning blocks are excluded from character prose. The Agent prompt requires the Ledger Tool before any visible narration and exactly one final role reply afterward.

Each Experience has an execution policy. World Simulation emphasizes time, NPC, and objective progression. Multi-character uses `rp_select_speaker` to switch the next final reply's primary character to a configured cast member, and later Transcript annotation reads the same Binding. TRPG `rp_roll` validates and executes `NdM±K` with at most 20 dice and 1,000 sides; its result is logged as a native Tool Result. Companion emphasizes relationship, memory, persona, and character continuity without requiring choices every round. These remain Prompt policies and plugin Tools inside the same `rp-agent`, not another AgentLoop.

## Verification

Focused tests prove that the recommender selects the Harness adaptation, imported character, and Character Card Scenario from a mixed import. One atomic commit writes time, scene, NPC, and choices; a later update with the same stable clock key leaves only the new time in current Projection while both commits remain in history. `rp_read_state` returns the same current Projection that was committed.

Tool tests additionally prove that `rp_select_speaker` accepts a configured cast member and rejects an outside id, while `rp_roll` keeps `2d6+3` within 5–15. The Agent RP Tool roster now contains six entries: atomic commit, single-state correction, separate choices, speaker selection, dice, and read-only state.

After installing the actual Tarball into an isolated DSH Web profile, Kaon `deepseek-v4-flash-0731` calls `rp_commit_turn` with the real Harness-adapted Izumi preset, Katisia, the `user` persona, and the Rinascita lorebook. One call atomically commits “advance ten minutes” plus “alarm locks the pier” and three choices. RP Conversation renders `WORLD LEDGER`, `REV 1`, two current states, two history entries, and three clickable buttons, while reasoning no longer appears in character prose. The new-session page recommends the same real resources with every advanced field collapsed. After reload, Import still recognizes the installed resources; one **Start Agent RP directly** click acquires a blank Session, closes Studio, binds the recommendation, and renders the compact selected state.
