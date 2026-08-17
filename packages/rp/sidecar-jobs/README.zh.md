# `@dsh-rp/sidecar-jobs`

[English](README.md) | 中文

`ctx.rpSidecars` 会把每条已注册的 `kind: sidecar` RP Pipeline 转换为统一 Capability Catalog 中独立、可执行的 `sidecar:<pipeline-id>` 贡献。每个贡献都会保留目标图的信任等级、权限、预算和版本，额外要求显式的 `rp.sidecar.start` 权限，并在不等待 DAG 的情况下返回已接受的 Harness Job 身份。

Job 由精确的 Harness 发起 Agent 持有。适配器会立即启动递归冻结的 Pipeline 计划，原样转发 Catalog 计算出的有效权限和预算而不扩大权限，关联调用方取消与 Job 取消，并限制保留输出的 UTF-8 字节数。其 observer 会在 Owner 的 Session 中记录顶层 Sidecar 及全部嵌套 Pipeline 的精确开始、Stage 和终态事实。Harness Jobs 继续提供标准的 Owner 隔离、等待、读取、通知和终止行为。

Sidecar Capability 注册可逆，并跟随 Pipeline 热更新。插件卸载时会先撤销所有已发布能力，再请求取消它启动的全部工作，并在配置的协作式宽限时间内将其排空。非协作 Stage 会使卸载明确失败，而不是静默遗留 Job。

## 模型体验

### 异步 Sidecar 能力与 Job 结果

#### 模型看到的内容

模型可以通过 `rp_capability` 为每条存活的 Sidecar 图发现一个有界 `sidecar:<pipeline-id>` 描述。成功启动后会返回 Job id、Pipeline id、冻结的 Snapshot hash、关联 Turn id 和 `accepted` 状态。之后由普通 Harness Job 控制能力提供状态、有界最终输出和取消操作。

#### Token 影响

发现过程会增加被选中的 Sidecar 描述。启动只增加一条很小的接受结果；完成输出取决于数据，并会在 Job Controller 添加状态元数据前受 `outputLimitBytes` 限制。

#### KV Cache 影响

只要 Pipeline 版本和图不变，描述就保持前缀稳定。接受结果与 Job 结果都是只追加后缀；Pipeline 热更新只会改变该 Sidecar 未来的描述与 Snapshot hash。

## 已知限制与延期工作

- **协作式取消**——原生 Pipeline Stage 必须观察传入的 `AbortSignal`；适配器无法强制终止任意同进程代码。
- **进程本地 Job Registry**——默认 Harness Jobs 后端不会在进程崩溃后恢复运行中的 Sidecar；持久化重启所有权需要独立的 Jobs Provider。
