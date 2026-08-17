# `@dsh-rp/registry-sources`

[English](README.md) | 中文

`ctx.rpRegistry` 的惰性包证据 Source Provider：规范化本地包、固定 ref 的 GitHub/GitLab、嵌入 `dshRp` Manifest 的精确 npm 版本，以及开放 Registry Endpoint。当 Manifest 声明 Payload 或 SBOM 完整性时，Provider 会获取对应的同级文件、有界 npm Release 信封或同源 Registry URL。获取过程绝不执行包代码。

本地 Manifest 与证据必须解析到 Allowlist 中的规范根目录下。配置精确 Origin 前默认拒绝网络；重定向和含凭据 URL 会被拒绝。JSON 与归档响应体使用各自的大小上限流式读取。

`@dsh-rp/registry-server` 是与之匹配的 MIT 自托管参考 Endpoint。它的 Release Envelope 不需要特殊客户端路径，因此参考 Registry、第三方 Registry 与镜像 Registry 都经过相同的 Provider 和 Host 完整性检查。

## 模型体验

通过检查已解析包元数据的 Agent 或 Studio 消费方间接体现。

#### KV Cache 影响

Provider 不贡献提示词文本；消费方拥有任何渲染后的包元数据。

## 已知限制与延期工作

- Git Adapter 覆盖 GitHub 和 GitLab 的 Clean-room Raw File URL。npm 包把 Manifest 嵌入 `dshRp`，并在分发 Tarball 内携带 `rp.package.tgz` 与 `rp.sbom.json`。Provider 验证有界外层条目和匹配的元数据，再把内层证据交给 Registry 校验；运行时归档解析与执行仍属于 Lifecycle Adapter。
