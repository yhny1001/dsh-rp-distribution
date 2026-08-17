# @dsh-rp/workflow-router

[English](README.md) | 中文

为可替换的确定性、Worker Thread、隔离进程、QuickJS、WASM 和远程 RP 工作流后端提供受策略约束的路由。后端都是可逆插件；选择过程确定性，并且每次运行都具备取消、超时、信任等级和审计事件。除非请求携带不低于目标后端的有效信任授权，否则 Router 永远不会选择 L0 以上后端。

内置的确定性后端执行有界声明式表达式语言，绝不求值 JavaScript。发行版还通过 `@dsh-rp/workflow-backends-local` 挂载 L0 Worker Thread 和清空环境变量的独立进程 Provider，并通过 `@dsh-rp/workflow-backends-sandbox` 挂载独立检查权限的 L1 QuickJS 与无导入 WASM Provider；Worker Thread 只提供执行隔离，不是安全沙箱。

## 模型体验

通过被选择的 Workflow 后端及其 Agent 消费者间接产生影响。

#### KV Cache 影响

Router 不贡献 Prompt 文本；被选择的后端拥有任何模型请求和缓存行为。

## 已知限制与延期工作

- 发行版已包含本地故障收容与 L1 语言沙箱；远程 Worker 和强化的操作系统策略沙箱仍是独立安装的 Provider。
