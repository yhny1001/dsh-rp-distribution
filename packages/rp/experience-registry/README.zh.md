# @dsh-rp/experience-registry

[English](README.md) | 中文

`ctx.rpExperiences` 拥有动态、不可变的 Experience manifest。顶层 agent 可提供 `agentChoice`；显式用户选择优先级更高，而任务提示在第一方 profile 之间提供确定性回退。

选择受可选调用方 allowlist 限制。策略不会静默替换被拒绝或缺失的 Experience。

## 模型体验

通过返回的 Experience 所选择的 agent、流水线和组件间接产生影响。

#### KV Cache 影响

切换 Experience 可能改变提示词、工具和 agent 拓扑；消费方轮次在组装请求前冻结选定组合。

## 已知限制与延期工作

- **策略输入显式化**——任务分类由顶层 agent 或产品调用方执行，本包不会隐式发起第二次模型调用。
