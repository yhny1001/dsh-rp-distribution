# RP plugin packages

English | [中文](README.zh.md)

`rp/` contains the complete independently released `@dsh-rp/*` plugin family. Every child directory is one public npm package; there are no DSH application or Host packages in this workspace.

Internal package relationships use `workspace:^`. Cordis and DSH services are exact external peers supplied by the installed Host. The Core, Web, and combined distribution bundles are `@dsh-rp/distribution-core`, `@dsh-rp/distribution-web`, and `@dsh-rp/distribution`.

See the repository [architecture](../docs/architecture.md), [Host compatibility](../docs/compatibility.md), and root [development guide](../README.md#development).
