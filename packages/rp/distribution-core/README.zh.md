# `@dsh-rp/distribution-core`

[English](README.md) | 中文

独立 RP 运行时的无界面 DSH 组合包。把它放在 `@deepseek-ai/dsh-base` 之后，即可挂载角色、Persona、Lore、记忆、状态、场景、关系、分支、Prompt、Agent、Pipeline、Registry、策略、包运行时与兼容适配器，而不会加载浏览器代码。

Headless 部署直接使用这个组合包；Web 部署也先挂载它，再挂载 Web 接入层。

## 模型体验

通过当前 Experience 选中的 RP 消费者间接影响模型体验。

#### KV Cache 影响

这个组合包自身不增加上下文；每个被挂载的消费者分别负责自己的缓存影响。

## 已知限制和后续工作

- 持久记忆 Provider 需要 Host 提供 storage-domain 后端；基础 Profile 未挂载该后端时，部署方必须在后续组合包或 Profile Patch 中补充。
