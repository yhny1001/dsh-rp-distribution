# @dsh-rp/compat-sillytavern

[English](README.md) | 中文

本包提供 Clean-room 的 Character Card V1/V2/V3 JSON、PNG 元数据、有界 CHARX、World Info、Chat Completion Preset 和 Chat JSONL Adapter，默认保持惰性。每种格式都注册为独立的 L0 Component 和 Capability。导入会生成公共 RP IR，并在兼容信封中保留原始 JSON；脚本、Regex 匹配、远程资产和高级激活行为保持惰性。

Chat Completion Preset 导入会保留全部 Prompt 定义和全部 Prompt Manager 顺序配置。存在 `character_id: 100001` 时选择 SillyTavern 全局配置，否则选择源文件中的第一套配置；只有所选配置中启用的条目进入有效 `prompts` 列表。缺失 Prompt 引用、重复标识符和重复顺序 ID 会被拒绝，不会静默漏掉。

每个兼容信封都携带版本化、路径定位的损失报告。报告分别说明源数据是否仍被保留，以及哪些可执行行为被规范化、惰性保留、禁用或省略。Creator Studio 会直接展示这些报告。

JSON 未知字段会无损保留。二进制传输报告独立处理：完成有界解析后，当前会省略 PNG 容器/图像字节以及 CHARX 容器/条目字节，但会保留已声明资产的元数据、字节长度和内容哈希。负零因无法通过 JSON 规范化无损往返而被拒绝。

受检黄金语料固定包含 100 份样本：30 份跨 V1/V2/V3 的 Character Card JSON、15 份 World Info、15 份 Preset、20 份 Chat JSONL、10 份 PNG 卡和 10 份 CHARX。每份样本都固定源哈希、规范化数量、源格式、禁用行为、未知字段标记和二进制传输类型；CI 会重新生成语料描述并拒绝漂移。对抗测试还覆盖原型形状字段、Shell/Secret/Endpoint 载荷、脚本和灾难性 Regex 文本、负零、归档路径穿越，以及 256 次确定性解析器变异；这些输入都不会获得执行、网络、文件系统或 Host 权限。

本包的兼容 Fixture 与聚焦测试负责行为基线，并维护发行版使用的版本无关 IR。

## 模型体验

无，因为导入 Capability 只解析数据，不会自动把源扩展字段加入模型上下文。

#### KV Cache 影响

在其他插件明确选择生成的 IR 前没有影响。

## 已知限制与后续工作

- Export Adapter 仍由后续独立插件提供。
- STscript 与 Quick Reply 执行位于独立、受权限约束的 `@dsh-rp/compat-stscript` L1 插件中；TavernHelper 仍被保留并禁用。
- 本 L0 Importer 有意不实现完整 SillyTavern Runtime 仿真。
