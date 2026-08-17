# `@dsh-rp/product`

[English](README.md) | 中文

面向已安装 DSH `0.1.0-rc.6` Web Profile 的本地优先 RP 产品插件。一个自包含 Bundle 同时注册 Node API、`rp-tavern`/`rp-agent` 两个原生 Agent Preset、中文优先的创作工作区、角色专属对话页、会话标题栏入口和 Composer 上方的紧凑已选配置入口。升级会移除旧 `rp-studio` Agent Preset；“RP 创作室”只保留为管理界面名称。

## 酒馆式产品模型

每个会话选择一套 Prompt Preset，再组合系统规则、世界书、角色阵容、用户 Persona 与当前场景。Preset 保存全部 Prompt 定义、Role、Marker、ST 注入元数据、完整顺序配置、逐项启停与生成参数；当前顺序会在下一次原生 AgentLoop 请求时重新装配。产品最多保留 1024 个定义，每套顺序最多容纳 256 个可开关项；未编排定义也会显示并可加入顺序。管理器提供搜索、仅看已启用、启用计数与逐项上下移动。`temperature` 和 `openai_max_tokens` 分别映射到 DSH 的 `temperature` 与 `maxTokens`。ST `reasoning_effort=min` 在资源中规范化为 DSH `minimal`，请求阶段会先读取当前精确 provider/model 路由声明的档位：支持时才覆盖，不支持时保留当前模型选择或 Provider 默认值。其余已导入参数作为惰性数据保留。

内置 Marker 解析 `worldInfoBefore`/`worldInfoAfter`、`personaDescription`、`charDescription`、`charPersonality`、`scenario`、`dialogueExamples` 与 `chatHistory` 等常用标识。聊天历史仍由 DSH Session 原生位置承载；Marker 只决定结构化资源在 Prompt Stack 中的位置，不把世界观、角色、Persona 或场景合成一个不可编辑的大文本。安全宏组装支持 `{{user}}`、`{{char}}`、按启用顺序执行的纯文本 `setvar/getvar`、注释移除，并从 Agent 已领取但尚未写入 Session 的当前用户消息展开首步真实 `{{lastUserMessage}}`，后续步骤回退到最新原生 `user/message`。导入 Preset 的 User/Assistant Role 分别保留为 `<st-user-message>` 与 `<st-assistant-prefill>` 语义边界；固定 ST Role Protocol 声明作者人格只管理内部创作过程，可见回复必须属于当前角色。Role Protocol 排在 Host 基础段之后，导入 Seat 从顺序 1000 开始；当顺序以 Assistant Prefill 结尾时，该 Prefill 固定占用最后一个 Seat，Agent RP 运行规则紧挨其前，因此 Preset 的生成起点仍是模型读取的最后一组 System 内容，同时保留 DSH 工具约束。包含未闭合 `planning`/`thinking`/`reasoning` 标记的 Prefill 会保留转义后的源文本并声明为 `private-reasoning`，让 Provider 在 Reasoning Channel 中应用而不把规划块泄漏到可见角色正文。不执行 TavernHelper 或 Regex 脚本。

全部非 History Prompt 层通过 `@deepseek-ai/dsh-system-prompt` Registry 进入持久 `request/header.header.system`，最终发送为 Provider 的 `request.system`。产品界面在快速设置、会话已选入口、完整编排和 Prompt Manager 中显示 `Preset → @deepseek-ai/dsh-system-prompt → request.system` 注入路径；应用回执也明确记录该路径。原生会话中显示的“上下文注入 `@deepseek-ai/dsh-system-prompt`”只代表权限与沙箱等动态 Context Snapshot，不代表完整 System Prompt，产品不会把 Preset 复制到该 user-role Snapshot。角色卡 `first_mes` 与聊天记录继续留在 Session History。

## 角色卡与批量导入

批量导入器直接复用仓库内 Clean-room 的 `@dsh-rp/compat-sillytavern`，支持 Character Card V1/V2/V3 JSON、带 `chara`/`ccv3` 元数据的 PNG、CHARX、World Info、Persona 与 Chat Completion Preset JSON。一次导入逐文件报告结果：一个损坏文件不会丢弃同批有效资源；脚本、Regex、远程资源与未知扩展不会执行。原始 JSON 文档会随 `ST COMPAT` 资源保留，导入 Preset 立即可在会话下拉框中选择。导入完成后界面明确询问是否另外生成 `HARNESS` 适配副本；适配是非破坏式的，源 Preset 与适配副本可独立选择，重新适配只刷新确定性副本。

导入完成后不要求用户理解 Prompt Seat 或逐项配置。推荐器优先选择最近导入的 Harness 适配 Preset、角色卡、Persona 与世界书，并从 Character Card Scenario 生成开局；新会话快速页默认折叠高级字段，只显示已就绪组合和开始按钮。导入结果还提供“直接开始 Tavern”和“直接开始 Agent RP”，自动取得空白 DSH Session、切换原生 Agent Preset 并绑定推荐组合。

角色卡保留首条开场白、备选开场白、场景、示例对话、标签与来源报告。PNG 角色卡的原始图像按内容哈希写入本地产品资产目录，并用于资源列表、编辑器与对话头像；统一头像容器同时以组件内联尺寸和 CSS 强制方形 `cover` 裁切，把竖版角色图焦点上移到脸部，即使样式表延迟或浏览器混用旧缓存，原图也不能投射为聊天背景或越过头像边界。首次把组合应用到空白 Session 时，产品自动把 Character Card `first_mes` 作为明确标注的角色历史加入原生 Session，复现 ST 新聊天的角色锚点；之后仍可从编排页或角色对话页手动加入备选开场白，不伪造真人来源。

## 角色对话与正文编辑

“角色对话”视图为每条用户消息显示生成当时的 Persona 名，为每条模型回复显示生成当时的主要角色名。切换主要角色不会重新标记旧消息，因此同一会话可清楚区分洛弥、沈灯等不同说话者。

用户与角色消息正文都可编辑。产品保留原始追加日志，并用包含完整 `sourceEventSeqs` 的 Session Surface replacement 更新后续模型上下文；界面显示编辑后的正文与修订号。DSH `0.1.0-rc.6` 只允许 `assistant/message` 在打开的模型 Step 内写入，因此空闲时编辑角色回复会使用 `plugin/recall` 的 user-role Surface 节点承载明确标注的“已编辑角色历史”，而 RP 视图继续呈现其原角色语义。该方式可审计且不会修改 AgentLoop。

角色对话页可直接导入 SillyTavern Chat JSONL 或 JSON 数组，并导出当前可见对话为 JSONL。导入跳过 Metadata 与 System 行，角色消息以 `plugin/recall` 进入原生 Session，Persona 消息以 `plugin/notice` 进入，RP Transcript 保留原说话者、正文和顺序；单批限制 500 条、每条 32000 字符、总计 1000000 字符。导出保留 `name`、`is_user`、`mes` 等 ST 字段，并在 `extra` 中附带 DSH Source Seq 与编辑 Revision。

第二轮及以后的角色回复提供“分支重写”。它调用 DSH 原生 `session.fork`，从目标回复之前的已完成 Turn 建立子 Session，再验证原生 `parentSession` 和继承的 RP Agent Preset，按 Seed Length 裁切并复制 RP Binding、Transcript 与 World Ledger，最后把目标轮的原用户消息送入子 Session 重新生成。父 Session、原回复和原状态完全保留；子 Session 出现在侧栏并拥有原生 Fork Lineage。首轮没有前一已完成 Turn，按钮会明确禁用而不伪造分支。

## 世界书与双运行模式

Standalone World Info 与角色卡内嵌 Lore 会保留为逐条 World Entry，而不是只拼成一段正文。每条保留 ID、主关键词、次关键词、常驻标记、启用状态、优先级与正文；世界书编辑器提供搜索、逐条开关、增删和编辑。启用条目按优先级进入世界 Marker，关闭条目不会进入模型上下文。

每个 Session 明确选择 `Tavern Chat` 或 `Agent RP`。Tavern Chat 使用独立的 `rp-tavern` Agent Preset，底层仍复用 DSH AgentLoop，但不注册 RP 状态工具，用户体验保持传统酒馆单次生成。Agent RP 使用 `rp-agent` Agent Preset，在同一个导入 Prompt Preset、角色卡、Persona 和世界书之上注册领域工具；Experience 字段保留 `rp-adaptive`、world simulation、multi-character、TRPG 与 companion 等产品意图。

新会话首页的 Agent Preset 选择器与 Composer 上方的 RP 快速设置共享同一选择状态。选择 Tavern Chat 会立即显示 Prompt Preset、角色卡、Persona、世界书与当前场景；选择 Agent RP 会在相同资源项之外增加 Experience。若首页还没有 Session，点击应用会通过 DSH Workspace Runtime 复用或建立空白 Session，先落实所选 Agent Preset，再绑定整套 RP 资源；标准编码 Preset 不显示 RP 快速设置。

应用后，Composer 上方只保留一枚紧凑的 `SYSTEM ✓` 配置按钮，摘要显示运行模式、主要角色和 Prompt Preset；Persona、世界书与场景折叠为附加项计数，点击即可重新打开完整设置。内部 Prompt Seat 顺序不再横向铺在聊天入口上，只在 Prompt Manager 与完整编排中维护。

Agent RP 把每轮视为世界 Ledger 的 N→N+1 提交。首选工具 `rp_commit_turn` 在一次已记录调用中原子提交 0–32 条变化和 0–8 个选项，覆盖世界、时间、场景、角色、Persona、NPC、关系、记忆、目标与物品；`data.key`/`data.target` 提供跨轮稳定身份，当前状态按键 Last-write-wins，完整事件仍留在履历。`rp_read_state` 提供只读结构化检查，`rp_update_state` 与 `rp_propose_choices` 保留为分步兼容工具。下一轮请求通过 `<rp-dynamic-state>` 读取当前 Projection；角色对话页显示世界状态面板、Revision、状态履历和可点击选项，Reasoning Block 不进入角色正文。

State Keeper 在每轮第一次输入进入时记录 Ledger Revision，并在原生 `agent/turn-stopping` 扩展点审计本轮是否推进。没有提交时会自动 Steering 要求补交；确实没有变化也必须以 `updates: []` 留下无变化审计。连续两次忽略后该轮失败关闭，不能静默产生无 Ledger 的 Agent RP 回复。内部审计消息与 Reasoning 一样不进入角色对话正文。

Experience 会改变 Agent 行为，而不只是保存标签。World Simulation 强化时间、NPC 与目标的因果推进；Multi-character 通过 `rp_schedule_cast` 建立持久有序队列，再由 `rp_next_speaker` 逐 Turn 消费队首并切换真实 Primary Character，`rp_select_speaker` 只保留为手动覆盖。队列 Round、上一位和下一位会显示在角色对话页，Transcript 按真实角色署名。TRPG 可用已记录的 `rp_roll` 执行有界 `NdM±K` 检定，并把结果造成的目标、物品或世界变化提交到 Ledger；Companion 优先关系、记忆、Persona 与角色状态，并取消强制每轮给选项。

产品 Bundle 内含 `@dsh-rp/product/media` 子插件，它复用共享 `@dsh-rp/media` Provider Registry，而不是复制媒体逻辑。内置 L0 `svg-card` Provider 零配置生成确定性 SVG 场景卡；`rp_list_media_providers` 列出当前能力，`rp_generate_media` 路由图片或音频请求。Artifact 作为带 Turn 来源的 `media` Effect 进入 Gallery，下一轮上下文只保留 ID、类型和 MIME，不注入 Data URI。外部插件可向同一 `rpMedia` Service 注册真实图片或 Audio Provider。没有 Audio Provider 时请求明确失败；每条角色正文仍可用浏览器本地“朗读”，不会上传音频。

## 本地安装

```sh
pnpm run build
pnpm --dir packages/rp/product pack --pack-destination /tmp/dsh-rp-product
dsh plugin --profile web add /tmp/dsh-rp-product/dsh-rp-product-0.1.0-rc.5.tgz
dsh --profile web
```

可从侧栏底部或会话标题栏打开 **RP 创作室**。原生 DSH Composer、模型选择、流式输出、取消、持久化、Trajectory、Session 导出与统计继续由 Host 负责；插件不启动第二套模型循环。

## 当前限制

- DSH `0.1.0-rc.6` 的公开 Prompt 扩展点仍不能在历史中间创建任意真实 system/user/assistant Message；产品以明确的 `<st-user-message>`/`<st-assistant-prefill>` 协议、首步真实 `lastUserMessage` 展开、Preset 后置优先顺序和自动 `first_mes` 复现 ST 组装语义，但 Provider 看到的底层载体仍是一个 System Prompt 加原生 Session History。
- PNG 角色卡原图由产品作为本地头像资产保存；CHARX 内嵌 Asset 原始字节仍按兼容层策略省略，只保留惰性元数据。
- 内置媒体 Provider 只生成确定性 SVG Scene Card；Raster Image、持久 TTS Audio、Video 与 Document 需要独立 Provider 插件。浏览器本地“朗读”不是可导出的 Audio Artifact。
- 已被 Compaction 覆盖而不再位于当前 Surface 的消息不能局部替换；界面会保留正文，但编辑命令会明确失败。
- 当前 Swipe/Regenerate 采用原生子 Session 分支，而不是同一气泡内的 ST Swipe 数组；首轮因没有可裁切前缀暂不支持。Multi-character 队列按多个 DSH Turn 轮流产生一位角色正文，不会在一个 Turn 中批量生成多个角色气泡。Regex/STscript 与 Kobold Text Completion 尚未进入本地产品层。
- State Keeper 强制每轮至少推进一次 Ledger Revision，但当前只证明“发生了提交”，不会语义比较角色正文与状态 Patch 是否完整一致；更深的独立语义审计仍可作为后续 Provider 插件加入。
- 产品数据原子写入 `$DSH_HOME/rp-product/product-state.json`，schema v2 不读取预发布的 schema v1；外部 Storage Provider 尚不可选。
