# `@dsh-rp/package-runtime`

[English](README.md) | 中文

这是可执行 RP 归档的严格共享边界。需要运行时激活的包必须包含 `rp.runtime.json`，声明 `compatibility.runtime = "dsh-rp-runtime-v1"`，并且组件与能力必须和完整性绑定的 Manifest 精确一致。

读取器接受 tar-gzip，以及 npm 使用的单层 `package/` 前缀。它限制解压总字节、文件数量和单文件大小；拒绝路径穿越、绝对路径、重复条目、链接、特殊文件、非法 UTF-8、未知描述符字段、缺失资产、声明漂移和与包信任级别不兼容的实现类型。返回的文件字节始终是独立副本。

写入器会排序路径、规范化描述符、固定 tar 元数据、生成逐字节稳定的 gzip，并强制让输出通过同一个严格读取器。npm 发布使用包含 `package.json`、`rp.package.tgz` 与 `rp.sbom.json` 的外层 Tarball；有界信封读取器会核对嵌入的 `dshRp` 元数据，并且只返回内层证据。L0、L1、L2 生命周期插件分别负责注册、授权、执行和清理。

## 运行时描述符

`rp.runtime.json` 使用 `schemaVersion: 1`。组件与能力 id 集合必须和 Manifest 声明精确一致。每个条目都声明支持的 Scope；能力还需声明发现元数据、可选权限与预算，以及至多一个实现。

可选的 `pipelines` 数组包含无代码的 Turn、Workflow 或 Sidecar DAG。每个图的 id 必须精确匹配一个 `pipeline` 类型能力；该能力不提供实现，因为调用会路由到 `ctx.rpPipelines`。包内 Stage 可以调用 Capability、调用其他 Pipeline 或执行 JSON 相等条件，并显式声明顺序、超时、重试和失败策略。

可选的 `uiSlots` 数组包含沙箱化包 UI 描述符。其 id 必须与 Manifest `uiSlots` 精确匹配；每个入口与子资源也必须出现在 Manifest `assets` 中。Runtime v1 在所有信任等级都只允许 HTML/CSS。读取器会在激活前解析每个入口，并拒绝 Script、Frame、Form、嵌入 Object、SVG/MathML 文档、事件处理器、导航属性、外部 URL 和未声明的本地引用。

```json
{
  "schemaVersion": 1,
  "components": [],
  "capabilities": [{
    "id": "example.quickjs",
    "kind": "tool",
    "title": "Example",
    "description": "Returns structured JSON.",
    "scopes": ["conversation"],
    "permissions": ["script.execute"],
    "implementation": { "kind": "quickjs", "path": "runtime/example.js" }
  }]
}
```

L0 接受 `expression`；L1 接受 `quickjs` 与 `wasm`；L2 接受 `native`。实现文件和全部 Manifest Asset 必须是同一归档内的普通文件。未知字段会失败关闭，不会成为环境配置。

## 模型体验

无。本包只解析已验证归档，不注册任何模型表面。

#### KV Cache 影响

无。是否让已激活能力影响模型请求，由运行时消费者决定。

## 已知限制与延期工作

- v1 传输格式仅支持 tar-gzip；其他内容寻址打包格式需要新的兼容版本。
- 归档真实性、签名密钥信任、SBOM 绑定和来源获取仍由 Registry 负责，并且必须在运行时激活前完成。
