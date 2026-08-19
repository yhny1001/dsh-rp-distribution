# dsh-rp-distribution

中文 | [English](README.en.md)

> 基于 DeepSeek Harness 的开放式 RP 基础设施、插件框架与公共契约。

`dsh-rp-distribution` 是建立在 DeepSeek Harness 之上的开放式角色扮演（RP）基础设施、插件框架与公共契约。仓库的主要产物不是某一种酒馆界面，而是可复用的领域 IR、Cordis 服务、执行与权限边界、包生命周期、Registry、兼容适配器和组合 Bundle。它复用 DSH 原生的 AgentLoop、Session、模型、工具和 Web Host，不发行或维护另一套 DSH。

`@dsh-rp/compat-sillytavern` 和 `@dsh-rp/product` 是第一方 SillyTavern 兼容适配与参考产品，用来验证 Character Card、Persona、World Info、Prompt Preset 和 Tavern Chat 能否在保留来源并明确报告兼容损失的前提下进入同一套基础设施；它们不是框架唯一允许的数据来源、交互方式或产品界面。

## 项目边界

本仓库负责：

- 版本化的 Character、Persona、Lore、Scene、Memory、State、Media、Package 和 Experience 公共契约。
- 通过 `ctx.effect()` 或 disposer 注册的可逆 Cordis 服务、Provider、Pipeline 和 UI Slot。
- Turn、Workflow、Sidecar、Capability、Policy、Journal、Projection 与 Outbox 的组合边界。
- L0 声明式、L1 沙箱和 L2 显式可信原生包的校验、授权、激活与清理。
- Registry Source、Artifact Store、签名、SBOM、确定性归档、CLI 和发布证据。
- DSH Host、Web Slot、Agent Provider 和外部内容格式的适配层。

本仓库不负责：

- DSH 应用入口、AgentLoop、模型 Provider、浏览器 Shell、原生 Launcher 或 Python SDK。
- 复制或修改已安装的 DSH/Cordis 源码、Host Bundle 或 `node_modules`。
- 把 SillyTavern UI、脚本运行时、Regex 执行器或 TavernHelper 私有行为重新实现为 Host。
- 规定唯一的 RP 产品形态。第三方产品可以复用公共契约并提供完全不同的 UI 和工作流。
- 宣称一套脱离 DSH 的跨 Host Wire Protocol；当前公共契约服务于 DSH 插件生态。

## 架构分层

| 层 | 代表包 | 所有权与扩展方式 |
|---|---|---|
| 公共契约 | `@dsh-rp/contracts` | 只定义客户端安全、可版本化 IR；不拥有存储、执行或默认值。破坏性变更必须通过新 schema 与迁移适配。 |
| 领域服务 | `character`、`persona`、`lore`、`memory-*`、`state`、`scene`、`relationship`、`media` | 提供有界、确定性、可撤销的 Service 或 Provider Registry。具体存储、检索器和生成器可以替换。 |
| 执行与编排 | `capability-catalog`、`agent-runtime`、`pipeline-runtime`、`turn-runtime`、`workflow-*`、`sidecar-jobs` | 冻结执行计划、计算最小权限、路由后端，并在 Turn/Workflow 边界提交证据。 |
| 包与信任 | `sdk`、`package-runtime`、`registry*`、`lifecycle-l0/l1/l2`、`cli` | 校验不可信包、绑定完整性与 SBOM，并按信任等级激活或卸载能力。RP 包代码不会获得 Cordis `ctx`。 |
| Host 集成 | `harness-bridge`、`agent-provider-harness`、`ui-slot-runtime`、`web` | 只通过公开 DSH Peer、事件、服务和 Slot 接入；兼容性失败关闭，不给旧 Host 注入补丁。 |
| 第一方适配与参考实现 | `compat-sillytavern`、`compat-stscript`、`first-party`、`product` | 证明基础设施可以承载真实内容格式与产品，但不把 ST 或当前 UI 固化进公共契约。 |
| 组合发行 | `distribution-core`、`distribution-web`、`distribution` | 只声明默认挂载集合和顺序；叶子插件仍可独立安装、替换和测试。 |

更完整的所有权、挂载关系和兼容性要求参见[架构](docs/architecture.zh.md)与 [Host 兼容性](docs/compatibility.zh.md)。

## 选择开发面

开始写代码前，先确定目标属于哪一种产物：

1. **基础设施 Cordis 插件**：放在 `packages/rp/*`，接收 Host 提供的 `ctx`，对外发布 `@dsh-rp/*` npm 包。适合新增领域 Service、Provider Registry、执行器、存储适配、Host Bridge 或组合 Bundle。
2. **可安装 RP 包**：放在独立项目或 `examples/rp-package-authoring/*`，由 `rp.package.json`、`rp.runtime.json`、资产和 SBOM 组成。包代码不接收 `ctx`，只能使用 Manifest 声明并经 Policy 授权的 L0/L1/L2 能力。
3. **兼容适配或产品插件**：导入器负责把外部格式转换为公共 IR 并保留来源/损失报告；产品负责 UI 和工作流。产品可以自由改变交互，但不能静默改写导入源语义或修改 Host。

三种开发面的完整流程、清单和命令见[开发指南](docs/development.zh.md)。可安装 RP 包的可执行示例见[包开发示例](examples/rp-package-authoring/README.zh.md)。

## 本仓库开发

需要 Node `^22.19.0 || >=24.0.0` 和 pnpm 11：

```sh
corepack enable
pnpm install
pnpm run host:sdk
```

`pnpm run host:sdk` 从各插件 Manifest 读取精确的 `@deepseek-ai/*` Peer 版本，把 npm Tarball 下载到忽略的 `.cache/host-sdk`，并创建仅供类型检查和单元测试使用的临时链接。它不会安装、启动或验证完整 DSH 应用。

修改现有包时先运行最小测试：

```sh
pnpm exec vitest run packages/rp/character/tests/character.spec.ts
pnpm exec tsc -b packages/rp/character --pretty false
```

提交前运行完整检查：

```sh
pnpm run check
```

`check` 依次验证 Workspace 规则、Lint、单元测试、声明/运行时构建和发布载荷。单元测试或 `tests/host` 替身不能替代真实 DSH 集成测试；修改 Host 事件、公开 Slot、Bundle Patch、Agent Preset 或 Session 行为时，还必须使用实际 Tarball 和一次性 `DSH_HOME` 验证目标 Profile。

## 安装发行组合

完整 Web 组合包安装到兼容的 DSH Profile：

```sh
dsh plugin --profile web add @dsh-rp/distribution
dsh --profile web
```

Headless 部署只安装与展示无关的基础设施：

```sh
dsh plugin --profile headless add @dsh-rp/distribution-core
dsh --profile headless
```

组合包使用 DSH 公开的 `dsh.bundle.patch` Manifest。安装或移除只走普通 DSH Profile 生命周期，不改写 Host 文件或 `node_modules`。

## 入口包

| 包 | 职责 |
|---|---|
| `@dsh-rp/contracts` | 全部 Host、Web、包工具和适配器共享的客户端安全 RP IR。 |
| `@dsh-rp/sdk` / `@dsh-rp/cli` | RP 包初始化、校验、构建、测试、打包、签名、SBOM、安装与发布。 |
| `@dsh-rp/package-runtime` | 完整性绑定的 `dsh-rp-runtime-v1` 归档与可执行描述符边界。 |
| `@dsh-rp/distribution-core` | Presentation-neutral 的领域服务、执行、Policy、Registry 和包生命周期组合。 |
| `@dsh-rp/distribution-web` | RP Studio、会话路由、Session 资源和可信 UI Slot 集成。 |
| `@dsh-rp/distribution` | 聚合 Core 与 Web 的轻量完整 Web 入口。 |
| `@dsh-rp/registry-server` | 独立的 RP Package Registry HTTP 服务。 |
| `@dsh-rp/compat-sillytavern` | Clean-room、非执行式 ST Character/Persona/Lore/Preset 兼容适配器。 |
| `@dsh-rp/product` | 第一方 ST-compatible 参考产品 Bundle，不是公共框架唯一 UI。 |

## 第一方 ST 兼容参考产品

`@dsh-rp/product` 可直接安装到 DSH `0.1.0-rc.6` Web Profile，用于验证 ST 内容导入、Prompt 顺序、五层资源组合和原生 AgentLoop：

```sh
pnpm run build
pnpm --dir packages/rp/product pack --pack-destination /tmp/dsh-rp-product
dsh plugin --profile web add /tmp/dsh-rp-product/dsh-rp-product-0.1.0-rc.5.tgz
dsh --profile web
```

它保留 ST 源资源并通过用户明确操作生成独立 Harness 适配副本；脚本、Regex、远程资源与未知扩展保持惰性。它可以作为集成测试和产品设计参考，但新的基础设施能力不应只为当前 Product 的私有 UI 或默认内容建模。

## 测试与成熟度

现有检查覆盖 56 个独立发布包的内部逻辑、生命周期回滚、Policy、持久化适配、包兼容、构建和发布内容。浏览器组件测试使用 `tests/host` 中的最小 Host 合约实现；这些实现只服务于单元测试，不会发布。

`@dsh-rp/product` 已在实际 DSH `0.1.0-rc.6` Web Profile、一次性 Home 和真实 Tarball 上验证 Profile 初始化、Bundle Patch、Node API、Client ModuleLoader、正式 Web Slot、Agent Preset、Session 事件、原生 AgentLoop 与流式模型回复。完整 `distribution-core` / `distribution-web` 发行族仍需单独完成 55 个基础包的 Host 组合验收；SDK Cache 与测试替身不作为该证据的替代品。

## 发布

56 个包共享一个版本，并从 `rp-v<version>` Tag 按依赖顺序发布：

```sh
pnpm run release:rp -- 0.1.0
git tag rp-v0.1.0
git push origin main rp-v0.1.0
```

RP Release Workflow 会构建、测试、打包，在一次性 Consumer 中安装精确 Tarball，生成 SHA-256 校验和、SPDX SBOM 与源码绑定 Release Manifest，最终只发布 `@dsh-rp/*` 包。

项目采用 MIT 许可证，参见 [LICENSE](LICENSE)。
