# `@dsh-rp/workflow-backends-local`

[English](README.md) | 中文

`ctx.rpWorkflowRouter` 的本地执行 Provider。每次运行使用全新的 Worker Thread 或清空环境变量的 Node 子进程，并且只求值 Router 提供的有边界声明式表达式语言。

## 模型体验

通过选择非默认工作流后端的 Experience 或 Agent 间接体现。

#### KV Cache 影响

该后端不贡献提示词文本；工作流消费方拥有所有模型请求和缓存行为。

## 已知限制与延期工作

- Worker Thread 只是执行隔离，不是安全沙箱。独立进程 Provider 会移除环境变量且不接受用户程序文本，但仍不是操作系统策略沙箱。QuickJS、WASM、远程 Worker 和强化的平台沙箱仍由独立 Provider 实现。
