# Host compatibility

English | [中文](compatibility.zh.md)

| Plugin entry | Host requirement |
|---|---|
| `@dsh-rp/product` | DSH `0.1.0-rc.6` Web profile with `webServer`, `commands`, `agentPresets`, the native AgentLoop, and the `settings.section`, `conversation.session.header.actions`, `conversation.input.dock`, `shell.overlay`, and `sidebar.footer.action` slots. |
| `@dsh-rp/distribution-core` | Cordis 4.0.1 and the exact DSH service Peer versions declared by its leaf packages. No React or browser API. |
| `@dsh-rp/distribution-web` | Core plus DSH Web services, the UI Slot entries below, and the conversation-submission methods below. |
| `@dsh-rp/distribution` | The union of Core and Web requirements. |

The Web Host must provide these generic Slot entries: `settings.plugins.tab`, `sidebar.conversation`, `conversation.chat.message.after`, `conversation.hero.mode`, and `conversation.rail.right`. Session-scoped Slot inject factories receive the resolved `sessionId`.

The browser conversation service must provide `registerSubmissionHandler()`, `encodeDraftImages()`, and `resolveImage()`. The Host HTTP service is the public `ctx.httpServer` API.

These requirements are declared by packages and checked during development. The plugin never patches an incompatible Host.

`@dsh-rp/product` does not depend on the extension Slots listed below for the complete distribution and does not use `registerSubmissionHandler()`. It renders layered context through the official `conversation.input.dock` and enters native conversation execution by recomposing a blank Session's Agent preset. A non-blank Session refuses a mid-history preset change.
