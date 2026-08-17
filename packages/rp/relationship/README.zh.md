# `@dsh-rp/relationship`

[English](README.md) | 中文

按所有者 Scope 隔离的有向关系图，提供乐观修订号、确定性列表、有界维度和不可变备注。

## 模型体验

通过把关系状态选入模型上下文的 Agent 或 Prompt 消费方间接体现。

#### KV Cache 影响

该服务不添加提示词文本；消费方拥有关系渲染与缓存位置。

## 已知限制与延期工作

- 关系推断和持久回放仍由独立 Sidecar 与 Session 消费方实现；本包只拥有经过校验的活动 Projection。
