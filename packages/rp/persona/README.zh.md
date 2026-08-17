# @dsh-rp/persona

[English](README.md) | 中文

`ctx.rpPersonas` 在精确生命周期作用域中保存与调用方分离的 `PersonaIR` 资产。`context()` 仅暴露有界的标识符、名称和描述；UI 消费者仍可通过 `get()` 与 `list()` 读取兼容信封和扩展字段，但这些字段不会进入模型视图。

## 模型体验

由第一方或第三方 Prompt 消费者显式选择安全 Persona 上下文视图，从而间接影响模型体验。

#### KV Cache 影响

Persona 上下文在冻结的单轮快照内保持稳定；按标识符确定性排序，避免注册顺序造成缓存抖动。

## 已知限制与延期工作

- 当前仅执行精确作用域选择；从 Profile 激活到会话的策略由 Experience 或 UI 插件负责。
- 注册多个 Persona 时，运行时不会擅自推断唯一的当前 Persona。
