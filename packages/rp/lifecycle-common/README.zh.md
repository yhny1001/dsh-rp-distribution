# `@dsh-rp/lifecycle-common`

[English](README.md) | 中文

这是独立 L0、L1、L2 包生命周期插件共用的失败关闭准备与可逆发布层。它把 Registry 已验证的归档转换成不可变 Component、命名 Pipeline 和 Capability 注册，并且不会在准备阶段执行包代码。

所有可执行包都必须有载荷 SHA-256 证据。L2 调用方还可以强制要求 Registry 信任的签名和哈希绑定 SBOM。能力权限必须是 Manifest 权限的子集，每个可执行能力还必须重复声明对应信任级别的执行权限。激活依次注册组件、Pipeline 图和 Catalog 能力；Pipeline 能力使用最小有效权限委派给原始图，并返回最终 Frame 值。部分发布会回滚，卸载或插件更新时按逆序释放全部注册。

## 模型体验

通过后续被 Agent 或 Pipeline 选择的能力间接产生影响。

#### KV Cache 影响

自身无影响。任何模型可见渲染都由能力消费者负责。

## 已知限制与延期工作

- 共享层负责注册元数据和生命周期原子性，不负责各信任级别的具体执行。
- 清理被设计为尽力完成且永不抛错，因为 Registry 拆卸无法从抛错的 disposer 中恢复；各注册表应提供幂等 disposer。
