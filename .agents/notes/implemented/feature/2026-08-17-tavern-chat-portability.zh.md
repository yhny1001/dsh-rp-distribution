# 酒馆聊天历史迁移

日期：2026-08-17。状态：已在本地实现。

## 决策

聊天迁移属于 RP 产品插件，而不是 DSH Session 格式兼容。Client 解析 SillyTavern JSONL 或 JSON 数组，跳过 Metadata、空行与 `is_system` 记录，并把 `name`、`is_user` 与 `mes` 转成有界的角色/Persona 消息。Host Command 在接收完整批次后再次验证角色、说话者和正文限制，再以一次产品状态修订和一组 append-only Session Event 提交。

DSH 不允许插件在空闲阶段伪造 `assistant/message`。导入角色历史因此使用 user-role `plugin/recall`，正文由 `<rp-assistant-history>` 明确声明为已经发生的角色历史；Persona 历史使用 `plugin/notice`。RP Transcript 同时保存原角色语义、说话者与正文，所以 UI 仍显示角色和 Persona，而下一轮模型不会把角色历史误认成当前真人指令。Store 在原子 rename 成功后立即发布同步缓存，保证同一毫秒内的 Prompt Assembly 与 State Keeper 读到导入后的 Revision。

导出只使用当前 RP Surface 可见正文，首行写入 ST 用户名、角色名和产品来源，后续每行写入 `name`、`is_user`、`is_system:false`、`mes` 与时间；`extra` 附带 DSH Source Seq 和编辑 Revision。原始不可变日志、被当前 Surface 替换的旧正文、Tool/Reasoning 与内部 State Keeper Steering 不进入导出。

## 限制

单文件限制 4 MiB，单批 1–500 条，每条最多 32000 字符，总正文最多 1000000 字符。System 行不进入 Transcript，因为系统规则、Preset、世界书与场景由产品资源层独立维护。当前实现不导入 ST Swipe 数组，也不把导出文件视为 DSH Session 的可恢复备份。

## 验证

纯兼容测试解析包含 Metadata、System、角色与用户行的 JSONL，确认前两类被跳过，并把可见消息重新序列化为标准 JSONL。模型测试把两条记录导入既有 Binding，验证角色 ID、Persona ID、说话者、正文、Seq 和 Synthetic 标记。Host Command 测试验证 Session Event 分别使用 `recall` 与 `notice`，Store Transcript 保留原 Role。实际浏览器显示“导入聊天 / 导出聊天”入口，并下载包含 1 行 Metadata、4 条 Persona 与 3 条角色消息的 8 行 JSONL；Metadata 的角色为卡提希娅、用户为 `user`、来源为 `@dsh-rp/product`，每条消息都有 `mes` 和 DSH Source Seq。
