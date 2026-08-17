# `@dsh-rp/distribution`

[English](README.md) | 中文

可安装的 DSH 外置插件组合包，由 `@dsh-rp/distribution-core` 与 `@dsh-rp/distribution-web` 组成。它会挂载完整 RP 运行时与浏览器 Studio，但不会再把 RP 代码放进 DSH 应用包。

把它安装进普通 DSH Web Profile；插件管理器会把它加入后续组合层，移除依赖时也会同时移除该层：

```sh
dsh plugin --profile web add @dsh-rp/distribution
dsh --profile web
dsh plugin --profile web remove @dsh-rp/distribution
```

Headless 应只安装 `@dsh-rp/distribution-core`，避免 Profile 加载浏览器包。每个插入项仍可被后续 Profile Patch 替换。

## Host 兼容性

这个包使用 DSH 公开的 `dsh.bundle` Manifest 与 Profile 插件生命周期。Core 与 Web 层分别声明 Host Peer，使不受支持的安装在依赖或兼容检查阶段失败。参见 [Host 兼容性参考](../../../docs/compatibility.zh.md)。

发行版内的持久 Memory Provider 会注入 Harness `storageDomain`。标准 Web Profile 已挂载持久后端和 Domain Facility；Headless 部署必须显式挂载并路由这些基础设施插件。

默认组合包会挂载使用 L2 上限的 `rp_capability`，并授予窄化的 `script.execute`、`native.execute`、`rp.pipeline.execute`、`rp.sidecar.start` 与 `agent:spawn` 权限，同时不授予网络或文件根权限。顶层 Agent 因此可以发现并调用有界包 Runtime、第一方 RP Pipeline、可执行 RP 角色模板和按 Owner 隔离的异步 Sidecar。Harness Agent Provider 默认优先 `fork`、回退到 `spawn`，执行深度、超时、取消和 Token 上限，并把具体子 Agent 委派写入父 Session。Sidecar 会立即返回 Harness Job id，继承目标图的权限与预算，并把冻结 Pipeline 的生命周期写入 Journal。由于没有 `workflow.native`，组合包仍不能访问 L2 原生 Workflow Backend，也不能扩大任何 allowlist。

## 模型体验

通过活动 Experience 选中的 RP 与 Harness 插件间接产生影响。

#### KV Cache 影响

组合包本身不增加模型上下文；挂载的消费者负责各自的缓存影响。

## 已知限制与延期工作

- **Host 版本范围**——当前固定的上游 Harness 基线缺少 Studio 使用的部分 Web 提交与 Slot API。发布这个组合包时必须绑定匹配的 DSH 兼容范围；安装过程不能改写 `node_modules`。
