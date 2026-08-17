# `@dsh-rp/eval`

[English](README.md) | 中文

`@dsh-rp/eval` 校验有界的 `rp.eval.json` 套件，通过 Harness Session 边界恢复每份精确的 Session Event 日志，使用 `@dsh-rp/projection` 独立折叠两次，并比较内容寻址的黄金断言。计算 SHA-256 前会排序对象键，因此哈希不依赖属性插入顺序。

已知 RP 事件必须是必需事件。未知扩展事件只有声明 `ignorable: true` 才会被接受；格式错误的信封、不连续的序号、重复 id 和超界套件都会在回放前失败。场景默认必须完全收敛：Pipeline 或 Agent 不得仍在运行，Capability 不得停留在仅授权状态，State、Memory 或 Media 提案不得仍处于开放状态。只有当开放生命周期本身就是夹具目标时，才将 `expected.settled` 设为 `false`。

`dsh rp test` 会在构建运行时包之后、执行可选的 package `test` 脚本之前，自动评测包根目录中的 `rp.eval.json`。不使用 CLI 的 CI 系统可以直接调用纯函数 `evaluateRpSuite`。

## 模型体验

无，因为本包只评测已记录结果，不组装 Prompt、Tool 或 Provider 请求。

#### KV Cache 影响

无。

## 已知限制与后续工作

- 黄金回放评测持久化结果和生命周期完整性；它不会发起实时模型调用，也不会评价主观文本质量。
- 夹具文件受 CLI JSON 大小限制，单套件最多包含 256 个场景、每场景最多 100,000 个事件。大型生产语料应拆分到多个 CI 作业。
