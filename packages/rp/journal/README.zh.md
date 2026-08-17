# @dsh-rp/journal

[English](README.md) | 中文

`ctx.rpJournal` 将 RP 事实写入 Harness `SessionEvent` 日志。事件词汇覆盖组合、上下文、Pipeline、Agent、Capability 授权与结算、状态、分支、记忆、媒体、轮次提交和轮次中止。`RP_JOURNAL_EVENT_TYPES` 向有界导入器和评测消费者公开经过类型完整性检查的必需事件词汇。

每条 Pipeline Stage 事实都携带完整的 Turn、Pipeline id、种类和快照哈希身份。因此，并发或嵌套图可以共享同一 Turn，而回放无需依赖监听器时序。

完整的轮次后状态写入单个 `rp/turn-committed` 事件。这使本地提交在 Session 日志发布点具备原子性：校验或追加失败不会留下部分状态，回放消费者也无需拼接多个独立提交记录来判断轮次是否完成。

## 模型体验

通过渲染持久化 RP 事实的 Projection 和 Prompt 消费者间接影响模型。Journal 本身不增加模型输入。

#### KV Cache 影响

仅追加。消费者可以在已可复用的请求前缀之后追加投影得到的 RP 上下文。

## 已知限制与后续工作

- **不包含外部副作用**——网络、媒体等外部副作用需要 Outbox 或 Saga 插件；本包只保证本地 Session Event 的原子性。
