# RP 插件包

[English](README.md) | 中文

`rp/` 包含完整、独立发布的 `@dsh-rp/*` 插件系列。每个子目录都是一个公开 npm 包；这个 Workspace 不包含 DSH 应用或 Host 包。

内部包关系使用 `workspace:^`。Cordis 与 DSH 服务都是由已安装 Host 提供的精确版本外部 Peer。Core、Web 与完整组合包分别是 `@dsh-rp/distribution-core`、`@dsh-rp/distribution-web` 和 `@dsh-rp/distribution`。

参见仓库[架构](../docs/architecture.zh.md)、[Host 兼容性](../docs/compatibility.zh.md)与完整的[基础设施开发指南](../docs/development.zh.md)。开发前先区分接收 Cordis `ctx` 的基础设施插件与不接收 `ctx` 的可安装 RP 包。
