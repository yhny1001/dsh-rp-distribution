# 本地优先 RP 产品 Bundle

日期：2026-08-17。状态：已实施。

## 决策

`@dsh-rp/product` 是插件仓库中第一层可直接使用的产品入口。它是一个自包含本地 Bundle，不是第二套 DSH 应用，也不等待完整的 55 包基础发行族发布后才可安装。

产品只使用 DSH `0.1.0-rc.6` 已存在的 `webServer`、`commands`、`agentPresets`、原生 AgentLoop，以及可追加的 `settings.section`、`conversation.session.header.actions`、`conversation.input.dock`、`shell.overlay`、`sidebar.footer.action` Slot。它不修改 Host 源码，也不替换常驻 Composer。

## 提示词所有权

每个 Session Binding 选择一个系统规则、一个世界观、一个或多个角色及其中的主要角色、一个用户 Persona 和一个当前场景。`rp-studio` Agent Preset 按该顺序注册五个独立命名的 System Prompt Section。因此，系统行为、模型扮演身份、用户身份、客观世界事实与临时场景事实在存储、界面、提示词装配和调试中始终可区分。

把 Binding 应用到空白 Session 时，插件记录普通 Command 生命周期，把 Agent 重组为 `rp-studio`，并追加标准 `agent-preset/selected` 事件。非空 Session 拒绝接管 Preset。角色、Persona、世界与场景编辑仍可在后续 Turn 生效，因为提示词 Provider 会在每次请求装配时读取最新的原子产品状态。

## 验证

插件以实际 npm Tarball 安装到一次性 DSH Home。验证范围包括 Bundle 组合、API 挂载、Preset 发现、Client ModuleLoader 挂载、产品 CRUD、Session Binding、五层上下文条、通过 OpenAI-compatible Provider 的原生 AgentLoop 流式回复，以及最终模型回复中的角色、世界观和 Persona 隔离。浏览器验证只使用 Codex 内置 Browser。
