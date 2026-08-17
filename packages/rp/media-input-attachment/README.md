# `@dsh-rp/media-input-attachment`

English | [中文](README.zh.md)

First-party DSH image-input Adapter for `ctx.rpMedia`. It declares L2 trust and the `attachment.write` permission, validates a complete image batch before publishing any object, stores accepted bytes in the deployment attachment backend, and returns byte-free `attachment:` artifacts plus model image references. Adapter registration and every listener are reversible Cordis effects.

Raw bytes exist only at browser/HTTP ingress and inside the selected Adapter call. Session Events retain immutable content-addressed references, exact dimensions, MIME type, name, and Adapter provenance; Base64 is never journaled. The same reference is used by the Harness Agent, replay projection, Session attachment authorization, and RP Web image gallery.

## Model Experience

Indirectly, through the selected Agent Provider that renders the materialized image reference before the textual RP role request.

#### KV Cache effect

Image blocks may change provider-side multimodal caching. The Adapter adds no text prefix; a Provider without image support fails through its ordinary model capability boundary.

## Known Limitations and Deferred Work

- Version one accepts PNG, JPEG, WebP, and GIF raster images. Audio, video, documents, chunked upload, and remote object-store Adapters remain independent plugins.
- Content-addressed objects published before a later Turn failure can become unreferenced and require deployment garbage collection; they never enter the Session projection without a committed context event.
