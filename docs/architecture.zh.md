# 插件架构

[English](architecture.md) | 中文

本仓库只包含一个 Cordis 插件发行族，不提供 DSH 应用入口，也不私有复制 Host 服务。

## 包分层

RP 服务包负责版本化约定和可逆注册。`distribution-core` 声明与展示无关的挂载顺序；`distribution-web` 只声明 `ui-slot-runtime` 与 `web`；`distribution` 把两个 Patch 层串接为单命令 Web 入口。测试保证聚合 Patch 与两个所属层逐字节一致。

`@dsh-rp/product` 是独立于完整发行族的本地优先产品 Bundle。它把 Node API、Client UI、Clean-room SillyTavern 导入路径和独立的 `rp-tavern`/`rp-agent` Agent Preset 打进一个可安装 Tarball，只使用 DSH `0.1.0-rc.6` 已存在的 `webServer`、`commands`、`agentPresets`、Session Event 与正式 Web Slot。它不启动第二套生成循环；二百五十六个稳定 System Prompt Seat 投影可变的 Prompt Manager 顺序，最多一千零二十四个保留定义容纳未编排备选。Marker 分别解析系统规则、世界观、角色阵容、用户 Persona、场景、示例与 Host 所属的聊天历史位置；纯文本 Assembler 解析身份宏与按启用顺序生效的 `setvar/getvar`，不执行脚本。导入源文档挂在可直接选择的 `sillytavern` Preset 上；经过用户明确确认的非破坏式适配会创建或刷新独立 `harness` Preset，把注入元数据归一为顺序 Seat，同时保留来源、正文、启用状态与生成参数。受支持的生成参数通过 `agent/request` Waterfall 进入请求，并由 Request Header 记录。按内容哈希寻址的 PNG 角色卡字节与产品状态并列存储，并通过同源不可变 Asset Route 提供。产品 Transcript Projection 在每条 append-origin Message 落地时记录当时的 Persona 或主要角色；正文编辑保留原始 Transcript 并追加具有完整来源的 Surface Replacement。Core Assistant Event 受 Step 生命周期约束，因此空闲时编辑角色历史使用明确封装的 `plugin/recall` user-role Node。

产品在同一套导入资源上提供独立的 `rp-tavern` 与 `rp-agent` Agent Preset。Tavern Chat 只注册 Prompt 组装；Agent RP 额外注册领域 Effect 与结构化选项工具。Tool Call/Result 是持久 Session 证据，产品文件保存带修订号 Projection，用于下一次请求与 RP 对话视图。World Info 保留逐条 ID、关键词、启用、常驻与优先级。当前 Agent Effect 覆盖世界、时间、场景、角色、Persona、关系和记忆；点击选项会把精确保存的 Prompt 送回同一个 Session。未来仍需 State Keeper Sidecar 在 Turn boundary 审计正文隐含变化，因为只靠 Prompt 不能保证模型每次都调用必需工具。

所有 `@deepseek-ai/*` 包都是外部 Peer。`scripts/fetch-host-sdk.ts` 从各包 Manifest 读取精确开发版本，以对应 npm Artifact 生成忽略的 SDK Cache。Cache 可随时删除，绝不会进入 npm Payload。

## 兼容性所有权

Core 代码面向公开 Host 服务包编译。Web 插件还需要 RP Studio 与会话位置所用的通用 Slot，以及替代会话提交 API。在这些声明进入选定的公开 Host 包之前，`types/host-extensions.d.ts` 记录精确的纯类型要求，不包含实现或回退逻辑。

因此运行时兼容始终失败关闭：旧 Host 不会因安装插件而获得缺失服务，安装过程也绝不修改 Host 代码。只有实现[兼容性参考](compatibility.zh.md)所列扩展的 DSH 版本才支持 Web 组合包。

## 测试分工

RP 单元测试负责包行为、生命周期回滚、Policy、持久化适配、包兼容、API 验证与浏览器呈现。组件测试使用的少量浏览器 Host 约定位于 `tests/host`，不会发布。产品 Bundle 另外使用一次性 DSH Home、实际 Tarball、真实 Web Profile 与 Codex 内置 Browser 验证；完整发行族的 Host 组合仍独立验收。
