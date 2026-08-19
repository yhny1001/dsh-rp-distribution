# dsh-rp-distribution 开发指南

[English](development.md) | 中文

本指南说明怎样在不扩大仓库边界、不耦合某个参考产品的前提下开发 DSH RP 基础设施。仓库同时支持基础设施 Cordis 插件和可安装 RP 包；两者的权限、目录和运行方式不同，不能混为一类。

## 1. 先选择正确的所有者

| 需求 | 应放位置 | 原因 |
|---|---|---|
| 新增跨插件共享的纯数据 IR | `@dsh-rp/contracts` | Contract 必须保持客户端安全、存储中立和版本化。 |
| 新增角色、记忆、状态等领域运行时 | 新建或修改一个叶子 `packages/rp/*` Service | 领域行为由最小所有者提供，并通过 Cordis 生命周期撤销。 |
| 新增可替换算法或后端 | 对应 Service 的 Provider 接口，必要时独立插件 | 使用注册与 disposer，避免核心包导入具体实现。 |
| 新增 Turn/Workflow/Sidecar 编排能力 | `pipeline-runtime`、`turn-runtime`、`workflow-router` 或独立 Backend | 编排器只依赖冻结计划、能力与最小权限，不拥有产品 UI。 |
| 新增用户可安装内容或能力包 | 独立 RP 包项目 | RP 包不接收 `ctx`，通过归档、Manifest、Policy 和 L0/L1/L2 生命周期运行。 |
| 新增外部内容格式 | 独立 `compat-*` 适配器 | 导入不可信数据，输出公共 IR、来源与兼容损失报告，不执行源脚本。 |
| 新增 DSH Web/Session 接入 | `web`、`ui-slot-runtime` 或新的 Host Bridge | Host 接入必须依赖公开 Peer/Slot，并在不兼容时失败关闭。 |
| 新增某一种最终用户体验 | 独立 Product 插件或 `@dsh-rp/product` | 产品拥有 UI 和默认内容，但不能把私有交互模型提升为公共 Contract。 |

如果一个变更同时修改 Contract、Runtime 和 UI，应拆成依赖方向明确的提交：先稳定公共 IR，再实现运行时，最后接入产品。不要让 `contracts` 反向依赖 Runtime，也不要让 Core 为当前 Product 私有组件增加字段。

## 2. 环境准备

要求：

- Node `^22.19.0 || >=24.0.0`
- pnpm 11
- 只有进行真实 Host 集成测试时才需要本机 `dsh`

```sh
corepack enable
pnpm install
pnpm run host:sdk
```

`host:sdk` 从各包的精确 Host Peer 版本下载 npm Artifact 到 `.cache/host-sdk`，并创建忽略的开发链接。这个目录可以删除，不进入 npm Tarball，也不表示已经运行过 DSH。

## 3. 修改现有基础设施插件

### 3.1 找到最小所有者

优先修改拥有该状态或生命周期的叶子包：

- 数据形状属于 `contracts`。
- 角色注册与模型安全投影属于 `character`。
- 检索和 Store 选择属于 `memory-basic`；具体算法或持久化属于独立 Provider。
- 能力发现与最小授权属于 `capability-catalog` / `policy`。
- 执行图属于 `pipeline-runtime`；后端选择属于 `workflow-router`。
- Turn 只协调 prepare/execute/validate/commit/abort，不吸收具体领域实现。
- DSH Session、Agent、Web Slot 转换属于 Bridge/Web 层。

不要因为组合包已经依赖很多服务，就把新逻辑直接写进 `distribution-core`、`distribution-web` 或 `distribution`；这些包只拥有组合成员和挂载顺序。

### 3.2 保持依赖方向

- 内部 `@dsh-rp/*` 版本使用 `workspace:^`。
- 叶子插件需要的内部运行时接口通常同时出现在 `peerDependencies` 和 `devDependencies`。
- 组合 Bundle 需要实际安装的成员放在 `dependencies`，仍使用 `workspace:^`。
- 所有 `@deepseek-ai/*` 运行依赖都是外部、精确版本 `peerDependencies`，不能使用 Workspace 范围，也不能放进普通 `dependencies`。
- Core 包不能依赖 React、DOM 或浏览器 API；这些内容只属于 `distribution-web`、`web` 或 Product。
- 不复制 Cordis、DSH 应用源码或生成的 Host Bundle。

### 3.3 使用可逆生命周期

每个运行能力必须能够卸载并恢复 Host 原状：

```ts
ctx.effect(() => ctx.rpMemory.registerRetriever(retriever))
```

或者让注册函数返回幂等 disposer。Service 销毁后不能遗留：

- Context 属性
- Event Listener
- Provider/Capability/Pipeline 注册
- 定时器、Worker、子进程或文件句柄
- Web Route、Command 或 UI Slot
- 仍可写入的内存 Projection

涉及异步资源时，disposer 应等待关闭完成；涉及外部监听器失败时，应明确决定失败传播还是记录日志，不能让一次观察者异常破坏已提交状态。

### 3.4 验证输入和模型投影

- 所有不可信或持久化输入必须验证 schema、大小、数量、深度和字符串边界。
- 存入运行时的对象必须脱离调用方引用；公开快照使用冻结或等价的只读策略。
- 模型可见投影单独定义并限制条目数、字符数或 Token 预算。
- Compatibility Envelope、未知字段、脚本源码、Secret 和 Host 私有对象默认不得进入模型上下文。
- 确定性排序必须有稳定 Tie-breaker，不能依赖 Map 插入偶然顺序或当前时间。
- 幂等操作要接受相同重试并拒绝同 ID 不同内容的冲突。

### 3.5 同步文档与测试

普通基础设施叶子包通常同时维护：

- `README.md`
- `README.zh.md`
- `src/index.ts`
- `src/invariant.ts`
- `tests/*.spec.ts` 或 `tests/*.spec.tsx`
- `package.json`
- `tsconfig.json`

CLI、Product、Registry Server 和纯 Bundle 可以按职责增加入口或省略不适用的 `invariant.ts`，但每个公开包都必须提供成对的中英文 README、明确的发布入口和受影响行为测试。用户可见行为变化必须同步中英文 README。运行时插件测试至少覆盖成功路径、输入边界、重复注册、幂等 disposer 和插件整体卸载。

迭代时运行最小范围：

```sh
pnpm exec vitest run packages/rp/character/tests/character.spec.ts
pnpm exec tsc -b packages/rp/character --pretty false
```

需要验证多个相关包时，可以把路径交给同一个 Vitest 调用；完成后再运行全仓检查。

## 4. 新增基础设施包

优先复制职责最接近的叶子包结构，不要从组合包开始。一个普通包至少包含：

```text
packages/rp/<name>/
├── package.json
├── tsconfig.json
├── README.md
├── README.zh.md
├── src/
│   ├── index.ts
│   └── invariant.ts
└── tests/
    └── <name>.spec.ts
```

新增时完成以下清单：

1. 包名使用 `@dsh-rp/<name>`，版本与 Workspace 根版本一致，Repository Directory 指向实际目录。
2. `main`、`types`、`exports` 和 `files` 只发布编译后的 `lib/`、声明、README、License 和明确声明的 Bundle Patch；不发布 `src` 或 Source Map。
3. `tsconfig.json` 引用直接依赖的内部包，输出声明到 `lib/types`。
4. `src/index.ts` 导出公共 API 和 Cordis 插件；`src/invariant.ts` 只导出稳定不变量，不读取 Host 私有实现。
5. 在测试中证明安装、行为、重复注册、错误回滚和完全卸载。
6. 如果包应进入默认 Core 或 Web 组合，显式更新对应 `cordis.patch.yml` 和 Bundle `dependencies`；不是所有新包都应自动进入默认发行组合。
7. 如果有新 Host 要求，同步更新 `docs/compatibility.md` 和 `docs/compatibility.zh.md`。
8. 当前 Workspace 一致性检查固定验证发布包数量；有意新增或移除成员时，同步更新 `scripts/check-workspace.ts` 的预期数量和根 README 的发布说明。

根级 TypeScript 与 `tsdown` 配置会通过 `packages/rp/*` 自动发现包，但组合挂载、兼容文档和发布数量仍需要显式审查。

## 5. 开发可安装 RP 包

可安装 RP 包不是 Cordis 插件。它的代码不会收到 `ctx`，不能调用任意 Host 注册 API，也不能依赖本仓库源码路径。

在独立项目中安装 CLI：

```sh
pnpm add -D @dsh-rp/cli
pnpm exec dsh-rp init ./my-rp-package --template orchestration
pnpm exec dsh-rp validate ./my-rp-package
pnpm exec dsh-rp test ./my-rp-package
pnpm exec dsh-rp pack ./my-rp-package
```

可选模板：

- `orchestration`：L0 无代码 Component、Capability、Turn/Sidecar Pipeline。
- `quickjs-critic`：L1 QuickJS Workflow 能力。
- `ui-panel`：L0、无脚本、完整性绑定的沙箱 UI Slot。

信任等级：

| 等级 | 允许内容 | 适用场景 |
|---|---|---|
| L0 | 声明式表达式、无代码图、HTML/CSS UI | 默认选择；不提供脚本、网络、文件或 Host 对象。 |
| L1 | 有界 QuickJS、无导入 WebAssembly | 半可信计算；必须申请 `script.execute` 并经过 Policy。 |
| L2 | 显式可信的进程内原生 JavaScript | 仅限审查过的签名发布者；不是沙箱，必须申请 `native.execute`。 |

Manifest 与 `rp.runtime.json` 的 Component、Capability、Pipeline、UI Slot 和权限必须精确一致。未知字段失败关闭，不会自动获得能力。完整示例见[包开发示例](../examples/rp-package-authoring/README.zh.md)。

## 6. 开发兼容适配器

外部格式一律视为不可信输入。兼容适配器应：

1. 解析有界字节，不执行脚本、Regex、模板 Helper 或远程资源。
2. 输出稳定公共 IR，而不是让 ST/外部私有类型扩散到全部 Runtime。
3. 在 `CompatibilityEnvelope` 中保留来源、未知字段、警告和逐路径损失报告。
4. 区分“数据保留”和“可执行行为保留”；不能执行的内容可以惰性保存。
5. 保留原始兼容资源；需要改变 Prompt Role、顺序或注入语义时，创建独立派生副本并要求用户明确操作。
6. 使用 Golden Corpus、恶意输入和 Fuzz Case 测试原型污染、路径穿越、超限数据和异常编码。

ST 是当前第一方兼容目标，不是公共 Contract 的命名空间。只有能被多个来源和产品共同解释的概念才应进入 `contracts`。

## 7. 开发 Web 或 Product

- 只使用目标 DSH 版本公开的 Client Module、Service、Event 和 UI Slot。
- Host 缺少必需能力时失败关闭；类型声明不能伪造运行时实现。
- Product 可以自由修改导航、编辑器、默认资源、视觉样式和工作流。
- Product 升级不得覆盖用户导入/编辑的数据；私有持久化 schema 变化需要迁移或明确拒绝策略。
- 外部源与 Harness 派生资源必须保持独立身份和来源。
- Core 逻辑应先存在于可测试的 Service/纯函数中，React 组件只负责投影和交互。
- 修改 Slot、Session、Agent Preset、Composer 或模型请求路径后，必须打实际 Tarball 做真实 Host 验收。

`tests/host` 只实现浏览器单元测试所需的最小接口，不能作为 Host 兼容证据，也不能发布。

## 8. 测试层级

| 层级 | 证明内容 | 常用命令或环境 |
|---|---|---|
| 纯函数/IR | 验证、排序、预算、迁移、序列化 | `pnpm exec vitest run <spec>` |
| Cordis 生命周期 | Service 安装、事件、注册、回滚、dispose | 包级 Vitest + 真实 `Context` |
| 包与安全边界 | Manifest、Archive、签名、SBOM、Trust、Sandbox | SDK/Runtime/Lifecycle 测试 |
| 浏览器组件 | 可见状态、提交路由、错误呈现 | JSDOM + `tests/host` 最小契约 |
| 构建与载荷 | 类型声明、ESM、Exports、Tarball 文件 | `pnpm run build`、`pnpm run publint` |
| 真实 Host 集成 | Bundle Patch、Client Loader、Slot、Session、AgentLoop | 实际 Tarball + 一次性 `DSH_HOME` + 目标 Profile |
| 发布验收 | Consumer 安装、校验和、SBOM、Release Manifest | `pnpm run release:verify` / `release:pack` |

提交或发布前：

```sh
pnpm run check
pnpm run release:verify
pnpm run release:pack --out dist/npm-rp
```

只有准备发布或需要审计最终载荷时才运行 Release Pack；日常迭代先跑最小受影响测试。

## 9. 完成定义

一个基础设施变更完成前应满足：

- 状态和生命周期归属于最小正确包，没有反向依赖或新循环。
- 所有注册都可撤销，重复 disposer 安全，失败路径不残留资源。
- 输入、输出、模型投影和并发边界有明确上限。
- Host 权限来自公开 Peer/Policy，不通过补丁或私有导入获得。
- 公共 Contract 的兼容性、schema 与迁移路径已经说明。
- 英文和中文 README 同步。
- 最小测试、类型检查和 `pnpm run check` 通过。
- 涉及真实 Host 行为时，已经记录实际 Tarball 集成证据。
- 发布载荷不包含 `src`、Source Map、Host Bundle、SDK Cache 或测试替身。

## 10. 发布规则

全部 `@dsh-rp/*` 包属于单一 `rp-v<version>` 发布族：

- 共享一个版本。
- Release 成员由 `packages/rp/*/package.json` 自动发现。
- 依赖顺序由内部 `dependencies` / `optionalDependencies` 拓扑决定。
- 只从匹配版本的 `rp-v<version>` Tag 发布。
- Tarball 必须通过 Publint、一次性 Consumer 安装、校验和与 SBOM 验证。

发布命令与 Workflow 入口见根 [README](../README.md#发布)。
