# 酒馆式 RP 产品迭代

日期：2026-08-17。状态：已在本地实现。

## 决策

`@dsh-rp/product` 负责酒馆式资源与对话体验，但不成为第二套 Harness。产品状态 schema v2 增加 Prompt Manager Preset、导入来源、Character Card 开场白/示例/标签与逐 Session Transcript Annotation。Bundle 复用 `@dsh-rp/compat-sillytavern` 作为 Clean-room Parser，并内联该 Adapter 与二进制依赖，因此安装产品 Tarball 不要求完整 RP 发行族。

Prompt Preset 最多保留一千零二十四个定义，每套顺序使用最多二百五十六个固定 System Prompt Seat；Cordis Registration 是 Effect，而用户顺序是可变数据。未编排定义可在以后加入。常用 Marker 解析为分别所属的系统、世界观、角色、Persona、场景、示例与聊天历史材料。安全的纯文本宏阶段解析角色/Persona 名称和按顺序生效的 `setvar/getvar`，不会获得 TavernHelper 或 Regex 执行权限。`agent/request` Waterfall 先调用 `next()`，再应用受支持的生成参数覆盖；Request Header Event 继续作为模型请求的持久记录。内置默认输出上限为 8192 Token，导入的 `openai_max_tokens` 则原值保留；ST `min` 推理规范化为 DSH `minimal`，最终仍受所选路由声明的档位约束。

## Transcript 所有权与编辑

DSH Session Log 始终不可变且权威。产品只记录 append-origin User/Assistant Message 落地时所选的 Persona 或主要角色，以及后续编辑元数据。RP 视图把这些 Annotation 与 Host Conversation Snapshot 组合，因此切换当前主要角色不会重新标记旧消息。

用户编辑以当前 Surface Node 为目标，并引用该 Node 与已知来源。Core 允许 `user/message` 在 Open Step 之外替换，却要求每个 `assistant/message` 指向当前打开的 Turn 与 Step，因此产品不能在用户编辑空闲会话时追加 Assistant Rewrite。产品改写为明确封装的 `plugin/recall` user-role Node，声明内容属于已编辑角色历史；RP Transcript 仍保留原角色语义。后续模型请求会消费编辑正文，同时无需修改 AgentLoop，也不会伪造真人权限。

## 导入行为

本地 API 接受有界的 Character Card JSON/PNG/CHARX、World Info、Persona 与 Chat Completion Preset 批次。每个文件独立解析并明确报告；同批某个文件无效时，有效文件仍作为一次乐观产品状态修订提交。PNG 角色卡字节按内容寻址，写在产品状态旁，只能通过经过校验的同源 Asset ID 提供；CHARX 内嵌原始字节仍保持惰性。Script、Regex、远程资源与未知 Extension 行为继续按兼容 Adapter 报告保持惰性。

Preset 导入明确采用双轨。无损源文档挂在立即可选的 `sillytavern` Preset 上，界面随后询问是否生成独立 `harness` 适配副本；接受后只创建或刷新确定性副本，不覆盖源。适配保留定义、所选顺序、开关、Role、Marker、正文、安全变量与生成参数，只移除当前 Host 无法执行的 ST 注入元数据。两个条目都可按 Session 选择；适配报告记录源 ID、转换时间、归一字段数、惰性扩展数与说明。

产品现在在 Agent Preset 层区分 Tavern Chat 与 Agent RP。`rp-tavern` 挂载 Prompt 组装但不提供领域工具；`rp-agent` 在同一导入 Prompt Preset 上增加 `rp_update_state` 与 `rp_propose_choices`。前者提交带修订号的世界/时间/场景/角色/Persona/关系/记忆 Effect，后者提交稳定可点击选项。原生 Tool Call/Result 保持持久证据，产品状态作为 Projection 进入后续 Request Header 与领域卡片。World Info Entry 在编辑器保留主/次关键词、常驻、开关和优先级。模型遵从性尚不是硬 Invariant：加强后的 Agent Prompt 要求正文隐含变化全部使用工具，但最终仍需 State Keeper Sidecar 在 Turn boundary 审计。

新会话首页尚无 Session 时，原生 Agent Preset Seat 只在组件内部暂存选择，其他插件无法读取，RP Binding 也没有可接收 Command 的 Agent。产品因此以更高优先级提供兼容的 Preset Seat，保留部署中的全部健康 Preset，同时把选择公开给 RP 快速设置。Tavern 与 Agent 共同显示 Prompt Preset、角色卡、Persona、世界书和场景，只有 Agent 显示 Experience。应用操作通过 Workspace Runtime 复用或创建空白 Session，等待客户端 Binding 可用，落实暂存 Preset，再提交原有 `rp-studio-bind` Command；标准编码 Preset 不产生 RP Surface。

## 验证

聚焦测试覆盖 Prompt Manager 顺序与 Marker、210 个定义/177 个开关/56 个启用项的 Preset、无损源保留与非破坏式适配、生成参数、安全宏、PNG Asset 持久化、混合导入、修订串行化、激活回滚、说话者捕获和具有完整来源的 Surface 编辑。实际 Tarball 安装到隔离 DSH `0.1.0-rc.6` Web Profile；Codex 内置 Browser 先验证导入两张 Character Card、一套 Preset 与一个无效文件，再导入用户提供的 3.4 MiB CCv3 PNG 和 453 KiB、210 定义 Preset。真实 Preset 显示 177 个独立开关、56 个源文件默认启用项、33 个未编排定义、maxTokens 30000 与两条禁用行为警告；真实 Request Header 记录 temperature 1、maxTokens 30000、10511 字符 System Prompt 且没有未解析双花括号宏。导入结果会询问是否适配；接受后保留 `[ST COMPAT] Izumi 0814.json`，创建 `[Harness] Izumi 0814.json · Harness` 并自动选择副本，随后又完成一次真实模型调用。真实模型调用以 PNG 角色卡名称回复。此前验证还编辑回复、证明下一次模型调用使用编辑正文、切换主要角色，并证明新旧回复保留不同说话者名称。

Agent RP 浏览器验收选择 `rp-adaptive`、真实角色卡与 Harness 适配 Izumi Preset。模型实际调用三次状态工具（时间、场景、记忆）、一次选项工具，再生成角色回复；RP 视图显示 TIME、SCENE、MEMORY 卡片和三个按钮。点击“调查港口”会把保存的 Prompt 作为下一条原生用户消息提交，并产生第二轮模型回复。另一次 World Info 导入验证三条 Entry、两条启用、搜索与逐条编辑。

空白首页验收分别选择 Tavern Chat 与 Agent RP：两者都显示 Prompt Preset、角色卡、Persona、世界书和场景，Tavern 不显示 Experience，Agent 显示五个 Experience 选项，模式标签和应用按钮随选择同步。随后选择真实的 Izumi Harness Preset、卡提希娅、`user` Persona、黎那汐塔世界书和场景文本并应用；Workspace Runtime 建立空白 Session，界面改为 Prompt Stack，完整编排重新读取到相同的模式与五项资源。
