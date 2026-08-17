# `@dsh-rp/registry-server`

[English](README.md) | 中文

这是用于开放 RP 包分发的 MIT 自托管参考服务器。它在本地文件系统中保存不可变 Release，发布无锁读取的原子 Catalog，校验 Manifest、Payload SHA-256、Hash 绑定的 SBOM、运行时归档结构与已配置的 Ed25519 发布者密钥，并提供 `@dsh-rp/registry-sources` 直接消费的响应。它负责发布，而不是 Host 内的已安装包 Registry；安装、激活、所有权与回滚仍由 `ctx.rpRegistry` 负责。

每个 Writer 都会获取跨进程 Index Lock，暂存三个 Release 文件，重命名完整目录，之后原子替换 `index.json`。Reader 在提供内容前会重新校验已存证据。重复发布完全相同的内容是幂等操作；同一个包 ID 与版本绝不能被替换。包撤销与签名密钥撤销均为只追加记录，并立即使匹配的 Manifest、Payload 和 SBOM 路由返回 HTTP 410。

本包导出 Fetch Handler、Node HTTP Adapter 和 `dsh-rp-registry` 可执行文件。只有设置 `DSH_RP_REGISTRY_PUBLISH_TOKEN` 才会启用变更接口。`DSH_RP_REGISTRY_ORIGIN` 是写入证据 URL 的公开 Origin，`DSH_RP_REGISTRY_LISTEN_HOST` 和 `DSH_RP_REGISTRY_LISTEN_PORT` 则独立控制 Reverse Proxy 后方的私有 Listener。`DSH_RP_REGISTRY_ROOT` 选择存储位置；可选的 `DSH_RP_REGISTRY_KEYS` 指向一个 JSON 文件，其中 Publisher Key ID 映射到 PEM Public Key。纯 HTTP Public Origin 只允许 Loopback；远程访问应部署在 HTTPS Reverse Proxy 后方。

```powershell
$env:DSH_RP_REGISTRY_ORIGIN='http://127.0.0.1:3090'
$env:DSH_RP_REGISTRY_ROOT='data/rp-registry'
$env:DSH_RP_REGISTRY_PUBLISH_TOKEN='replace-with-a-secret'
pnpm exec dsh-rp-registry
```

使用与本地、Git 和 npm 获取路径相同的严格 SDK Release 进行发布：

```powershell
$env:DSH_RP_REGISTRY_TOKEN='replace-with-a-secret'
dsh rp publish ./my-rp-plugin --registry http://127.0.0.1:3090
```

公开 Endpoint 包括 `GET /`、`GET /api/rp/v1/catalog`、`GET /api/rp/v1/revocations`、`GET /api/rp/v1/packages/{id}/{version}`，以及不可变的 `/payload` 和 `/sbom` 资源。Bearer 保护的变更 Endpoint 包括 `POST /api/rp/v1/releases`、`POST /api/rp/v1/revocations/packages` 和 `POST /api/rp/v1/revocations/keys`。HTML Catalog 不包含脚本，并携带严格 CSP。

## 模型体验

无，因为这个独立服务只存储和提供包证据，从不组装模型请求。

#### KV Cache 影响

无。

## 已知限制与延期工作

- 参考存储只协调共享同一个文件系统的 Writer。多区域复制、透明日志、漏洞扫描、委派式发布者管理、速率限制、对象存储后端和外部身份提供商认证仍属于可替换的部署关注点。
- 可执行文件会在内存中缓冲一个有大小上限的请求或响应。需要更大归档时，部署可以在 Repository 与 Fetch Handler 前接入流式或对象存储 Adapter。
- 撤销会立即阻止新的下载，但已经运行的 Host 必须镜像或通过其他方式接收撤销 Feed，其本地 Registry 才能停止已安装的包。
