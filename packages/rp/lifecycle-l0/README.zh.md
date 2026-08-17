# `@dsh-rp/lifecycle-l0`

[English](README.md) | 中文

这是处理 `dsh-rp-runtime-v1` L0 声明式包的独立生命周期插件。它发布经过完整性绑定的 Component、命名 Pipeline 和 Capability 声明，并把可选表达式实现路由到内置的有界确定性工作流后端。Pipeline 能力通过 `ctx.rpPipelines` 委派给已注册 DAG。

L0 包表达式只接收调用的 JSON 输入，不拥有脚本运行时、Host 对象、网络、文件系统、Secret 或任何环境原生权限。只用于发现的能力不提供实现。

## 模型体验

通过被 Agent 或 Pipeline 选择的声明式能力间接产生影响。

#### KV Cache 影响

全部上下文与缓存影响由能力消费者负责；本适配器自身不增加内容。

## 已知限制与延期工作

- v1 表达式语言有意只包含 input、get、object、array 和条件组合。
- 更丰富的声明式转换必须以经过审查的新操作或新兼容版本扩展确定性后端。
