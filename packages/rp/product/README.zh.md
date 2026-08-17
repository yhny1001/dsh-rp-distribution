# `@dsh-rp/product`

[English](README.md) | 中文

面向已安装 DSH `0.1.0-rc.6` Web Profile 的本地优先 RP 产品插件。一个自包含 Bundle 同时注册 Node API、`rp-studio` 原生 Agent Preset、中文优先的管理工作区、会话标题栏入口和 Composer 上方的上下文条。

产品在存储、界面与系统提示词装配中始终区分五种模型输入：

1. **系统规则**定义模型如何响应以及必须遵守的边界。
2. **世界观**定义环境、历史、地点与客观规律。
3. **角色阵容**定义模型要扮演谁；一个会话可指定主要角色和多个配角。
4. **用户人设**定义用户在故事中是谁，绝不会把该身份转移给模型扮演。
5. **当前场景**只定义本次会话此刻的情境。

每个 DSH Session 都有显式的组合绑定。把组合应用到空白 Session 时，插件会将其切换到随包提供的 `rp-studio` Agent Preset；后续修改角色、Persona、世界或场景时，原生 AgentLoop 会在每次提示词装配时重新读取。插件不启动第二套模型循环。

## 本地安装

```sh
pnpm run build
pnpm --dir packages/rp/product pack --pack-destination /tmp/dsh-rp-product
dsh plugin --profile web add /tmp/dsh-rp-product/dsh-rp-product-0.1.0-rc.5.tgz
dsh --profile web
```

可从侧栏底部或 DSH 设置打开 **RP 创作室**。创建或编辑多个系统规则、角色、用户 Persona 与世界观，再把分层组合应用到当前空白 Session。普通 DSH Composer、模型选择、Transcript、流式输出、取消、持久化与统计仍由 Host 负责。

## 已知限制

- 第一版本地产品增量负责结构化创作与原生对话组合。Character Card PNG/CHARX 导入、SillyTavern JSONL 导出、Swipe/Regenerate、群聊说话人调度、Regex/STscript 和 Kobold Text Completion 仍属于后续兼容工作。
- 非空 Session 不能切换到 `rp-studio` Agent Preset；中途更换模型可见工具与提示词组合会使已有历史失去一致性，应新建 Session。
- 产品数据原子写入 `$DSH_HOME/rp-product/product-state.json`；这个本地产品包暂不支持替换外部 Storage Provider。
