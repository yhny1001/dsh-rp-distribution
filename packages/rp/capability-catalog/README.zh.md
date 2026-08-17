# @dsh-rp/capability-catalog

[English](README.md) | 中文

`ctx.rpCapabilities` 为工具、skill、subagent、agent、流水线、记忆、世界书、媒体和规则适配器提供统一发现目录。目录不替代原注册表；每个可执行贡献都通过桥接，在完成 scope、权限和预算检查后把调用委派回所有者。

`list()` 只返回元数据，并支持种类、scope、标签、权限和信任上限的合取过滤。`invoke()` 要求调用方显式提供权限与信任上限，对描述符预算和调用方预算求交，然后按确定顺序运行可逆 authorizer。Authorizer 只能收窄权限、信任、预算、网络域名和文件根；任何扩权尝试都会 fail closed。

解析后的适配器请求携带不可变的 `effectiveAuthority`。可选的同步审计 Hook 在授权完成、原始适配器执行之前运行，因此 Host 可以持久记录精确决策，而不必建立第二条执行路径。

## 模型体验

通过面向 agent 的消费者间接产生影响，该消费者负责渲染发现到的描述符或调用其所有适配器。

#### KV Cache 影响

目录变化可能改变 agent 消费者的工具或 skill 描述。提示词排序和缓存失效由该消费者负责。

## 已知限制与延期工作

- **仅提供 schema 元数据**——JSON Schema 执行属于拥有外部输入边界的适配器；本目录不会重复校验同进程的类型化值。
