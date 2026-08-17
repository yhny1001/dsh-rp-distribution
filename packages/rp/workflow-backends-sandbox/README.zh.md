# `@dsh-rp/workflow-backends-sandbox`

[English](README.md) | 中文

面向 `ctx.rpWorkflowRouter` 的 L1 执行 Provider。安装本插件不会自动授予执行权：每次调用都必须同时拥有有效 L1 信任等级与 `script.execute` 权限。

WebAssembly 后端接收带版本的 base64 模块信封和刻意收窄的数值 ABI。它拒绝 import、start section、无上限或超限的内存/表、超大模块、非有限参数和非有限结果。每次调用都在全新且可强制终止的 Worker 中运行。WebAssembly 的无导入边界移除了环境 Host 能力；Worker 额外提供取消和故障收容，但 Worker 本身不被宣称为安全沙箱。

QuickJS 后端在全新的 Node 子进程中求值一个生成 JSON 的表达式。VM 只获得深度冻结的 JSON 输入，不桥接 Node、文件系统、网络、时钟、随机数、WebAssembly 或 Host 回调。QuickJS 堆、栈、源码、输入、输出和执行时间都有硬限制；不合作的任务会被父进程终止。

## 模型体验

通过把受控脚本或可移植规则模块显式路由给这些 Provider 的 Experience 与 Agent 间接产生影响。

#### KV Cache 影响

本包不贡献 Prompt 文本。调用模型的工作流自行负责其缓存行为。

## 已知限制与后续工作

- QuickJS 依赖仍是 1.0 前版本，而且上游明确说明尚未经过正式安全审计；进程隔离、严格能力缺省、硬限制、签名与包策略仍须作为纵深防御。
- WebAssembly ABI 当前只接受有限数值参数并返回一个有限数值。结构化值需要未来经过审计的规范内存 ABI，而不是增加环境 import。
- 两个后端都不授予网络、文件、Secret、子进程、模型调用或 Host Tool；这些能力必须由独立显式 Provider 和策略提供。
