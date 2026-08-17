# `@dsh-rp/distribution-web`

English | [中文](README.zh.md)

Browser integration layer for the standalone RP runtime. Layer it after `@deepseek-ai/dsh-web-app` and `@dsh-rp/distribution-core`; it mounts only the installable RP UI-slot registry and the RP Studio/conversation plugin.

Keeping this layer separate prevents Headless profiles from resolving React, browser client modules, or Web Host APIs.

## Model Experience

None, as the Web plugin starts user-selected RP turns while RP consumers own all model-facing content.

#### KV Cache effect

None directly.

## Known Limitations and Deferred Work

- This package requires the DSH Web conversation-submission and RP slot extension points listed in the release compatibility matrix; unsupported Host versions fail compatibility checks instead of receiving implicit source mutations.
