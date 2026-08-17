# `@dsh-rp/package-runtime`

English | [中文](README.zh.md)

Strict, shared package boundary for executable RP archives. A package selected for runtime activation must contain `rp.runtime.json`, opt into `compatibility.runtime = "dsh-rp-runtime-v1"`, and exactly match the components and capabilities declared by its integrity-bound Manifest.

The reader accepts tar-gzip payloads, including npm's single `package/` prefix. It bounds decompressed bytes, file count, and per-file bytes; rejects traversal, absolute paths, duplicate entries, links, special files, invalid UTF-8, unknown descriptor fields, missing assets, declaration drift, and implementation kinds incompatible with the package trust level. Returned file bytes are detached copies.

The writer sorts paths, canonicalizes the descriptor, fixes tar metadata, emits byte-stable gzip, and must pass its output through the same strict reader. npm publication uses an outer tarball containing `package.json`, `rp.package.tgz`, and `rp.sbom.json`; the bounded envelope reader checks embedded `dshRp` metadata and returns only the inner evidence. L0, L1, and L2 lifecycle plugins separately own registration, authorization, execution, and cleanup.

## Runtime descriptor

`rp.runtime.json` uses `schemaVersion: 1`. Its component and capability id sets must exactly equal the Manifest declarations. Every entry declares supported scopes; capabilities also declare discovery metadata, optional permissions and budgets, and at most one implementation.

The optional `pipelines` array contains code-free Turn, Workflow, or Sidecar DAGs. Every graph id must exactly match one capability with kind `pipeline`; that capability omits an implementation because invocation routes through `ctx.rpPipelines`. Package stages may invoke a Capability, invoke another Pipeline, or evaluate a JSON equality condition, with explicit ordering, timeout, retry, and failure policy.

The optional `uiSlots` array contains sandboxed package UI descriptors. Its ids must exactly match Manifest `uiSlots`; every entry and subresource must also appear in Manifest `assets`. Runtime v1 UI is HTML/CSS-only at every trust level. The reader parses each entry and rejects script, frames, forms, embedded objects, SVG/MathML documents, event handlers, navigation attributes, external URLs, and undeclared local references before activation.

```json
{
  "schemaVersion": 1,
  "components": [],
  "capabilities": [{
    "id": "example.quickjs",
    "kind": "tool",
    "title": "Example",
    "description": "Returns structured JSON.",
    "scopes": ["conversation"],
    "permissions": ["script.execute"],
    "implementation": { "kind": "quickjs", "path": "runtime/example.js" }
  }]
}
```

L0 accepts `expression`; L1 accepts `quickjs` and `wasm`; L2 accepts `native`. Implementation files and every Manifest asset must be regular files inside the same archive. Unknown fields fail closed instead of becoming ambient configuration.

## Model Experience

None, as the package parses verified archives and registers no model surface.

#### KV Cache effect

None. Runtime consumers decide whether an activated capability affects a model request.

## Known Limitations and Deferred Work

- The v1 transport is tar-gzip only; alternate content-addressed bundle encodings require a new compatibility version.
- Archive authenticity, signing-key trust, SBOM binding, and source acquisition remain Registry responsibilities and must complete before runtime activation.
