# @dsh-rp/web

[English](README.md) | 中文

`@dsh-rp/web` 提供 DSH Web RP Studio 以及 Web 与 Headless 共用的 Host API。Studio 包含 Experience 清单、Pipeline 与授权检查器、事务化插件管理器、由事件回放支撑的实时 Session Timeline，以及 Character Card JSON/PNG/CHARX、World Info、Preset 和 Chat JSONL 的 Creator 导入预览。

插件管理器调用 Host Registry，不在浏览器内加载软件包。安装、精确依赖图更新和确认卸载会展示来源、版本锁、Owner、Lifecycle、Trust、权限、内容哈希、签名撤销、SBOM 和证据策略。Creator 导入会保留未知字段和兼容性警告，但导入脚本与远程资源始终保持惰性。Creator 的预设流程与 Headless Client 使用同一个 Host Runtime：先预览 JSON 源，再把 SillyTavern 定义显式投影为核心 Preset 拥有的 `schemaVersion`、`id`、`name`、`role`、`content` 与 `marker`，持久化服务端规范记录，随后为当前实时 RP Session 激活，并在刷新或 Host 重启后恢复精确绑定。`systemPrompt`、`forbidOverrides` 与 Injection 元数据保持在兼容来源中，不会作为未声明字段越过核心包边界。

可安装包的 UI 只从 `ctx.rpUiSlots` 投影，绝不会进入主 React 同源环境。包资产使用严格 MIME、`nosniff` 和限制性 CSP；包 iframe 不具备脚本、同源权限、Session props 或 Host Bridge。

## 可直接游玩的 Web 会话

发行版客户端注册通用会话提交 Handler，而不替换 DSH 常驻编辑器。每个实时 Session 默认进入使用 `rp-adaptive` 的 RP 模式；新会话顶部主模式区会显示统一的“对话模式”选择器，与 Agent 预设处于同一级，可直接选择“普通 Agent”或任一已注册的“RP 模式 · Experience”。已有会话则在会话标题栏保留同一选择器，不再把 RP 开关藏在输入框右下角。因此 RP 提交仍复用现有草稿事务、键盘行为和扩展 Seat。只有 RP 路由胜出后才显式编码所选图片；Host 在有效 Trust 与 `attachment.write` 权限下交给可插拔媒体输入 Adapter 准入，任一阶段拒绝都会连同文本恢复草稿。

一个 Apply Scope 内的 Controller 按 Session 持有模式、Experience、请求、错误、回放和取消状态。它把 `sessionId` 同时作为匹配的 Agent 身份，从不发送授权；用户取消或 Session 消失时会中止精确的 Transport。明确失败后的下一次发送会使用新请求 id；`DURABILITY`、无效成功响应或结果不明确的网络失败会锁定原请求体和 request id，只允许原样重试，避免第一次交付结果未知时再产生第二次语义 Turn。

编辑器 Dock 展示运行／取消、公开错误、原样重试提示和最近一次持久提交。`RP` 会话 Tab 按 `turnId` 关联 `rp/context-activated` 与 `rp/turn-committed`，重建用户／Assistant 对话和已授权图片，并公开完整的脱离运行时引用的 Agent／Pipeline 事件轨迹。Studio 的 Timeline 页面会跟随最近一次浏览器 Turn，同时保留手动 Session 查询。Session 移除会清理 Store，并中止 Turn 与 Timeline 请求；插件卸载会同时移除提交路由、UI Seat、Store 和 Transport。

浏览器只调用同源 `/api/rp/v1` 路由，不会把部署 Bearer Secret 写入或持久化在客户端。回环地址上的 Web 可以直接使用。非回环部署若启用了 `turnApi.bearerToken`，必须由已认证的反向代理／客户端 Transport 提供 Authorization Header；发行版不会把部署密钥暴露进公开浏览器 Bundle。

## Turn API

`POST /api/rp/v1/turn` 与进程内 `executeRpTurn()` 使用同一条业务链：

`实时 Agent → Experience → 冻结的 Turn Pipeline → Effects 校验 → Session 原子提交 → 持久化 Flush → 回放 Projection`

请求包含 `schemaVersion: 1`、唯一 `requestId`、相同的 `sessionId` 与 `agentId`、可选 `experienceId` 和 Scope、JSON 输入、可选的有界图片传输值及可选客户端上下文。请求不能包含权限、Trust、预算、网络域名、文件根目录或其他授权字段；Host 只从部署配置和已注册 Policy Layer 推导有效授权。

指定 Session 及其精确 Owner Agent 必须已经存活。请求提供的 Scope 必须位于该 Session 的 Conversation 链内；Agent Scope 必须指向同一个 Agent。API 有意不创建或恢复身份。执行会进入该 Agent 的 Maintenance 阶段，因此普通 Agent Loop Turn、另一条 RP Turn 或同一 Agent 的维护工作会返回 `BUSY`，不会竞争同一个 Session。

`requestId` 对规范化后的请求体提供幂等性。完全相同的重试会重放既有提交，不会再次调用 Agent；请求体漂移会冲突，已中止的 id 不能复用。提交前取消会追加 `rp/turn-aborted`，不会留下 Assistant、State 或 Memory 的半提交。

只有至少一个 Session 持久化监听器参与且所有监听器成功结束后，API 才返回成功。`DURABILITY` 表示 Turn 已在内存提交，但持久化结果不确定。唯一受支持的重试方式是使用相同 `requestId` 和完全相同的请求体；重试只会重新执行 Flush 屏障，不会重新执行已经提交的 Agent Turn。

HTTP 请求必须是 JSON，并有明确容量上限；进程内 Headless 调用也受同一个规范化容量限制。跨站请求会被拒绝。只要 WebServer 没有绑定到 `localhost`、`127.0.0.0/8` 或 `::1`，部署就必须配置 Bearer Token；在回环地址上配置 Token 后也必须携带。内部错误原因只写日志，不返回客户端。

### 部署配置

`turnApi` 默认启用 `rp-adaptive` 和全部第一方 Experience；Trust 上限为 `L2`，权限为 `rp.pipeline.execute`、`agent:spawn` 与 `attachment.write`，预算为 60 秒、128k Token、64 次 Tool、8 个 Agent；默认不授予网络或文件权限，请求体上限为 8 MiB（可配置至 32 MiB）。`defaultExperience` 必须位于 `allowedExperiences` 中；重复或未规范化的授权值以及过短 Token 会让插件在激活阶段直接失败。Base64 只存在于该有界传输体；Journal、Projection、Agent Trace 与响应只保留不可变附件引用。

HTTP 失败映射为：无效请求 `400`，准入或授权拒绝 `403`，实时身份或 Experience 不存在 `404`，冲突或 Agent 忙碌 `409`，取消 `499`，持久化不确定 `503`，被隔离的执行错误 `500`。

## 其他 Host 路由

Catalog、Timeline、Registry、Creator 与 Preset 路由只返回脱离运行时引用的 JSON Snapshot。Catalog 请求返回轻量摘要；带资源 id 的 GET 请求只在打开编辑器时返回完整规范 IR。POST 可以保存导入源、原位更新同一 id 的角色卡、Persona、世界书或预设、为精确的暂存或实时 Conversation Scope 激活或停用资源，或者删除资源。预设更新会从选中的顺序和定义重新生成 Turn 实际消费的 Prompt，同时保留当前会话绑定。Library 资产使用相同的预组装规则，因此新会话可以在第一个实时 Agent Session 实例化之前完成绑定。Turn 执行仍要求该精确 Session 已经实时存活。Mutation 和 Import 请求都有容量上限，浏览器 Mutation 会拒绝跨站调用者。来源与执行授权仍由部署注册的 Provider 和 Lifecycle Adapter 持有。

RP 模式把这些路由组成三栏会话界面：左侧资源栏负责导入、绑定和选择要编辑的资产，中间显示标准的持久聊天记录，右侧提供角色卡、Persona、世界书和预设的结构化编辑器，并继续展示当前组合和事件轨迹。保存会保留未知兼容字段、稳定资源 id 与会话绑定；回放标签仍是 RP Journal 的权威视图，其中包含每个 Turn 实际使用的冻结 Prompt 和 Snapshot。

## 模型体验

无，因为本包不添加模型可见 Prompt 或 Schema；所选 Experience 拥有它实际调度的 Agent、Tool、Skill、Subagent、Workflow、Pipeline 或模型调用。

#### KV Cache 影响

本包不添加缓存前缀内容。缓存复用取决于所选 Experience 及其冻结的 Context、Composition 和 Pipeline Snapshot；幂等重放不会调用模型。

## 已知限制与延期工作

- Turn API 当前返回一个终态 JSON 结果；Token 和 Stage 流式传输由独立 Transport 插件提供。
- Agent 创建/恢复及认证账号映射仍是 Host 所有的能力，不是 Turn API 的隐式行为。
- 丰富图布局、Token／Stage 增量流式传输以及 Timeline 实时推送仍由同一 Host 数据之上的独立插件提供。
