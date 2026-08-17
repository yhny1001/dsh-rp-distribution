# @dsh-rp/pipeline-runtime

[English](README.md) | 中文

`ctx.rpPipelines` 把 Turn、Workflow 和 Sidecar 流水线注册并执行为确定性 DAG。`after` 与 `before` 约束会编译为拓扑层级；同一层中的阶段接收相同的不可变帧并并发运行，随后其 JSON 输出按稳定的阶段 id 顺序合并。

编译会拒绝缺失引用、重复阶段和循环。`capture()` 会递归冻结可执行顶层图及其全部嵌套 Pipeline，形成不透明的 `RpPipelinePlan`；依赖项 hash 会进入顶层 SHA-256 身份。即使注册项后来被替换或移除，`runPlan()` 仍会执行 admission 时确定的函数，而 `run()` 会为每次新调用捕获新计划。阶段可声明协作式超时、重试次数，以及致命或继续的失败处理。一次完整运行中每个输出键只能有一个写入者；第二次写入会失败，而不是静默覆盖状态。

可选的同步 observer 会接收顶层与全部嵌套运行的开始、Stage、完成和失败事实。持久消费者可以在审计追加失败时拒绝执行，而不是静默丢失轨迹。运行身份包含 Pipeline 种类、id、随机运行 id，以及精确绑定递归依赖的快照 hash。每个自定义 Stage 还会收到该运行 id 和不可变 Host 元数据对象；嵌套 Pipeline 会保留元数据，而不会把它合并进数据输出。

声明式能力阶段只能获得运行 authority 与阶段上限的交集。嵌套流水线会保留调用方权限、信任、网络与文件 allowlist、Policy 层和剩余预算；图定义不能给自己授予 L1 或 L2 authority。

可安装运行时包只能贡献声明式图。Lifecycle Adapter 会先把每个图注册到这里，再发布匹配的 Catalog 能力；Catalog 调用委派回 `run()`，而不会实现第二套 Pipeline 执行器。自定义函数图不要求 Capability Catalog；`invoke-capability` 只在对应 Stage 执行时解析该服务，并在服务不可用时显式失败。

每个 Pipeline 定义都必须声明实现信任级别和所需权限。这些字段会冻结进内容哈希，并在受约束运行开始前校验，因此低信任图不能藏入更高信任的嵌套图。同时省略信任和权限的调用被明确视为 Host 内部调度；Agent、插件包和远程入口必须通过 Capability Catalog，或显式传入受约束 authority。

## 模型体验

通过调用面向模型的工具、skill、agent 或提示词消费者的阶段间接产生影响。本运行时自身不添加提示词文本或工具 schema。

#### KV Cache 影响

无直接影响。快照哈希允许提示词和 agent 消费者在组装请求前识别图变化。

## 已知限制与延期工作

- **协作式超时**——超时会中止阶段 signal 并拒绝本次运行，但忽略 signal 的 JavaScript 工作可继续到自己的 Promise 结束。
