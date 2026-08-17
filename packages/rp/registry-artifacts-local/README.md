# `@dsh-rp/registry-artifacts-local`

English | [中文](README.zh.md)

Durable content-addressed archive cache for `ctx.rpRegistry`. The default root is `$DSH_HOME/rp/package-artifacts`; deployments may configure another private root and an archive-size ceiling.

Every write must match its lowercase SHA-256 key. Publication is serialized across processes, writes an owner-only temporary file, flushes it, and renames it into a two-level digest path. Reads reject symlinks, non-regular files, oversized content, and digest mismatches. Registry verifies source evidence before cache publication and gives lifecycle adapters detached copies.

The cache retains archives across plugin unload and Host restart. Unloading only removes its Registry Provider; it does not delete user package data.

## Model Experience

Indirectly, through restored plugin capabilities selected by an Agent or Pipeline.

#### KV Cache effect

None by itself. Cached archives affect context only after verified activation and explicit capability selection.

## Known Limitations and Deferred Work

- File and parent-directory fsync portability remains backend-dependent; the archive file is flushed before rename, but sudden power loss may still require reacquisition.
- Cache eviction, quotas across multiple archives, remote cache replication, and operator repair of abandoned writer locks are separate policy plugins.
