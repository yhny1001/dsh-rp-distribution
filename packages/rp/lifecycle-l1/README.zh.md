# `@dsh-rp/lifecycle-l1`

[English](README.md) | 中文

这是处理 L1 `dsh-rp-runtime-v1` 包的独立生命周期插件。只有包 Manifest 和能力描述符同时申请 `script.execute` 时，它才接受 QuickJS 源码和无导入 WebAssembly 实现。完整性绑定的命名 DAG 注册到 `ctx.rpPipelines`，对应 Catalog 能力保留相同的 L1 权限和信任上限。

调用保留 Capability Catalog 计算出的最小有效权限，并重新路由到唯一 Workflow Router。QuickJS 在没有 Host API 桥接的有界隔离子进程中运行；WebAssembly 在新的有界 Worker 中运行，只接受数字 ABI，并禁止导入。部署可以固定具体后端 id，而无需修改包代码。

## 模型体验

通过被 Agent 或 Pipeline 选择的沙箱能力间接产生影响。

#### KV Cache 影响

全部上下文与缓存影响由能力消费者负责；本适配器自身不增加内容。

## 已知限制与延期工作

- WebAssembly v1 ABI 接受有限数字参数，并返回一个有限数字。
- QuickJS 隔离属于纵深防御进程边界；其安全契约依赖所选受审查后端的不桥接 Host API 和资源限制。
