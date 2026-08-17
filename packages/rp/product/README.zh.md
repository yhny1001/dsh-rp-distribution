# `@dsh-rp/product`

[English](README.md) | 中文

面向已安装 DSH `0.1.0-rc.6` Web Profile 的本地优先 RP 产品插件。一个自包含 Bundle 同时注册 Node API、`rp-tavern`/`rp-agent` 两个原生 Agent Preset、中文优先的创作工作区、角色专属对话页、会话标题栏入口和 Composer 上方的紧凑已选配置入口。升级会移除旧 `rp-studio` Agent Preset；“RP 创作室”只保留为管理界面名称。

## 酒馆式产品模型

每个会话选择一套 Prompt Preset，再组合系统规则、世界书、角色阵容、用户 Persona 与当前场景。Preset 保存全部 Prompt 定义、Role、Marker、ST 注入元数据、完整顺序配置、逐项启停与生成参数；当前顺序会在下一次原生 AgentLoop 请求时重新装配。产品最多保留 1024 个定义，每套顺序最多容纳 256 个可开关项；未编排定义也会显示并可加入顺序。管理器提供搜索、仅看已启用、启用计数与逐项上下移动。`temperature` 和 `openai_max_tokens` 分别映射到 DSH 的 `temperature` 与 `maxTokens`。ST `reasoning_effort=min` 在资源中规范化为 DSH `minimal`，请求阶段会先读取当前精确 provider/model 路由声明的档位：支持时才覆盖，不支持时保留当前模型选择或 Provider 默认值。其余已导入参数作为惰性数据保留。

内置 Marker 解析 `worldInfoBefore`/`worldInfoAfter`、`personaDescription`、`charDescription`、`charPersonality`、`scenario`、`dialogueExamples` 与 `chatHistory` 等常用标识。聊天历史仍由 DSH Session 原生位置承载；Marker 只决定结构化资源在 Prompt Stack 中的位置，不把世界观、角色、Persona 或场景合成一个不可编辑的大文本。安全宏组装支持 `{{user}}`、`{{char}}`、按启用顺序执行的纯文本 `setvar/getvar`、注释移除与 `lastUserMessage` 语义占位；不执行 TavernHelper 或 Regex 脚本。

## 角色卡与批量导入

批量导入器直接复用仓库内 Clean-room 的 `@dsh-rp/compat-sillytavern`，支持 Character Card V1/V2/V3 JSON、带 `chara`/`ccv3` 元数据的 PNG、CHARX、World Info、Persona 与 Chat Completion Preset JSON。一次导入逐文件报告结果：一个损坏文件不会丢弃同批有效资源；脚本、Regex、远程资源与未知扩展不会执行。原始 JSON 文档会随 `ST COMPAT` 资源保留，导入 Preset 立即可在会话下拉框中选择。导入完成后界面明确询问是否另外生成 `HARNESS` 适配副本；适配是非破坏式的，源 Preset 与适配副本可独立选择，重新适配只刷新确定性副本。

角色卡保留首条开场白、备选开场白、场景、示例对话、标签与来源报告。PNG 角色卡的原始图像按内容哈希写入本地产品资产目录，并用于资源列表、编辑器与对话头像。应用会话设定后，可从编排页或角色对话页把角色卡开场白加入 Session；它作为明确标注的角色历史进入模型上下文，不伪造真人来源。

## 角色对话与正文编辑

“角色对话”视图为每条用户消息显示生成当时的 Persona 名，为每条模型回复显示生成当时的主要角色名。切换主要角色不会重新标记旧消息，因此同一会话可清楚区分洛弥、沈灯等不同说话者。

用户与角色消息正文都可编辑。产品保留原始追加日志，并用包含完整 `sourceEventSeqs` 的 Session Surface replacement 更新后续模型上下文；界面显示编辑后的正文与修订号。DSH `0.1.0-rc.6` 只允许 `assistant/message` 在打开的模型 Step 内写入，因此空闲时编辑角色回复会使用 `plugin/recall` 的 user-role Surface 节点承载明确标注的“已编辑角色历史”，而 RP 视图继续呈现其原角色语义。该方式可审计且不会修改 AgentLoop。

## 世界书与双运行模式

Standalone World Info 与角色卡内嵌 Lore 会保留为逐条 World Entry，而不是只拼成一段正文。每条保留 ID、主关键词、次关键词、常驻标记、启用状态、优先级与正文；世界书编辑器提供搜索、逐条开关、增删和编辑。启用条目按优先级进入世界 Marker，关闭条目不会进入模型上下文。

每个 Session 明确选择 `Tavern Chat` 或 `Agent RP`。Tavern Chat 使用独立的 `rp-tavern` Agent Preset，底层仍复用 DSH AgentLoop，但不注册 RP 状态工具，用户体验保持传统酒馆单次生成。Agent RP 使用 `rp-agent` Agent Preset，在同一个导入 Prompt Preset、角色卡、Persona 和世界书之上注册领域工具；Experience 字段保留 `rp-adaptive`、world simulation、multi-character、TRPG 与 companion 等产品意图。

新会话首页的 Agent Preset 选择器与 Composer 上方的 RP 快速设置共享同一选择状态。选择 Tavern Chat 会立即显示 Prompt Preset、角色卡、Persona、世界书与当前场景；选择 Agent RP 会在相同资源项之外增加 Experience。若首页还没有 Session，点击应用会通过 DSH Workspace Runtime 复用或建立空白 Session，先落实所选 Agent Preset，再绑定整套 RP 资源；标准编码 Preset 不显示 RP 快速设置。

应用后，Composer 上方只保留一枚“已选”配置按钮，摘要仅显示运行模式、主要角色和 Prompt Preset；Persona、世界书与场景折叠为附加项计数，点击即可重新打开完整设置。内部 Prompt Seat 顺序不再横向铺在聊天入口上，只在 Prompt Manager 与完整编排中维护。

Agent RP 当前提供 `rp_update_state` 与 `rp_propose_choices`。前者提交世界、时间、场景、角色、Persona、关系或记忆 Effect；后者提交 1–8 个带稳定 ID、显示文本与实际 Prompt 的选项。工具调用和结果由原生 Session 记录，产品状态保存可重建 Projection，下一步请求通过 `<rp-dynamic-state>` 读取已提交事实。角色对话页同时显示角色气泡、世界/时间/场景/关系/记忆卡片与可点击选项；点击选项会把其 Prompt 送入同一个原生 Agent Session。

## 本地安装

```sh
pnpm run build
pnpm --dir packages/rp/product pack --pack-destination /tmp/dsh-rp-product
dsh plugin --profile web add /tmp/dsh-rp-product/dsh-rp-product-0.1.0-rc.5.tgz
dsh --profile web
```

可从侧栏底部或会话标题栏打开 **RP 创作室**。原生 DSH Composer、模型选择、流式输出、取消、持久化、Trajectory、Session 导出与统计继续由 Host 负责；插件不启动第二套模型循环。

## 当前限制

- Prompt 定义的原始 Role 会保留并显示，但 DSH `0.1.0-rc.6` 的公开扩展点把这些段落装配进一个系统 Prompt 字符串，不能在历史中间创建任意 system/user/assistant Message。
- PNG 角色卡原图由产品作为本地头像资产保存；CHARX 内嵌 Asset 原始字节仍按兼容层策略省略，只保留惰性元数据。
- 已被 Compaction 覆盖而不再位于当前 Surface 的消息不能局部替换；界面会保留正文，但编辑命令会明确失败。
- Swipe/Regenerate、SillyTavern Chat JSONL 导入导出、自动群聊说话人调度、Regex/STscript 与 Kobold Text Completion 尚未进入本地产品层；多角色会话目前由用户显式切换主要角色。
- Agent RP 的领域工具已经可用，但严格的每轮自动 State Keeper 审计仍需独立 Sidecar；模型若在正文里隐含状态变化却不调用工具，当前加强提示会要求提交，但尚未在 Turn boundary 强制阻止漏写。
- 产品数据原子写入 `$DSH_HOME/rp-product/product-state.json`，schema v2 不读取预发布的 schema v1；外部 Storage Provider 尚不可选。
