# @dsh-rp/tool-capability

[English](README.md) | 中文

注册面向模型的 `rp_capability` 工具。`action=list` 只返回位于已配置 Agent 信任与权限上限内的可执行能力。`action=invoke` 会把精确 id 与 JSON 输入路由到 `ctx.rpCapabilities`，绝不会直接调用 Provider。

默认配置是 deny-by-default 的 L0，且没有权限、网络域名或文件根。部署可选择授予 L1 `script.execute`；L2 原生 Workflow 需要单独显式授权。配置上限也会作为单 Agent Policy 层传入，因此 Catalog authorizer 与部署或产品 Policy 仍可继续收窄它。

授权会 fail closed，并在执行前审计。工具先追加包含不可变有效 authority 的 `rp/capability-authorized`，再以 completed、failed 或 denied 的 `rp/capability-settled` 配对。RP Projection 与 Studio Timeline 可以在不依赖进程内状态的情况下重建这项决策。

## 模型体验

### 工具 Schema

#### 模型看到的内容

模型会看到已注册的 `rp_capability` Schema。其描述要求先发现再调用，并说明 Policy 交集是最终授权依据。

#### Token 影响

工具可见的每个请求都有固定的 Schema Token 开销。

#### KV Cache 影响

只要定义与可见性不变，前缀就保持稳定。Registry 变化影响 List 结果，而不是 Schema。

### 发现、结果与拒绝

#### 模型看到的内容

`action=list` 返回有界能力元数据。`action=invoke` 返回原始适配器的 JSON 结果。拒绝和失败被规范化为 `Error: <message>`；审计事件属于 Timeline 与回放状态，不会成为额外模型消息。

#### Token 影响

List Token 随已授权实时 Catalog 规模增长。调用 Token 随所选适配器的有界 JSON 结果增长，并保留在调用历史中直到 Compaction。

#### KV Cache 影响

仅追加；新的可见调用结果位于可复用请求前缀之后。

## 已知限制与延期工作

- **通用 JSON 边界**——发现阶段会返回能力专属 Schema，但所选原始适配器仍负责校验其输入。
- **一个部署上限**——更细的用户或 Profile 授权由 Policy 层提供；该工具不会维护第二套权限数据库。
