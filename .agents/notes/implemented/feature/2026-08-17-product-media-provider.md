# Product media Provider and scene Gallery

Date: 2026-08-17. Status: implemented locally.

## Decision

Media generation uses the repository's existing `@dsh-rp/media` Provider registry. To preserve one-Tarball product installation, the build adds an `@dsh-rp/product/media` sub-entry. Its independent Node compilation face inlines Media/Contracts while externalizing the Host's `@deepseek-ai/cordis`. Bundle Patch mounts Media Service before Product. External image, audio, video, or document Providers continue to extend the same `rpMedia.register()` service without changing Product Agent or Client.

`rp_list_media_providers` exposes a read-only Provider catalog. `rp_generate_media` accepts Image/Audio, runs registry validation, deterministic routing, and cancellation, then records Artifact id, kind, MIME, URI, and metadata in a `media` Runtime Effect. The Effect carries Tool Call Turn/Step/Seq so native Fork clips media correctly. `<rp-dynamic-state>` strips URI and metadata and exposes only artifact identity to later rounds, preventing a 4 MiB Data URI from damaging Prompt and KV cache behavior.

RP Conversation extracts at most eight current Artifacts. Data/HTTPS images enter a bounded `<img>`, audio enters native `<audio controls>`, and attachment URIs render a Provider notice; history retains structured records. Every character message also exposes user-triggered browser-local **Read aloud**, which cancels previous speech, uses `zh-CN`, and neither uploads nor claims to create a durable audio artifact.

## Verification

The media subplugin test proves built-in `svg-card` catalog, a 1024×576 SVG Artifact, Data URI, and the explicit missing-audio-Provider error. Agent Tool tests prove Provider listing, generated Effect, Gallery data, and absence of Data URI from model context. The actual Tarball includes standalone `lib/media.js`. In the isolated Harness, Kaon calls catalog and generate to create SVG scene card “黑海岸警钟”; RP Conversation renders `SCENE MEDIA`, MIME, and the real image. Native Conversation exposes Tool plus Artifact id without expanding the Data URI. Four character-message **Read aloud** controls click without error in the Codex in-app browser.
