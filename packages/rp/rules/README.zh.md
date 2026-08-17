# `@dsh-rp/rules`

[English](README.md) | 中文

可替换的规则引擎 Registry，支持取消、可逆 Provider 注册，并内置有边界的种子骰子引擎，使结果可以精确回放。

## 模型体验

通过调用 `rp.rules.evaluate` 并渲染其结构化结果的已授权 Agent 或 Pipeline 间接体现。

#### KV Cache 影响

规则结果只通过调用它的 Agent 或 Pipeline 进入上下文；重复的稳定结果可以保留周边提示词前缀。

## 已知限制与延期工作

- 种子骰子用于可复现模拟，不是可验证的公开随机源。特定系统的战斗、物品栏和角色卡规则引擎仍由独立 Provider 提供。
