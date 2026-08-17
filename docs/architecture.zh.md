# 插件架构

[English](architecture.md) | 中文

本仓库只包含一个 Cordis 插件发行族，不提供 DSH 应用入口，也不私有复制 Host 服务。

## 包分层

RP 服务包负责版本化约定和可逆注册。`distribution-core` 声明与展示无关的挂载顺序；`distribution-web` 只声明 `ui-slot-runtime` 与 `web`；`distribution` 把两个 Patch 层串接为单命令 Web 入口。测试保证聚合 Patch 与两个所属层逐字节一致。

`@dsh-rp/product` 是独立于完整发行族的本地优先产品 Bundle。它把 Node API、Client UI 和 `rp-studio` Agent Preset 打进一个可安装 Tarball，只使用 DSH `0.1.0-rc.6` 已存在的 `webServer`、`commands`、`agentPresets` 与正式 Web Slot。它不启动第二套生成循环；五个独立 System Prompt Section 分别投影系统规则、世界观、角色阵容、用户 Persona 与当前场景，普通对话继续由原生 AgentLoop 执行。

所有 `@deepseek-ai/*` 包都是外部 Peer。`scripts/fetch-host-sdk.ts` 从各包 Manifest 读取精确开发版本，以对应 npm Artifact 生成忽略的 SDK Cache。Cache 可随时删除，绝不会进入 npm Payload。

## 兼容性所有权

Core 代码面向公开 Host 服务包编译。Web 插件还需要 RP Studio 与会话位置所用的通用 Slot，以及替代会话提交 API。在这些声明进入选定的公开 Host 包之前，`types/host-extensions.d.ts` 记录精确的纯类型要求，不包含实现或回退逻辑。

因此运行时兼容始终失败关闭：旧 Host 不会因安装插件而获得缺失服务，安装过程也绝不修改 Host 代码。只有实现[兼容性参考](compatibility.zh.md)所列扩展的 DSH 版本才支持 Web 组合包。

## 测试分工

RP 单元测试负责包行为、生命周期回滚、Policy、持久化适配、包兼容、API 验证与浏览器呈现。组件测试使用的少量浏览器 Host 约定位于 `tests/host`，不会发布。产品 Bundle 另外使用一次性 DSH Home、实际 Tarball、真实 Web Profile 与 Codex 内置 Browser 验证；完整发行族的 Host 组合仍独立验收。
