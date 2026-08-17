# @dsh-rp/sdk

[English](README.md) | 中文

供 `dsh rp` 和参考注册中心使用的纯包工具。它校验不可信的 `rp.package.json` 文件、生成确定性 SHA-256 身份、哈希并验证 JSON SBOM、使用 Ed25519 签名与验证规范化 Manifest、迁移显式的 schema 版本 0 格式，并创建 L0 起始 Manifest。

`buildRpPackage()` 创建确定性运行时归档，用归档摘要替换陈旧完整性元数据，绑定 CycloneDX SBOM，可选签名最终 Manifest，并通过安装阶段读取器验证结果。它强制执行描述符权限，并要求 L2 Release 提供 Ed25519 签名者。返回的 Manifest、归档与 SBOM 分别直接对应 `rp.package.json`、`rp.package.tgz` 与 `rp.sbom.json`。

校验过程不会加载包代码，未知字段也不会授予能力。

`dsh rp init --template ui-panel` 创建一个 L0 可安装 UI 包，其入口和样式表同时声明在 Manifest 与运行时描述符中。`dsh rp validate`、`build`、`test` 和 `pack` 执行与 Host 激活阶段相同的路径、声明、信任和脚本权限检查。`dsh rp test` 还会先通过 `@dsh-rp/eval` 评测包根目录的 `rp.eval.json`，再运行可选的包测试脚本。

## 模型体验

无。SDK 不组装模型请求或提示词内容。

#### KV Cache 影响

无。

## 已知限制与后续工作

- SDK 会验证 SBOM 身份，但不查询漏洞数据库；扫描器仍是独立策略插件。
- 私钥托管、透明日志、时间戳和远程签名器集成仍由部署层负责。
- 迁移有意只接受 schema 版本 0 和 1。
