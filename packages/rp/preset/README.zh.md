# @dsh-rp/preset

[English](README.md) | 中文

`ctx.rpPresets` 持久保存 Prompt 预设，把预设绑定到精确 RP Scope，沿 Scope 父链解析最近绑定，并在 Turn 执行前冻结内容寻址快照。不可变快照包含全部定义和顺序配置、所选配置、有效章节、生成参数、兼容性来源以及精确绑定 Scope。Storage Domain 路由决定持久化后端。核心 Prompt Definition 只拥有 `schemaVersion`、`id`、`name`、`role`、`content` 与 `marker`；适配器专属字段必须由调用方在进入本服务前投影或保留到兼容来源中，严格 Schema 会拒绝任何未声明键。

## 模型体验

由 Turn Pipeline 间接生效：冻结的当前预设章节进入 Agent 请求。

#### KV Cache 影响

未变化的当前预设保持稳定的章节 ID、顺序和内容；保存或激活不同内容会从下一轮起改变请求前缀。

## 已知限制与延后工作

- Provider 专用采样参数在 Agent 或模型 Provider 显式映射前只作为数据保留；Prompt 章节独立生效。
