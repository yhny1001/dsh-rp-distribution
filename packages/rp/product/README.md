# `@dsh-rp/product`

English | [中文](README.zh.md)

Local-first RP product surface for an installed DSH `0.1.0-rc.6` Web profile. One self-contained Bundle registers the Node API, an `rp-studio` native Agent preset, a Chinese-first management workspace, a Session header control, and an additive composer context strip.

The product keeps five model inputs separate throughout storage, UI, and system-prompt assembly:

1. **System rules** define how the model responds and the boundaries it must obey.
2. **World** defines environment, history, locations, and objective rules.
3. **Characters** define who the model portrays; a Session can select a primary character and supporting cast.
4. **User persona** defines who the human is inside the story and never transfers that identity to the model.
5. **Scene** defines only the current Session situation.

Every DSH Session has an explicit composition binding. Applying a composition to a blank Session switches it to the shipped `rp-studio` Agent preset; later catalog and scene edits are read again at each native AgentLoop prompt assembly. The plugin never starts a second model loop.

## Local installation

```sh
pnpm run build
pnpm --dir packages/rp/product pack --pack-destination /tmp/dsh-rp-product
dsh plugin --profile web add /tmp/dsh-rp-product/dsh-rp-product-0.1.0-rc.5.tgz
dsh --profile web
```

Open **RP Studio** from the sidebar footer or DSH Settings. Create or edit multiple system profiles, characters, user personas, and worlds, then bind a layered composition to the current blank Session. The ordinary DSH composer, model selector, transcript, streaming, cancellation, persistence, and statistics remain Host-owned.

## Known limitations

- The first local product increment owns structured authoring and native conversation composition. Character Card PNG/CHARX import, SillyTavern JSONL export, swipe/regenerate, group-speaker scheduling, regex/STscript, and Kobold Text Completion remain separate compatibility work.
- A non-blank Session cannot switch into the `rp-studio` Agent preset because changing its model-visible tool and prompt composition would invalidate earlier history. Create a new Session instead.
- Product data is stored atomically under `$DSH_HOME/rp-product/product-state.json`; external storage Providers are not yet selectable for this local product package.
