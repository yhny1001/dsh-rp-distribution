# `@dsh-rp/cli`

[English](README.md) | 中文

用于开发 DSH RP 插件的独立命令行工具。它可以单独安装并通过 `dsh-rp` 运行；使用整合版 DSH 时，也可以继续使用兼容入口 `dsh rp`。

```sh
pnpm add -D @dsh-rp/cli
pnpm exec dsh-rp init ./my-rp-plugin
pnpm exec dsh-rp validate ./my-rp-plugin
pnpm exec dsh-rp pack ./my-rp-plugin
```

这个 CLI 负责 RP 脚手架、校验、迁移、评测、打包、SBOM、签名、Registry 安装和发布。它不会导入 DSH 应用，也不会修改 DSH 源码树。

## 模型体验

无，因为 CLI 在 Agent Session 之外运行，不会组装模型请求。

#### KV Cache 影响

无。

## 已知限制和后续工作

- `install`、`update` 与 `uninstall` 命令需要运行中的 Host 提供 RP Registry API；离线开发命令不需要 Host。
