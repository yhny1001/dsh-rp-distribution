# `@dsh-rp/cli`

English | [中文](README.zh.md)

Standalone command-line tooling for DSH RP plugins. Install it independently and run `dsh-rp`, or use the compatibility alias `dsh rp` when the integrated DSH distribution is present.

```sh
pnpm add -D @dsh-rp/cli
pnpm exec dsh-rp init ./my-rp-plugin
pnpm exec dsh-rp validate ./my-rp-plugin
pnpm exec dsh-rp pack ./my-rp-plugin
```

The CLI owns RP scaffolding, validation, migration, evaluation, packaging, SBOM generation, signing, Registry installation, and publication. It does not import the DSH application or modify its source tree.

## Model Experience

None, as the CLI runs outside an Agent session and never assembles a model request.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The `install`, `update`, and `uninstall` commands require a running Host exposing the RP Registry API; offline authoring commands do not.
