# @dsh-rp/memory-basic

[English](README.md) | 中文

`searchEvents()` 会把选定 Retriever 应用于调用方提供的不可变 Event Log Projection，而不会把这些事实插入进程内记忆。Turn Pipeline 使用此路径，让重放成为权威来源，同时保持检索算法可替换。

`ctx.rpMemory` 是带容量边界、识别完整父链的规范记忆 Projection，同时提供幂等追加、可逆 Retriever Registry 和可逆 Durable Store Registry。内置词法 Provider 是零基础设施回退。`hydrate()`、`appendDurable()` 与 `releaseDurable()` 会把 IO 路由给被选中的 Store，同时保留同一套实时 Search API；持久写入失败时不会发布半成品实时状态。

## 模型体验

通过为模型请求选择已检索事实的 Prompt 消费者间接产生影响。

#### KV Cache 影响

召回事实会改变动态 Prompt 后缀；稳定事实保持确定性顺序。

## 已知限制与延期工作

- 普通 `append()` 仍是显式的进程内兼容路径；安装 Store 后，生产 Experience 使用持久 API。
- 持久压缩与外部语义嵌入属于声明权限的 Sidecar 和检索 Provider 插件。
