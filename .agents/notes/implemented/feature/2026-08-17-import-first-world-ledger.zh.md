# 导入即用与世界 Ledger

日期：2026-08-17。状态：已在本地实现。

## 决策

真实 RP 用户通常带着角色卡、Preset、Persona 与世界书进入产品，而不是带着一套 Harness 编排知识。`@dsh-rp/product` 因此把导入资源视为产品输入，并从最近导入内容生成完整推荐组合：优先 Harness 适配 Preset，其次原始 ST Preset；角色、Persona 与世界书各取最近导入项；开局场景取 Character Card Scenario，再回退到世界概览。新会话仍允许展开高级字段，但默认只显示已经组装好的角色、模式与资源摘要。

导入结果提供 Tavern Chat 与 Agent RP 两个直接开始动作。动作只调用 DSH Client 的 Workspace、Session 与 Agent Preset 服务：取得或创建空白 Session，选择 `rp-tavern`/`rp-agent`，再提交既有 `rp-studio-bind` Command。插件不创建第二套 Session、聊天服务、模型循环或 Workspace 实现。

参考设计中的 Actor 由 DSH 原生 AgentLoop、Prompt Assembly 与流式 LLM 调用承担；插件拥有 Scenario Profile 和 World Ledger。Agent RP 把一轮变化通过 `rp_commit_turn` 原子写成 N→N+1：一次 Tool Call 最多提交 32 条世界、时间、场景、角色、Persona、NPC、关系、记忆、目标或物品变化，并可同时替换 0–8 个选项。每条 `data.key` 或 `data.target` 是跨轮状态身份，当前 Projection 按键 Last-write-wins；至多 500 条历史 Effect 继续保留为审计履历。`rp_read_state` 只读当前 Projection，旧的单条状态与独立选项工具继续兼容分步调用。

角色对话页以当前状态而不是工具流水为主视图：最多十二个状态单元显示类型、标题与摘要，Revision 标识原子提交次数，折叠履历显示最近二十条原始 Effect，选项仍可直接送入同一个 Agent Session。Reasoning Block 从角色正文投影中排除；Agent Prompt 要求先调用 Ledger Tool，再只输出一条最终角色回复。

Experience 拥有独立运行说明。World Simulation 强化时间、NPC 与目标推进；Multi-character 使用 `rp_schedule_cast` 与 `rp_next_speaker` 管理跨 Turn 队列，并保留 `rp_select_speaker` 作为手动覆盖；TRPG 的 `rp_roll` 验证并执行至多 20 个、每个至多 1000 面的 `NdM±K` 骰式，结果由原生 Tool Result 记录；Companion 强化关系、记忆、Persona 与角色连续性，不要求每轮选项。它们仍是同一个 `rp-agent` 内的插件 Tool 与 Prompt Policy，不拆出第二套 AgentLoop。

State Keeper 通过已有事件扩展实现，不修改 AgentLoop。`agent/inbox/claimed` 为每个 Turn 保存第一次输入对应的 Runtime Revision；`agent/turn-stopping` 比较当前 Revision，未推进时用来源为 `@dsh-rp/product`、Form 为 `instructions` 的 Steering 要求 `rp_commit_turn` 补交。无变化 Turn 允许 `updates: []`，同样推进 Revision。最多两次 Repair；第三次仍未推进则抛错让 Turn 失败关闭。成功、失败或异常缺少 Baseline 时都会清理逐 Turn 状态，内部 Steering 不投影为角色消息。

## 验证

聚焦测试证明推荐器从混合导入中选择 Harness 适配 Preset、导入角色与 Character Card Scenario；原子提交一次写入时间、场景、NPC 和选项，下一轮用相同稳定键推进时间后，当前 Projection 只保留新时间而履历保留两次提交；`rp_read_state` 的只读结果与写入 Projection 一致。

工具测试还验证 `rp_select_speaker` 接受阵容内角色并拒绝阵容外 ID，`rp_roll` 的 `2d6+3` 结果始终位于 5–15。Agent RP Tool Roster 共有八项：原子提交、单条补交、独立选项、队列安排、队首消费、手动说话者、骰子与只读状态。

State Keeper 测试覆盖缺失提交时第一次 Steering、空更新提交后正常关闭，以及连续两次 Repair 仍无提交时第三次 Fail-closed；测试同时确认审计消息属于 Plugin Instructions，而不是 Persona 用户输入。

实际 Kaon 无变化轮次要求只说“晚安”且不提供选项。模型第一步漏交并先生成“晚安。”，Turn-stop State Keeper 自动 Steering，第二步以 `updates: []` 完成审计，Ledger 从 `REV 1` 进入 `REV 2`。角色对话按 Turn 只投影第一条非空 Assistant 正文：内部审计 Steering、补交确认“本轮无变化，已提交审计。”和 Reasoning 均不可见，用户只看到“晚安。”。

实际 Tarball 安装到隔离 DSH Web Profile 后，Kaon `deepseek-v4-flash-0731` 在真实 Izumi Harness Preset、卡提希娅、`user` Persona 与黎那汐塔世界书上调用 `rp_commit_turn`。一次调用原子提交“时间推进十分钟”和“警钟封锁栈桥”，同时生成三个选项；RP 视图显示 `WORLD LEDGER`、`REV 1`、两个当前状态、两条履历与三个可点击按钮，Reasoning 不再出现在角色正文。新会话页自动推荐相同真实资源并折叠所有高级字段；导入页在重载后仍识别现有导入资源，“直接开始 Agent RP”一次点击便取得空白 Session、关闭创作室、绑定推荐组合并显示紧凑已选状态。
