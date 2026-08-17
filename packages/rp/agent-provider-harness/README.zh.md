# `@dsh-rp/agent-provider-harness`

[English](README.md) | 中文

该插件把 Provider 中立的 `ctx.rpAgents` 角色绑定到 Harness Agent/Subagent Runtime。它要求存在活动的 Harness 发起 Agent，并按配置顺序选择第一个存活且支持 persona 与深度限制的 Subagent Provider，然后启动一个由调用方拥有的子运行。默认优先 `fork`，使角色可以继承已完成的会话历史；`spawn` 是显式的新上下文回退。

Provider 把角色 instructions 作为子 Agent 的作用域 persona，并把分离后的 JSON 输入作为一条带身份的 prompt 发送。有效 `maxTokens`、超时、取消和部署深度上限都会被执行，同时不会把 Cordis Context 暴露给角色包。每个已接受子 Agent 都会在结束后释放。完成输出会被规范化为 JSON；非 completed 的停止原因会使 Capability 调用失败，不会伪装成成功。

父 Session 会写入配对的 `rp/agent-started`、`rp/agent-delegated` 与 `rp/agent-completed` 或 `rp/agent-interrupted` 事实，其中包含具体子 Agent id、角色、父 Agent、RP Provider、Harness transport 与停止原因。开始事实包含精确的分离模型输入，完成事实包含规范化输出，因此无需进程级单例或第二套 Agent Registry 即可审计模型边界。

## 模型体验

### Harness 子请求

#### 模型看到的内容

被选中的子 Agent 会在 persona 中看到角色 instructions，并收到一个包含角色 id、作用域、能力类别与 JSON 输入的请求信封。父 Agent 只会看到通过 `rp_capability` 或调用 Pipeline 返回的有界子 Agent 结果。

#### Token 影响

每次调用都会创建一个有界子请求，其可变成本来自分离后的 JSON 输入和角色 instructions，随后向父 Agent 返回一个有界的规范化结果。不会进入模型的 RP 生命周期事件不增加请求 token。

#### KV Cache 影响

每个子 Agent 拥有自己的请求前缀。Harness Provider 允许时，fork 会复用父会话已平衡的完整 Turn 历史；spawn 使用全新前缀。父历史只会增加普通 Capability 结果和不会进入模型的持久化 RP 事件。

## 已知限制与延期工作

- 调用要求存在存活的 Harness 发起 Agent；无 Agent 的 Headless 调用方必须使用另一个显式认证的 Provider，不能伪造父身份。
- 跨进程远程 Provider 继续作为 `ctx.rpAgents` 后面的独立插件实现。
