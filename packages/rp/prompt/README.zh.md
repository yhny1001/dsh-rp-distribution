# @dsh-rp/prompt

[English](README.md) | 中文

`ctx.rpPrompt` 使用显式 before/after 约束与确定性的优先级规则组合唯一所有者的 Prompt Section。依赖缺失和循环会明确失败。

## 模型体验

通过把已组合段落放入模型请求的 Agent 消费者间接产生影响。

#### KV Cache 影响

稳定的 Section ID 与顺序使可复用前缀保持明确。

## 已知限制与延期工作

- 感知 Token 的裁剪属于独立的上下文预算策略插件。
