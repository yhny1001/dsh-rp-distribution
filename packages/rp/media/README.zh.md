# `@dsh-rp/media`

[English](README.md) | 中文

可替换的媒体生成 Provider 与输入 Adapter Registry，提供显式信任与权限、确定性路由、取消、有界 Artifact 校验，并内置 L0 SVG 场景卡 Provider。输入 Adapter 只用不含字节的描述符做匹配，按完整批次验证，并把持久 Artifact 转为模型引用，不向 Capability Catalog 暴露源字节。

## 模型体验

通过调用 `rp.media.generate` 并显式附加或描述生成 Artifact 的已授权 Agent 间接体现。

#### KV Cache 影响

Registry 不添加提示词前缀。后续缓存影响由 Agent 编写的描述或附件元数据决定。

## 已知限制与延期工作

- 光栅图像、音频、视频和文档生成需要独立安装的 Provider。图片输入由 [`@dsh-rp/media-input-attachment`](../media-input-attachment) 提供；其他输入类型需要独立 Adapter。Studio 渲染任何 Artifact 内容时都必须保留 iframe 与 CSP 沙箱。
