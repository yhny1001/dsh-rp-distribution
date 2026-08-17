# `@dsh-rp/distribution-web`

[English](README.md) | 中文

独立 RP 运行时的浏览器接入层。把它放在 `@deepseek-ai/dsh-web-app` 与 `@dsh-rp/distribution-core` 之后；它只挂载可安装 RP UI Slot Registry 和 RP Studio／会话插件。

单独维护这一层，可以避免 Headless Profile 解析 React、浏览器客户端模块或 Web Host API。

## 模型体验

无，因为 Web 插件负责启动用户选择的 RP Turn，所有模型可见内容仍由 RP 消费者负责。

#### KV Cache 影响

没有直接影响。

## 已知限制和后续工作

- 这个包要求 DSH 提供发行兼容矩阵中列出的 Web 会话提交与 RP Slot 扩展点；不支持的 Host 版本会在兼容检查中失败，不会被隐式修改源码。
