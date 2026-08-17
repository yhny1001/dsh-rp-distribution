# DSH RP 插件

中文 | [English](README.en.md)

`dsh-rp-distribution` 是基于 DeepSeek Harness 插件体系重新建立的独立 RP 插件仓库。DSH 是外部 Host；本仓库只维护可安装插件、插件组合包、兼容适配器、RP 包工具以及相关示例，不发行或维护另一套 DSH。

## 安装

### 本地 RP 产品

仓库内的 `@dsh-rp/product` 是可直接安装到 DSH `0.1.0-rc.6` Web Profile 的自包含产品 Bundle：

```sh
pnpm run build
pnpm --dir packages/rp/product pack --pack-destination /tmp/dsh-rp-product
dsh plugin --profile web add /tmp/dsh-rp-product/dsh-rp-product-0.1.0-rc.5.tgz
dsh --profile web
```

安装后可从侧栏底部或设置打开“RP 创作室”，分别维护系统规则、世界观、多个角色、多个用户 Persona 与会话场景，再把五层组合应用到当前空白 Session。对话继续使用 DSH 原生 AgentLoop、Composer、模型选择、流式输出、取消、持久化与统计。

### 完整插件发行族

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

独立 RP 包开发 CLI 是 `@dsh-rp/cli`，提供 `dsh-rp` 命令。

## 入口包

| 包 | 职责 |
|---|---|
| `@dsh-rp/product` | 可本地安装的中文优先 RP 产品界面，以及系统、世界、角色、用户 Persona、场景五层原生 AgentLoop 组合。 |
| `@dsh-rp/distribution-core` | Character、Persona、Lore、Memory、Policy、Pipeline、Registry、Outbox、包生命周期及其他 Headless RP 服务。 |
| `@dsh-rp/distribution-web` | RP Studio、会话路由、Session 资源和可信 UI Slot 集成。 |
| `@dsh-rp/distribution` | 聚合 Core 与 Web 的轻量完整 Web 入口。 |
| `@dsh-rp/cli` | RP 包初始化、验证、构建、单元测试、打包、安装、更新、卸载、SBOM 与发布操作。 |
| `@dsh-rp/registry-server` | 独立的 RP 包 Registry HTTP 服务。 |

组合包使用 DSH 公开的 `dsh.bundle.patch` Manifest。安装或移除组合包只走普通 DSH Profile 生命周期，不改写 Host 文件或 `node_modules`。

## 开发

```sh
corepack enable
pnpm install
pnpm run check
```

本仓库不会安装 DSH 应用依赖图。`pnpm run host:sdk` 从插件 Manifest 读取精确的 `@deepseek-ai/*` Peer 版本，只把对应 npm Tarball 下载到 `.cache/host-sdk`，并创建临时开发链接。这个缓存用于插件类型检查和包级测试，不代表已经启动或验证了完整 Harness。

现有检查覆盖 56 个插件包的内部逻辑、构建和发布内容。浏览器组件测试使用 `tests/host` 中的最小 Host 接口实现；这些实现只服务于单元测试，不会发布，也不能替代真实 DSH 集成测试。参见[架构](docs/architecture.zh.md)与 [Host 兼容性](docs/compatibility.zh.md)。

## Harness 集成测试

`@dsh-rp/product` 已在本地 DSH `0.1.0-rc.6` 上使用一次性 Home 和实际 npm Tarball 验证：Profile 初始化、Bundle Patch、Node API、Client ModuleLoader、正式 Web Slot、Agent Preset 重组、Session 事件、五层上下文条、原生 AgentLoop 与真实流式模型回复均已通过。完整 `distribution-core` / `distribution-web` 发行族仍需单独完成 55 个基础包的 Host 组合验证；SDK Cache 与测试替身不作为该验证的替代品。

## 发布

56 个包共享一个版本，并从 `rp-v<version>` Tag 按依赖顺序发布：

```sh
pnpm run release:rp -- 0.1.0
git tag rp-v0.1.0
git push origin main rp-v0.1.0
```

RP Release Workflow 会构建、测试、打包，在一次性 Consumer 中安装精确 Tarball，生成 SHA-256 校验和、SPDX SBOM 与源码绑定 Release Manifest，最终只发布 `@dsh-rp/*` 包。

项目采用 MIT 许可证，参见 [LICENSE](LICENSE)。
