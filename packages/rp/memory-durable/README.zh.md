# `@dsh-rp/memory-durable`

[English](README.md) | 中文

基于 Harness `ctx.storage.domain` 的持久化 RP 记忆与本地持久向量索引 Provider。Provider 会继承部署为 `dsh_rp_memory` Domain 配置的后端（标准 Web Profile 使用持久 JSON 后端；部署也可把同一契约路由到 SQLite）。

`appendDurable()` 必须等待后端持久化成功，之后才把事实发布到实时 Memory Projection。`hydrate()` 会按 Provider 对一个 Scope 只验证并加载一次。事件 ID 具备冲突安全的幂等语义，Scope 身份包含完整父链。每条持久记录都携带紧凑且预计算的 256 维 signed-FNV 向量；事件恢复时向量同时恢复，并由最高优先级的本地 Retriever 复用。

## 模型体验

通过在 Context 组装前恢复已接受事实的长期陪伴、世界模拟与自适应 Experience 间接产生影响。

#### KV Cache 影响

Hydration 与 Retrieval 只贡献被选中的记忆文本；Storage Provider 本身不增加 Prompt 文本。

## 已知限制与后续工作

- 当前 Retrieval 是本地确定性算法，不是语义 Embedding 推理。第三方 Embedding Provider 可替换 Retriever，而无需改变持久事件的所有权。
- Scope 释放通过 Domain 写链串行删除记录，但后端中途失败时可能留下可重试的剩余子集；它不伪装成跨记录数据库事务。
- 大型部署应增加支持直接 Scope Scan 的索引化 Storage Facet；当前可移植 Domain 实现会过滤已验证的内存表快照。
