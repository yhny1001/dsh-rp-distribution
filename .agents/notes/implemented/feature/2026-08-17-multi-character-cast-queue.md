# Durable Multi-character cast queue

Date: 2026-08-17. Status: implemented locally.

## Decision

One DSH Assistant Message needs one auditable speaker. Concatenating several characters in one Message would break Transcript attribution, editing, and Fork. Multi-character therefore uses a cross-Turn Cast Queue. `rp_schedule_cast` sets an ordered list of 1–16 unique Character ids, all of which must belong to the Session Binding's cast. `rp_next_speaker` consumes only the head, updates the real `primaryCharacterId`, and records the previous speaker. Every DSH Turn still emits one final reply from one character.

Selecting Multi-character Experience merges the current selection with recently imported characters into a cast of at most sixteen; a Binding with fewer than two fails at load. Queue, Round, Last Speaker, and source Turn/Step/Seq live in Runtime Projection. Character deletion repairs the queue. Native Fork copies only the latest queue state sourced inside its Seed, so future scheduling never leaks into a child. `rp_select_speaker` remains a manual override when the user or model explicitly needs to skip rotation.

RP Conversation renders `GROUP TURN`, Round, previous speaker, next speaker, and the remaining queue with Character Profile names and avatars. The queue-head Tool changes Binding before final prose, so the Session Event observer records the actual character on the new Assistant Message rather than relying on a presentation guess.

## Verification

Model tests reject duplicate, outside-cast, and empty queues, then consume Qin Wu followed by Lin Yao while checking Primary Character, remaining queue, and Last Speaker. Tool tests cover schedule, consume, and `rp_read_state`; Fork tests retain only a queue sourced before Seed. In the real browser, selecting Multi-character automatically builds Katisia, Luomi, and Shen Deng. Kaon schedules that order and consumes Katisia in round one, consumes Luomi without rescheduling in round two, then consumes Shen Deng in round three. All three Transcript messages carry distinct attribution, and UI ends on `ROUND 1`, `刚刚 · 沈灯`, and “queue complete”.
