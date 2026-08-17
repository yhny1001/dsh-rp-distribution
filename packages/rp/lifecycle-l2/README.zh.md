# `@dsh-rp/lifecycle-l2`

[English](README.md) | 中文

这是处理显式可信原生 `dsh-rp-runtime-v1` 包的独立生命周期插件。激活必须同时具备完整性绑定载荷、Registry 信任的签名、哈希绑定 SBOM，以及 Manifest 和每个可执行能力描述符中的 `native.execute`。签名命名 DAG 注册到 `ctx.rpPipelines`；对应 Catalog 条目委派给该图，安装期间不会求值原生代码。

原生源码文件必须求值为一个函数：`(input, effectiveAuthority, signal) => JsonValue | Promise<JsonValue>`。适配器不会向包代码暴露 Cordis Context 或注册 API；它验证并限制 JSON 输出，转发取消信号，并应用部署超时上限。安装准备只编译语法，不会求值包表达式。

L2 是可信原生代码，不是安全沙箱。它在 Host 进程中运行，可以访问环境 Node 全局对象。只应安装来自已审查发布者、且签名密钥被显式信任的包。

## 模型体验

通过被 Agent 或 Pipeline 选择的可信原生能力间接产生影响。

#### KV Cache 影响

全部上下文与缓存影响由能力消费者负责；本适配器自身不增加内容。

## 已知限制与延期工作

- 与所有进程内 JavaScript 一样，同步且永不终止的原生代码无法被异步超时抢占；不可信或仅半可信代码必须使用 L1。
- 进程内无法保证原生网络与文件系统权限的强制执行。Manifest 权限会传给协作式适配器并用于审计，而真正隔离需要独立进程 Provider。
