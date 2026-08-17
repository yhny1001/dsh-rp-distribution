# `@dsh-rp/first-party`

[English](README.md) | 中文

该插件安装第一方组件元数据、可执行角色模板、Turn/Workflow/Sidecar DAG，以及九个 Experience Profile。它不拥有特权执行路径：角色模板通过 Provider 中立的 `ctx.rpAgents` 注册，Agent Provider、领域插件和部署策略仍然都是可替换注册项。

默认 `rp-adaptive` Experience 允许顶层 Actor 使用 Tool、Skill、Subagent 和 Pipeline 能力类别。第一方 Turn 图声明 L2 信任以及 `rp.pipeline.execute` 与 `agent:spawn` 权限；它们会组装有界身份、Lore、Memory、场景、关系、Prompt 和能力上下文，通过统一 Capability Catalog 调用 `rp.agent.actor`，再把 Provider 结果适配成 `turn.effects`。Workflow 与 Sidecar 图通过同一边界路由 Director、Actor、Critic、Scheduler、Character、World、Narrator、Creator、Reviewer、State Keeper 和 Memory Curator Stage。多角色与世界模拟图会并行 fan-out 独立 Agent Stage，并在继续前 join 分离的 JSON 结果。

Turn 图会从冻结的 Event Log 作用域 Projection 读取有界的对话历史、状态、记忆、场景、关系与分支。Turn 快照包含当前 Prompt 预设时，所选配置中启用的顺序会替代通用的身份、Lore、Prompt 与历史章节装配。Character、Persona、Lore 和历史 Marker 从同一份冻结上下文解析；没有值的 Marker 槽不会作为空模型消息发送，但其身份仍保留在可审计的预设快照中。`{{char}}`、`{{charIfNotGroup}}` 与 `{{user}}` 等 Prompt 宏也在这一边界解析。没有当前预设时，既有通用装配保持不变。

Turn 图绝不会让过期的进程内领域 Store 覆盖已提交的 Session 事实。需要显式写入外部持久记忆时，仍可使用受权限约束的 `rp.memory.append` 能力。`rp-fast` 每轮仍只调用一个 Actor Provider，因此无需 Director、Critic 或 Sidecar 工作即可保留一次生成调用约定。其他 Profile 会选择 Directed、多角色、世界模拟、TRPG、Companion、Creator 或 Premium 组合。

## 模型体验

通过 Experience 选中的 Agent 和 Pipeline 消费者间接产生影响。只有选中的 Agent Provider 组合具体子请求时，角色 instructions 才会进入模型上下文。

#### KV Cache 影响

第一方 id 和图哈希保持稳定。选择不同 Experience 可能改变下游 Prompt 和 Tool 装配。

## 已知限制与延期工作

- **需要 Provider**——本包有意不自行执行模型调用。部署必须注册兼容的 `ctx.rpAgents` Provider；发行版提供 Harness Subagent Provider，远程 Provider 可以替换它。
