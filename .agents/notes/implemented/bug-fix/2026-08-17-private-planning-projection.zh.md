# 私有规划正文隔离

日期：2026-08-17。状态：已在本地实现。

## 问题

Izumi Preset 的末尾 Assistant Prefill 打开 `<konatan_planning~>`，兼容层已经将该源文本转义并声明为 `private-reasoning`，但 Provider 仍可能把规划写进普通 Assistant Text Block。Prompt 指令无法证明模型永远遵守；RP 对话投影此前只排除原生 Reasoning Block，因此普通 Text Block 中的 `<konatan_planning~>…</konatan_planning~>` 会被当成角色正文，继而进入角色气泡、朗读、编辑和导出。已有 Session 的原始消息也会持续泄漏，除非投影本身拥有确定性规则。

## 决策

新增纯函数 `visibleRoleplayText()`，只识别标签名明确包含 planning、thinking、reasoning、analysis、scratchpad 或 chain-of-thought 的区块。完整区块从开标签移除至同名闭标签；未闭合区块从开标签移除到消息结尾；孤立的同类闭标签也删除。其他结构化标签保持逐字不变。RP 流式气泡和最终 `storyMessages` 都经过该函数，因此朗读、编辑器初始正文、分支输入检查与酒馆导出自然复用同一可见正文。原始 `assistant/message` 不改写，仍保留在 Session 日志中用于审计；升级后重放历史即可立即得到干净投影，无需迁移产品状态。

## 验证

单元测试覆盖完整 Konata planning、多个私有区块、未闭合 analysis、孤立 scratchpad 闭标签和必须保留的 `current_event`。实际 Tarball 安装到一次性 DSH Home 后，Codex 内置浏览器重新打开用户截图对应的历史角色消息，确认 `<konatan_planning~>` 与内部规划消失而闭标签后的角色正文仍保留；同时检查编辑正文、朗读和导出使用同一过滤结果。
