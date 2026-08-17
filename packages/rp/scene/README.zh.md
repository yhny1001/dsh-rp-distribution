# `@dsh-rp/scene`

[English](README.md) | 中文

按所有者 Scope 隔离的活动场景 Projection，提供完整替换、乐观修订号、参与者校验和不可变 Snapshot。

## 模型体验

通过把当前场景选入模型上下文的 Agent 或 Prompt 消费方间接体现。

#### KV Cache 影响

该服务不添加提示词文本；消费方拥有场景渲染与缓存位置。

## 已知限制与延期工作

- 活动 Projection 由 Session 消费方重建；本包有意不拥有持久化介质或模型可见渲染。
