# Local-first RP product Bundle

Date: 2026-08-17. Status: implemented.

## Decision

`@dsh-rp/product` is the first directly usable product layer in the plugin-only repository. It is one self-contained local Bundle rather than a second DSH application and does not wait for the complete 55-package foundation distribution to be published.

The product uses DSH `0.1.0-rc.6` interfaces that already exist: `webServer`, `commands`, `agentPresets`, the native AgentLoop, and the additive `settings.section`, `conversation.session.header.actions`, `conversation.input.dock`, `shell.overlay`, and `sidebar.footer.action` Slots. It never mutates Host source or replaces the resident composer.

## Prompt ownership

One Session binding selects a system profile, a world, one or more characters with one primary role, a user persona, and a current scene. The `rp-studio` Agent preset registers five separately named system-prompt sections in that order. System behavior, model-played identities, user identity, objective world facts, and transient scene facts therefore remain distinguishable in storage, UI, prompt assembly, and debugging.

Applying a binding to a blank Session records the ordinary command lifecycle, recomposes the Agent to `rp-studio`, and appends the standard `agent-preset/selected` event. A non-blank Session refuses preset takeover. Catalog and scene edits remain live because each prompt provider reads the latest atomic product state at request assembly.

## Verification

The package is installed as an actual npm Tarball into a disposable DSH Home. Verification covers Bundle composition, API mounting, preset discovery, Client ModuleLoader mounting, product CRUD, Session binding, the five-layer context strip, native AgentLoop streaming through an OpenAI-compatible Provider, and the final role/world/persona separation in the model reply. Browser verification uses the Codex in-app Browser.
