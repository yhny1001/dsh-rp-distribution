# @dsh-rp/branches

English | [中文](README.zh.md)

`ctx.rpBranches` owns a revision-checked branch graph and swipe candidates per scope. Fork, activation, and removal are explicit operations rather than message overwrites.

## Model Experience

Indirectly, through the branch consumer that renders the selected history and alternate continuations.

#### KV Cache effect

Only the selected branch surface should enter subsequent model requests.

## Known Limitations and Deferred Work

- Durable replay is supplied by journal projection; graph merge is intentionally unsupported.
