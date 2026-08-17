# Preset Definition 包边界投影

日期：2026-08-17。状态：已在本地实现。

## 问题

`@dsh-rp/compat-sillytavern` 的 Prompt Definition 为保真导入拥有 `systemPrompt`、`forbidOverrides` 与 Injection 元数据，而核心 `@dsh-rp/preset` 的 Definition 只拥有 `schemaVersion`、`id`、`name`、`role`、`content` 和 `marker`。Web Creator 的 `toPresetRecord()` 直接传递整个适配器 IR，导致核心严格 Zod Schema 在保存时以 `unrecognized_keys` 拒绝所有定义。Product 专项测试没有覆盖这条跨包 Creator 路径，GitHub CI 的 `packages/rp/web/tests/preset-api.spec.ts` 因而成为唯一失败测试。

## 决策

不扩宽核心 Preset Schema，也不增加静默剥离兼容键的 Core 回退。Web 边界显式构造核心 Definition，只复制六个归属字段；SillyTavern 专属数据继续由兼容 IR、来源文档和 Product 适配资源拥有。该投影使适配器知识留在 Adapter/Web Consumer，不让核心持久服务依赖 ST 字段，同时保留 Prompt 内容、Role、Marker、完整顺序、启停和生成参数。

## 验证

跨包测试输入现在包含 `system_prompt`、`forbid_overrides`、`injection_position`、`injection_depth`、`injection_order` 与 `injection_trigger`，并断言保存后的核心 Definition 精确等于六字段记录且不含兼容键；保存、激活、原位编辑、Host 重启恢复和停用路径继续通过。验证依次运行原失败测试、完整 `pnpm run check` 与 `pnpm run release:verify`，然后推送并等待 GitHub Actions 通过。
