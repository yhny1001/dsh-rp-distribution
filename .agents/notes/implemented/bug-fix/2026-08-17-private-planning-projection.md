# Private planning projection isolation

Date: 2026-08-17. Status: implemented locally.

## Problem

The Izumi preset's terminal Assistant Prefill opens `<konatan_planning~>`. Compatibility already escapes that source and marks it `private-reasoning`, but a Provider can still emit planning through an ordinary Assistant Text Block. Prompt instructions cannot prove universal model compliance. RP projection previously excluded native Reasoning Blocks only, so `<konatan_planning~>…</konatan_planning~>` inside Text became character prose and propagated to the character bubble, read-aloud, editing, and export. Existing Session source would keep leaking unless projection itself owned a deterministic rule.

## Decision

A pure `visibleRoleplayText()` function recognizes only tag names explicitly containing planning, thinking, reasoning, analysis, scratchpad, or chain-of-thought. A complete block is removed from its opening tag through the matching closing tag; an unclosed block is removed through message end; an orphan matching close tag is removed as well. Every other structured tag remains byte-for-byte visible. Both streaming bubbles and final `storyMessages` use the function, so read-aloud, editor initial content, branch input inspection, and Tavern export naturally reuse one visible body. Original `assistant/message` data is unchanged and remains in Session history for audit; replay after upgrade immediately produces a clean projection without product-state migration.

## Verification

Unit coverage includes a complete Konata planning block, multiple private blocks, unclosed analysis, an orphan scratchpad close tag, and preserved `current_event`. After installing the actual Tarball into a disposable DSH home, the Codex in-app browser reopens the historical character message shown by the user and confirms that `<konatan_planning~>` plus its private plan disappear while character prose after the closing tag remains. Editing, read-aloud, and export are checked to consume the same filtered body.
