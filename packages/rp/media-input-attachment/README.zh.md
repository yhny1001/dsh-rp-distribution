# `@dsh-rp/media-input-attachment`

[English](README.md) | 中文

这是 `ctx.rpMedia` 的第一方 DSH 图片输入 Adapter。它声明 L2 信任级别与 `attachment.write` 权限，在发布任何对象前验证完整图片批次，把获准字节写入部署的附件后端，并返回不含原始字节的 `attachment:` Artifact 与模型图片引用。Adapter 注册和所有监听都由可逆 Cordis Effect 管理。

原始字节只存在于浏览器/HTTP 入口以及选中的 Adapter 调用期间。Session Event 只保留不可变的内容寻址引用、精确尺寸、MIME、名称和 Adapter 来源；Base64 不会写入 Journal。同一引用由 Harness Agent、回放 Projection、Session 附件授权和 RP Web 图片画廊共同使用。

## 模型体验

通过所选 Agent Provider 间接生效；该 Provider 会在文本 RP 角色请求之前渲染已经物化的图片引用。

#### KV Cache 影响

图片 Block 可能改变 Provider 侧的多模态缓存。Adapter 不添加文本前缀；不支持图片的 Provider 会通过自身正常的模型能力边界失败。

## 已知限制与延期工作

- v1 只接受 PNG、JPEG、WebP 与 GIF 光栅图片。音频、视频、文档、分块上传和远程对象存储 Adapter 仍是独立插件。
- 如果对象发布后 Turn 才失败，内容寻址存储中可能出现未引用对象，需要部署侧垃圾回收；没有已提交的 Context Event 时，它们不会进入 Session Projection。
