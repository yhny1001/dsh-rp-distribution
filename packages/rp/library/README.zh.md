# @dsh-rp/library

[English](README.md) | 中文

`ctx.rpLibrary` 持久拥有规范化 Character、Persona 与 Lore 资产，并与进程内领域 Registry 相互独立。每种资产在每个精确 RP Scope 下拥有一份完整有序选择。解析会为每种资产独立选择最近配置，因此 Conversation 可以覆盖 Profile Persona，同时继承 Deployment Lore。`capture()` 只冻结当前选中资产、绑定 Scope 以及一轮 Turn 使用的稳定内容哈希。

删除资产会在同一次持久状态发布中清理全部引用。保存与选择操作会先写入存储，再改变实时视图或发出 `rp/library-changed` 事件。可移植 Storage Domain 后端保证 Web 与 Headless 行为一致。

## 模型体验

由 Turn Pipeline 间接产生影响：它从冻结 Library 快照投影模型安全的 Character 与 Persona 字段，并确定性激活所选 Lore。

#### KV Cache 影响

选择不变时会保持快照哈希和稳定资产顺序。保存已选内容或改变选择会从下一轮起改变身份或 Lore 前缀，但不会修改已 Prepare 的 Turn。

## 已知限制与延期工作

- Library 选择保持显式；自动角色选择与 Profile 继承策略属于 Experience 或产品插件。
- 二进制头像和 CHARX 内嵌资产字节仍由 Media Provider 处理；Library 只保存规范化 IR 与兼容性来源。
