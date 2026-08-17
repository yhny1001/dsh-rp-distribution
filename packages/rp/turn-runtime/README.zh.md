# @dsh-rp/turn-runtime

[English](README.md) | 中文

Prepare 还会把权威 Event Log 折叠为作用域专属的 `RpTurnContextSnapshot`，将调用方提供的上下文单独命名，并把两者冻结进草稿与 Pipeline 元数据。每个 prepare 边界都会延迟解析可选的 `ctx.rpPresets` 服务，并把最近的当前预设捕获为不可变的内容寻址快照。这样既保持加载顺序可替换，也保证激活或热更新只从下一轮开始生效。精确的预设快照会写入 `rp/context-activated`。状态补丁必须同时提供完整结果文档，并以捕获的所有者修订号校验；关系修订号和重复记忆也会在提交前对照同一事件边界检查。

`ctx.rpTurn` 协调 `prepare → execute → validate → commit` 与 `abort`。`run()` 拥有完整事务，并在执行或验证失败时自动记录 abort。Prepare 在任何 Stage 运行前解析组件组合，并捕获命名 Turn Pipeline 及其全部嵌套图的可执行计划。注册项热替换或移除后，Execute 仍使用该精确计划，并拒绝递归绑定后的快照 hash 与 prepare 阶段快照不同的结果。

服务会在自身 Cordis Injection 激活时捕获 Component、Pipeline、Projection 与 Journal 依赖。因此，受限 Consumer 插件或持有 HTTP Handler 的调用仍然有效；调用方追踪不能替换运行时私有依赖授权。

Turn 的 Session 会先在版本化 `rp/context-activated` 数据中接收精确输入与 Host 上下文，再通过运行时 observer 接收 `rp/pipeline-started`、`rp/pipeline-stage` 和 Pipeline 终态事实。嵌套图在同一个 Turn 关联 id 下保留各自的种类、id 与快照 hash，因此重放不需要根据时序推断 Stage 归属。

常规 Turn Pipeline 会在 `turn.effects` 发布一个 JSON 对象；运行时负责解码并验证其中的 assistant 消息、状态、记忆、关系、场景、分支、用量和元数据。直接向 `execute()` 提供 effects 仍是兼容路径，供适配器从原先由调用方持有的输出边界迁移。

Commit 在单个 `rp/turn-committed` 会话事件中保存 assistant 输出、状态、记忆、关系、场景、分支、轨迹与快照身份。Abort 只写入 `rp/turn-aborted`；同一实时事务一旦进入任一终态，就不能再进入另一终态。

## 模型体验

通过选定 Turn Pipeline 间接产生影响。此协调器不添加提示词文本或 schema。

#### KV Cache 影响

无直接影响。冻结的组合与流水线哈希允许面向模型的消费者判断已装配前缀是否仍可复用。

## 已知限制与延期工作

- **实时事务所有权**——prepare 后的事务在提交或中止前仅存在于进程内；崩溃会留下没有 RP 终态提交的持久 prepare 诊断，恢复策略可以追加 abort。
