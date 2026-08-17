# 原生 Session Fork 的 RP 分支重写

日期：2026-08-17。状态：已在本地实现。

## 决策

RP Regenerate 不能把上一条用户消息重新发送到原 Session：上一轮可能同时提交时间、NPC、关系、目标、物品和选项，直接重发会让两条互斥世界线共享一个 Ledger。产品使用 DSH 原生 `session.fork`，从目标 Assistant Turn 之前的最后一个已完成 Turn 建立子 Session。首轮没有前一已完成 Turn，因此明确禁用分支重写。

每个 RP Tool 在执行时从 Agent Session 的 `tool/call` Event 找到相同 Call ID，并把 Turn、Step 与 Source Seq 写入 Runtime Effect 和选项来源。子 Session 创建后调用 `rp-studio-fork-adopt`；Host 验证 `session.header.parentSession` 与来源一致、Agent Preset 与来源 RP Mode 一致，并使用 `seedLength` 作为唯一事件切点。Transcript 只保留 Source Seq 和当前 Surface Seq 都在 Seed 内的记录；Ledger 只保留带来源且位于 Seed/Turn 之前的 Effect；切点之后的选项清空。旧的无来源 Effect 在历史分支中保守省略，避免未来状态泄漏。

Client 打开子 Session、提交 Adopt Command，再把目标 Turn 的原用户正文作为新 Prompt 发送。子 Session 继续使用原生 AgentLoop、模型目标、State Keeper 和 Tool Roster。父 Session 不发生产品状态或日志写入。UI 把这项操作命名为“分支重写”，避免承诺同一气泡内轮播的 ST Swipe Array 语义。

## 验证

模型测试创建两轮带 Source Seq 的时间状态和第二轮选项，再以第一轮 Seed Fork；子 Projection 只保留第一轮时间、两个前缀 Transcript 行并清除第二轮状态与选项。Host Command 测试验证原生 Parent、继承 Preset、Binding 和 Transcript Adoption。Tool 测试验证真实 `tool/call` 的 Turn/Step/Seq 进入 Effect。

实际浏览器在 `REV 4` 父 Session 中新增两轮可裁切状态，并对后一轮点击“分支重写”。DSH 生成侧栏子 Session `开始写一个nsfw故事 (1)`，Adopt Command 报告从 Turn 5 结束状态建立分支，Kaon 在子 Session 重放目标用户消息并完成新 Ledger 提交。父 Session 仍为 `REV 4`；子 Session 只继承前一轮新式 Effect，并在重新生成后显示 `REV 2`。父子会话同时保留，Reasoning 与 State Keeper 审计确认仍不进入 RP 正文。
