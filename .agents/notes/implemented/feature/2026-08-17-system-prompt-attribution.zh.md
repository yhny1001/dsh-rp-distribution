# System Prompt 注入归因

日期：2026-08-17。状态：已在本地实现。

## 问题

RP 产品已经通过 `ctx.systemPrompt.section()` 把导入 Preset、角色、Persona、世界书、场景和运行协议写入 `request/header.header.system`，但 DSH 原生对话只显示一条来源为 `@deepseek-ai/dsh-system-prompt` 的动态 Context Snapshot。该 Snapshot 只包含沙箱、工作区和审批策略，却被界面统称为“上下文注入”，因此用户会合理地误判完整 Preset 没有进入 DeepSeek `system` 字段。角色卡 `first_mes` 又以 `@dsh-rp/product` 的 `plugin/recall` 历史出现，进一步放大了 System 与 History 载体不清晰的问题。

## 决策

不把 Preset 复制到动态 Context Snapshot，也不改变 Session History 的来源。快速设置、会话标题、Composer 紧凑入口、完整编排和 Prompt Manager 统一显示 `Preset → @deepseek-ai/dsh-system-prompt → request.system`；紧凑入口使用 `SYSTEM ✓`，避免恢复曾经横向铺满 Composer 的 Prompt Stack。编排预览明确只把非 History 层称为 System Prompt，说明聊天记录 Marker 与角色卡 `first_mes` 仍由原生 Session History 承载。`rp-studio-bind` 回执和 `rp-agent`/`rp-tavern` 选择器说明也记录同一路径，使持久轨迹、开始界面和管理界面保持一致。

## 验证

单元测试要求绑定回执包含 `@deepseek-ai/dsh-system-prompt` 与 `request.system`。实际 Tarball 安装到一次性 DSH Home 后，在 Codex 内置浏览器验证新会话快速设置、Agent Preset 说明、Composer `SYSTEM ✓`、完整编排路径和 Prompt Manager 路径；随后检查 `request/header.header.system` 仍只包含一份完整 Preset，原生 `user/message` 只保留真实用户输入、动态权限 Snapshot 与明确角色历史。
