# `@dsh-rp/registry-durable`

[English](README.md) | 中文

基于 Harness Storage Domain，为 `@dsh-rp/registry` 提供可在崩溃后恢复的安装所有权。每个已提交 Root 都会在 Live Registry 状态发布前持久化完整精确版本 Lock。启动时会重新获取每个来源，验证包身份、版本、Manifest Hash、证据等级和 Graph Hash，再通过 Lifecycle Adapter 重新激活依赖图。任何不匹配都会让 Host 启动失败，而不是静默运行不同代码。

本包继承部署为 `dsh_rp_registry` Domain 配置的 Backend；标准 Web Profile 可以使用 JSON Backend，其他部署也能把同一 Schema 路由到其他 Storage Domain Backend。写入操作串行执行。持久发布失败时，Install 和 Update 会回滚运行时激活；持久删除失败时，Uninstall 会恢复已经释放的运行时注册。

## 模型体验

间接影响，通过恢复后的插件体现；它们只有在精确持久 Lock 通过验证和激活之后，才会贡献自己的能力。

#### KV Cache 影响

自身没有影响。只有所属 Agent 或 Pipeline 选择恢复后的能力时，它们才会影响上下文。

## 已知限制与延期工作

- 持久记录保存 Lock 与来源证明，不保存包归档。发行版的独立内容寻址缓存可以提供完整性绑定的 Payload，但启动时仍会从配置来源重新获取精确 Manifest 和所有哈希绑定 SBOM。
- Lifecycle Disposer 必须完整且不抛异常。若第三方代码违反合同，恢复可以失败关闭，但无法证明外部副作用已经移除。
- Storage Backend 提供单记录持久性。跨机器分布式安装协调需要独立 Leader/Lease 插件。
