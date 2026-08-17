# 产品媒体 Provider 与场景 Gallery

日期：2026-08-17。状态：已在本地实现。

## 决策

媒体生成使用仓库已有 `@dsh-rp/media` Provider Registry。为保持产品 Tarball 单包安装，构建新增 `@dsh-rp/product/media` 子入口：它在独立 Node 编译面中内联 Media/Contracts 代码但外置 Host `@deepseek-ai/cordis`，Bundle Patch 先挂载 Media Service，再挂载 Product。外部图片、音频、视频或文档 Provider 继续通过同一个 `rpMedia.register()` 扩展，不需要修改产品 Agent 或 Client。

`rp_list_media_providers` 公开只读 Provider Catalog。`rp_generate_media` 只接受 Image/Audio，执行 Registry 的验证、确定性路由和取消，再把 Artifact ID、Kind、MIME、URI 与 Metadata 写入 `media` Runtime Effect。Effect 拥有 Tool Call Turn/Step/Seq，因此 Native Fork 能裁切媒体。`<rp-dynamic-state>` 会剥离 URI 和 Metadata，只把 Artifact 身份传入下一轮，避免 4 MiB Data URI 破坏 Prompt 与 KV Cache。

角色对话从当前 Projection 提取最多八个 Artifact。Data/HTTPS Image 进入受限 `<img>`，Audio 进入原生 `<audio controls>`，Attachment URI 只显示 Provider 提示；历史详情继续保留结构化记录。每条角色消息另有用户触发的浏览器本地“朗读”，调用 Web Speech、先取消前一段、使用 `zh-CN`，且不上传或伪装成持久 Audio Artifact。

## 验证

Media 子插件测试确认内置 `svg-card` Catalog、1024×576 SVG Artifact、Data URI 和 Audio Provider 缺失错误。Agent Tool 测试确认 Provider 列表、生成 Effect、Gallery 数据与 Prompt 中无 Data URI。实际 Tarball 包含独立 `lib/media.js`，隔离 Harness 启动后 Kaon 调用 Catalog 和 Generate，生成标题“黑海岸警钟”的 SVG 场景卡；角色对话显示 `SCENE MEDIA`、MIME 和实际图片。Native 对话可见 Tool 与 Artifact ID，但不展开 Data URI。四个角色消息“朗读”按钮在 Codex 内置浏览器点击无错误。
