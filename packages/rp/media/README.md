# `@dsh-rp/media`

English | [中文](README.zh.md)

Replaceable media generation Provider and input-Adapter registry with declared trust and permissions, deterministic routing, cancellation, bounded artifact validation, and a built-in L0 SVG scene-card Provider. Input Adapters receive byte-free descriptors for matching, validate whole batches, and materialize durable artifacts into model references without exposing source bytes to the capability catalog.

## Model Experience

Indirectly, through an authorized Agent that invokes `rp.media.generate` and explicitly attaches or describes the generated artifact.

#### KV Cache effect

The registry adds no prompt prefix. Agent-authored descriptions or attachment metadata determine any later cache effect.

## Known Limitations and Deferred Work

- Raster image, audio, video, and document generation require independently installed Providers. Image ingress ships through [`@dsh-rp/media-input-attachment`](../media-input-attachment); other input kinds require independent Adapters. Studio rendering must retain its iframe and CSP sandbox for all artifact content.
