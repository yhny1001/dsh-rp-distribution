# @dsh-rp/registry

[English](README.md) | 中文

面向 RP 包的 MIT 参考注册中心核心。它在不执行代码的前提下验证 Manifest，支持可逆的本地、Git、npm 与注册中心来源 Provider，把依赖图解析成确定性锁，验证 Payload SHA-256、哈希绑定的 SBOM 与可信 Ed25519 签名，并对包或签名密钥撤销采取失败关闭策略。

部署插件可以可逆注册可信公钥与取交集的策略。策略可针对指定信任等级强制要求 Payload 完整性、签名和 SBOM。Lock 会绑定 Manifest 哈希、Payload 哈希、签名者、SBOM 哈希、来源、精确版本与依赖图。

仅元数据的 `publish()` 仍可用于开放目录镜像，并会明确标记为 `evidenceVerified: false`。证据策略会要求走由 Provider 支撑的 `install()` 路径，并阻止未验证 Release 被解析或进入 Lock。

网络与包管理器行为有意由来源 Provider 插件提供，使部署能够应用自己的凭据、代理、签名与沙箱策略，而不会把这些关注点耦合进注册中心依赖图。

`install()`、`update()` 与 `uninstall()` 是串行生命周期事务。已提交 Root 保存精确依赖图，每个 Active Package 保存 Owner，因此相同依赖可共享，冲突版本会失败关闭。Lifecycle Adapter 先做无副作用异步 Prepare，再做同步可逆 Activate。激活失败会回滚依赖；Update 在替换旧图前先准备恢复路径。L1、L2 Release 必须有显式 Adapter，L0 Release 可以保持为惰性数据。

Registry 为 Headless 与 Web 权限检查暴露脱离句柄的 Installation、Active Package Owner、Source Provider、Lifecycle Adapter 和证据 Policy。Commit 之后的观察者异常只记录日志，不会改变事务结果。

一个可选的 `RpRegistryInstallationStore` 构成持久化边界。Registry 会在发布 Live Owner 前持久写入替换状态，并在持久变更失败时恢复运行时。`@dsh-rp/registry-durable` 提供发行版使用的默认 Storage Domain 实现与启动验证重放。

一个可选的 `RpPackageArtifactStore` 按小写 SHA-256 缓存完整性绑定的归档。Registry 会在使用前验证来源或缓存字节，在提交安装前把新验证的来源字节发布到缓存，并向生命周期适配器提供独立的 Payload 与 SBOM 副本。`@dsh-rp/registry-artifacts-local` 提供发行版默认的持久本地实现。

`@dsh-rp/registry-server` 提供独立的 MIT 自托管发布端：不可变归档、原子 Catalog、只追加撤销、无脚本 Web Catalog，以及 Registry Source Provider 可直接消费的开放 HTTP 响应。

## 模型体验

通过检查包元数据或依赖锁的 Agent 消费者间接产生影响。

#### KV Cache 影响

只有当消费者渲染发生变化的目录时，Registry 变化才会影响模型上下文。

## 已知限制与延期工作

- 没有 Installation Store 的 Core-only 部署仍然只保存进程内状态。没有 Artifact Store 时，归档会从配置的来源重新获取。透明日志、漏洞扫描器、持久撤销镜像、归档解包和分布式发布仍由独立插件实现。
- Lifecycle Disposer 必须完整且不抛异常。损坏的第三方 Disposer 即使已从 Registry 移除所有权，仍可能使它自己的外部 Effect 处于不确定状态。
