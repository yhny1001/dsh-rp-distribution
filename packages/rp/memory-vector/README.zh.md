# `@dsh-rp/memory-vector`

[English](README.md) | 中文

`ctx.rpMemory` 的可逆本地向量检索 Provider。它使用确定性的 256 维带符号词元哈希，不需要模型或网络调用，并在安装期间成为首选检索器。

## 模型体验

通过把该 Provider 排序后的记忆命中项选入模型上下文的 Prompt 或 Agent 消费方间接体现。

#### KV Cache 影响

该 Provider 不添加提示词文本；消费方拥有命中项渲染与缓存位置。

## 已知限制与延期工作

- 哈希向量改进了确定性排序与替换机制，但不是语义嵌入模型。外部嵌入和持久向量数据库实现仍是独立 Provider，并需要显式网络与存储权限。
