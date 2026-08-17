# Agent Note: 纯插件仓库

Status: implemented

## Problem

在完整 DSH Fork 中维护 RP 插件，会让所有 Host 应用、平台、文档与发布变更看起来都属于 RP 职责。这既掩盖插件约定，也迫使 RP Release 携带无关源码和 CI 基础设施。

## Decision

本仓库只拥有 `@dsh-rp/*` 插件族。DSH 与 Cordis 是通过精确版本 Peer Dependency 表达的外部 Host。开发环境通过忽略的生成式 SDK Cache 获取已发布 Host Artifact；仓库不提交 Host 源码或应用依赖图。Core 与 Web 组合包保持分离，Web 专用扩展只作为显式类型要求，不提供运行时 Shim。

仓库只发布一个共享版本的 `rp-v<version>` Family。测试负责 RP 行为；完整 DSH 应用与平台兼容性继续由 Host 仓库负责。

## Alternatives considered

**继续维护完整 DSH Fork。** 拒绝，因为这会把无关 Host 维护和发布工作分配给插件项目。

**保留 Vendored DSH 源码快照。** 拒绝，因为快照会变成另一份需要更新与审查的 Host 实现。生成式 npm Artifact Cache 能提供开发声明而不产生源码所有权。

**Patch 已安装 Host。** 拒绝，因为隐藏修改不可复现，也无法安全卸载。缺失 Host 扩展必须表现为显式兼容失败。

## Consequences

跟踪的仓库显著缩小，CI、版本、文档与发布都只描述插件。DSH 发布所需通用扩展点之前，Web 兼容范围会窄于 Core。Host 集成测试必须在兼容 DSH Checkout 中运行，而不是在本仓库执行。
