# @dsh-rp/state

[English](README.md) | 中文

`ctx.rpState` 按 RP 作用域保存彼此隔离的所有者状态文档，并基于精确的基础修订号应用 RFC 6901 风格的 JSON Pointer 补丁。补丁先在副本上完整执行，所有操作成功后才一次性可见。

## 模型体验

通过为模型请求选择已提交状态字段的 Prompt 消费者间接产生影响。

#### KV Cache 影响

无直接影响。由 Prompt 插件决定多少已提交状态进入模型前缀。

## 已知限制与延期工作

- 持久化由 Journal Projection 提供；本服务只负责实时的作用域投影。
