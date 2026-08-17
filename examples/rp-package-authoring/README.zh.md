# RP 包开发示例

[English](README.md) | 中文

这些可安装 MIT 示例使用发行版相同的 SDK、归档读取器、Source Provider、Registry 事务、Lifecycle Adapter、Capability Catalog、Pipeline Runtime 和沙箱。它们是包源码项目，不是 Cordis 插件；包代码不会获得 `ctx` 或注册 API。

## 构建与安装

执行 `pnpm dsh rp init <directory> --template orchestration`、`--template quickjs-critic` 或 `--template ui-panel` 可以创建相同的起步结构。在仓库根目录执行 `pnpm dsh rp pack examples/rp-package-authoring/<example>` 构建任一内置示例。已验证 Release 位于对应示例的 `dist/rp-release`。运行中的 Web Host 需要让 `rp-registry-sources.localRoots` 包含示例目录，随后可执行 `pnpm dsh rp install <绝对-release-目录>` 安装，并执行 `pnpm dsh rp uninstall <root-id>` 卸载。

## `l0-orchestration`

这个无代码 L0 包贡献一个组件、一个 Agent 能力、一个 Memory 能力、一个 Turn Pipeline 和一个 Sidecar Pipeline。命名图使用 `invoke-capability` Stage；通过统一 Catalog 调用 Pipeline 时，会委派到 `ctx.rpPipelines` 中的同一个图。卸载会移除两个图和全部发现条目。

## `l1-quickjs-critic`

这个 L1 包贡献一个 QuickJS 连贯性 Critic Agent，以及调用它的 Workflow Pipeline。Manifest 和可执行描述符都申请 `script.execute`。调用需要 L1 信任上限和该权限；沙箱结果会证明其中不存在 `process` 与 `fetch`。

## `l0-ui-panel`

这个声明式包贡献一个 `studio.overview` UI Slot。它的 HTML 与 CSS 都是 Manifest 声明、由归档完整性绑定的资产。Host 使用严格 CSP 提供资源，Studio 则在既没有 `allow-same-origin`、也没有脚本权限的 iframe 中嵌入入口。卸载会移除 Slot，并让全部包资源 URL 返回 404。

## 信任选择

声明式转换和无代码图使用 L0。不可信或半可信的 QuickJS 与无导入 WebAssembly 使用 L1。L2 会在进程内执行显式信任的原生代码，要求 Ed25519 签名者和 Host 密钥信任，因此不会作为可复制起步模板提供。
