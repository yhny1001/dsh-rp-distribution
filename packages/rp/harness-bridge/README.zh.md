# @dsh-rp/harness-bridge

[English](README.md) | 中文

此插件把实时 Harness 工具 schema、模型可调用 skill、subagent 提供方、RP 流水线和 Workflow Backend 映射到 `ctx.rpCapabilities`。工具和 subagent 条目保持仅发现状态，因为其原生执行需要拥有方 agent；skill、流水线与 Workflow Backend 条目把调用委派回各自原生注册表。

每个 Workflow Backend 都有独立能力 id 和其声明的 L0/L1/L2 信任等级。L1 执行要求 `script.execute`，L2 执行要求 `workflow.native`。桥接只转发目录求得的有效 authority 与预算，因此发现能力不会变成另一条权限通道。

每条 RP Pipeline 都使用定义自身声明的信任级别和权限进行镜像，而不是继承桥接器的环境默认值。因此 Catalog 授权与 Pipeline Runtime 会在任何 Stage 开始前校验同一份合同。

原生注册表发生变化时，所有映射注册都会被替换；桥接卸载时则全部撤回。桥接不会复制提供方状态，也不会实现第二条权限路径。

## 模型体验

通过渲染统一目录的消费者间接产生影响。原生工具和 skill 消费者继续拥有既有提示词文本与 schema。

#### KV Cache 影响

目录变化可能改变下游发现文本。桥接本身不装配模型请求。

## 已知限制与延期工作

- **需要 agent 执行**——工具和 subagent 条目仅用于发现；拥有方 Harness agent 及其原生工具会携带调用方身份和权限状态执行它们。
