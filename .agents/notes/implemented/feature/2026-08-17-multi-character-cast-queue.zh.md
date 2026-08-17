# Multi-character 持久发言队列

日期：2026-08-17。状态：已在本地实现。

## 决策

一个 DSH Assistant Message 应只有一个可审计说话者；在同一 Message 中拼接多名角色会破坏 Transcript 署名、编辑和 Fork。Multi-character 因此采用跨 Turn Cast Queue：`rp_schedule_cast` 以 1–16 个不重复 Character ID 建立有序队列，所有成员必须属于 Session Binding 的角色阵容；`rp_next_speaker` 只消费队首，更新真实 `primaryCharacterId` 并记录上一位说话者。每个 DSH Turn 仍只输出一位角色的一条最终正文。

选择 Multi-character Experience 时，Client 自动把当前已选角色和最近导入角色合并成最多 16 人阵容；少于两人时 Binding 加载即失败。Queue、Round、Last Speaker 与来源 Turn/Step/Seq 存在 Runtime Projection 中。删除角色会同步从队列清除；Native Fork 只复制 Seed 内最后一次队列状态，未来调度不会泄漏进分支。`rp_select_speaker` 保留为用户或模型明确要求跳过队列时的手动覆盖。

角色对话页显示 `GROUP TURN`、Round、刚刚发言者、下一位和剩余队列；头像和名称来自 Character Profile。队首 Tool 在最终回复前修改 Binding，所以 Session Event Observer 为新 Assistant Message 记录的就是实际角色，而不是 UI 猜测。

## 验证

模型测试验证队列重复、阵容外角色和空队列被拒绝，秦雾→林遥依次消费后 Primary Character、剩余队列和 Last Speaker 正确；Tool 测试验证安排、消费与 `rp_read_state` 输出；Fork 测试验证 Seed 以前的 Queue 保留。真实浏览器选择 Multi-character 后自动形成卡提希娅、洛弥、沈灯三人阵容。Kaon 第一轮安排同序队列并消费卡提希娅，第二轮不重排而消费洛弥，第三轮消费沈灯；三条 Transcript 分别署名，UI 最终显示 `ROUND 1`、`刚刚 · 沈灯` 和“本轮队列已完成”。
