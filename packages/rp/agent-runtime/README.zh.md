# `@dsh-rp/agent-runtime`

[English](README.md) | 中文

`ctx.rpAgents` 是 RP Agent 角色的 Provider 中立执行边界。注册一个角色会向统一 Capability Catalog 发布一个可执行的 `kind: agent` 贡献；Catalog 仍然是唯一授权路径。授权完成后，Runtime 会确定性地选择角色显式指定的 Provider，或优先级最高的兼容 Provider，并原样转发不可变的有效权限，绝不扩大权限。

角色声明 instructions、作用域、权限、信任等级、预算、Schema 与允许使用的能力类别。Runtime 会复制可变的注册输入，并在发布前把嵌套 Schema 校验为无损、有限 JSON 后深度冻结。Provider 拥有执行过程，可以使用 Harness Subagent、远程 Worker、确定性测试引擎或其他传输。Provider 被移除后会阻止新调用，但不会修改角色定义。角色、Provider 和运行生命周期事件只用于观察；持久化 Agent 记录由实际 Provider 负责，因为只有它知道具体子 Agent 身份。

每个角色和 Provider 注册都是可逆 Cordis Effect。移除角色时会同时移除其 Catalog 条目；卸载 Runtime fiber 会释放全部自有贡献，不使用进程级单例。

## 模型体验

### 可执行角色上下文

#### 模型看到的内容

父模型只能通过 `rp_capability` 等消费者看到角色元数据。只有被选中的 Provider 主动为该次 Agent 运行组合角色 instructions 时，这些指令才会进入子模型请求；Runtime 本身不会增加 prompt 文本。

#### Token 影响

Catalog 发现只会增加由消费者选中的有界角色描述。一次调用只会增加所选 Provider 的子请求，以及返回给调用方的有界结果。

#### KV Cache 影响

角色 Catalog 元数据在注册不变时保持前缀稳定。Provider 选择与进程内生命周期事件本身不会改变模型请求。

## 已知限制与延期工作

- 一次调用消耗一个 Agent 单位。跨 Stage 的聚合 `maxAgents` 计数属于 Pipeline 或 Turn 的预算 Owner，而不是这个 Provider 中立路由器。
- 显式指定的 Provider 缺失时，Runtime 不会静默回退。
