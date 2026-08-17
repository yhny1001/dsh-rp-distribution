# @dsh-rp/branches

[English](README.md) | 中文

`ctx.rpBranches` 按作用域维护带修订号校验的分支图和 Swipe 候选。分叉、激活和删除是显式操作，不是覆盖消息。

## 模型体验

通过渲染已选历史和备选续写的分支消费者间接产生影响。

#### KV Cache 影响

只有当前选中分支的表层应进入后续模型请求。

## 已知限制与延期工作

- 持久回放由 Journal Projection 提供；暂不支持分支图合并。
