# DSH RP 插件

[English](README.md) | 中文

`dsh-rp-distribution` 是 DeepSeek Harness 的独立 RP 插件族。本仓库不发行、也不维护 DSH Fork；DSH 只作为 Host，本仓库维护的每个包都是可安装插件、插件组合包、兼容适配器、包工具或 RP 专用测试与示例。

## 安装

包发布后，可把完整 Web 组合包安装到兼容的 DSH Profile：

```sh
dsh plugin --profile web add @dsh-rp/distribution
dsh --profile web
```

Headless 部署只安装与展示无关的组合包：

```sh
dsh plugin --profile headless add @dsh-rp/distribution-core
dsh --profile headless
```

独立包开发 CLI 是 `@dsh-rp/cli`，提供 `dsh-rp` 命令。

## 入口包

| 包 | 职责 |
|---|---|
| `@dsh-rp/distribution-core` | Character、Persona、Lore、Memory、Policy、Pipeline、Registry、Outbox、包生命周期及其他 Headless RP 服务。 |
| `@dsh-rp/distribution-web` | RP Studio、会话路由、Session 资源和可信 UI Slot 集成。 |
| `@dsh-rp/distribution` | 只聚合 Core 与 Web 的轻量完整 Web 入口。 |
| `@dsh-rp/cli` | RP 包初始化、验证、构建、测试、打包、安装、更新、卸载、SBOM 与发布操作。 |
| `@dsh-rp/registry-server` | 独立的 RP 包 Registry HTTP 服务。 |

组合包使用 DSH 公开的 `dsh.bundle.patch` Manifest。安装或移除组合包只走普通 DSH Profile 生命周期，绝不改写 Host 文件或 `node_modules`。

## 开发

```sh
corepack enable
pnpm install
pnpm run check
```

本仓库不会安装 DSH 应用依赖图。`pnpm run host:sdk` 会从插件 Manifest 读取精确的 `@deepseek-ai/*` Peer 版本，只把对应 npm Tarball 下载到 `.cache/host-sdk`，并创建临时开发链接。这样可以使用真实 Host 声明和可达运行时 API，又不会把 DSH 源码纳入本仓库。

完整单元测试覆盖 55 个包。浏览器组件测试使用 `tests/host` 中的最小 Host 约定实现；完整 DSH 应用组合兼容性由 Host 集成测试负责。参见[架构](docs/architecture.zh.md)与 [Host 兼容性](docs/compatibility.zh.md)。

## 发布

55 个包共享一个版本，并从 `rp-v<version>` Tag 按依赖顺序发布：

```sh
pnpm run release:rp -- 0.1.0
git tag rp-v0.1.0
git push origin main rp-v0.1.0
```

RP Release Workflow 会构建、测试、打包，在一次性 Consumer 中安装精确 Tarball，生成 SHA-256 校验和、SPDX SBOM 与源码绑定 Release Manifest，最终只发布 `@dsh-rp/*` 包。

项目采用 MIT 许可证，参见 [LICENSE](LICENSE)。
