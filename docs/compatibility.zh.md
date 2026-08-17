# Host 兼容性

[English](compatibility.md) | 中文

| 插件入口 | Host 要求 |
|---|---|
| `@dsh-rp/distribution-core` | Cordis 4.0.1，以及叶子包声明的精确 DSH 服务 Peer 版本；不包含 React 或浏览器 API。 |
| `@dsh-rp/distribution-web` | Core、DSH Web 服务、下列 UI Slot 与会话提交方法。 |
| `@dsh-rp/distribution` | Core 与 Web 要求的并集。 |

Web Host 必须提供这些通用 Slot：`settings.plugins.tab`、`sidebar.conversation`、`conversation.chat.message.after`、`conversation.hero.mode` 和 `conversation.rail.right`。Session Scope 的 Slot Inject Factory 会接收已解析的 `sessionId`。

浏览器会话服务必须提供 `registerSubmissionHandler()`、`encodeDraftImages()` 与 `resolveImage()`。Host HTTP 服务使用公开的 `ctx.httpServer` API。

这些要求由包 Manifest 声明，并在开发期检查。插件绝不会 Patch 不兼容的 Host。
