# @dsh-rp/web

English | [中文](README.zh.md)

`@dsh-rp/web` provides the DSH Web RP Studio and the shared Headless/Web Host API. The Studio includes Experience inventory, Pipeline and authorization inspection, a transactional Plugin Manager, a replay-backed live-Session Timeline, and Creator import previews for Character Card JSON/PNG/CHARX, World Info, presets, and chat JSONL.

The Plugin Manager invokes the Host Registry rather than loading packages in the browser. Install, exact-graph update, and confirmed uninstall expose source, version lock, owners, lifecycle, trust, permissions, content hash, signer revocation, SBOM, and evidence policy. Creator imports preserve unknown fields and compatibility warnings while keeping imported scripts and remote assets inert. Creator's preset flow uses the same Host runtime as Headless clients: it previews a JSON source, explicitly projects SillyTavern definitions to the core preset's owned `schemaVersion`, `id`, `name`, `role`, `content`, and `marker` fields, persists the server-side normalized record, activates it for the current live RP Session, and restores the exact binding after refresh or Host restart. `systemPrompt`, `forbidOverrides`, and injection metadata remain with compatibility provenance rather than crossing the core package boundary as undeclared fields.

Installable package UI is projected from `ctx.rpUiSlots`, never loaded into the main React origin. Package assets use strict MIME types, `nosniff`, and restrictive CSP. Package iframes receive no scripts, same-origin privilege, Session props, or Host bridge.

## Playable Web conversation

The shipped client registers a general conversation submission handler instead of replacing the resident DSH composer. Every live Session starts in RP mode with `rp-adaptive`. A unified Conversation Mode selector appears in the new-session hero beside the Agent preset and can choose ordinary Agent submission or any registered `RP · Experience`; existing Sessions expose the same selector in the Session header. RP is no longer hidden in the composer's bottom-right controls. RP submission therefore retains the existing draft transaction, keyboard behavior, and extension seats. Selected images are explicitly encoded only after the RP route wins, admitted through the Host's pluggable media-input Adapter under effective trust and `attachment.write` authority, and restored with the text if any stage rejects.

One apply-scoped controller owns per-Session mode, Experience, request, error, replay, and cancellation state. It sends `sessionId` as the matching Agent identity, never sends authority, and aborts the exact transport when the user cancels or the Session disappears. A definite failure gets a fresh request id on the next send. `DURABILITY`, an invalid success response, or an ambiguous network failure locks the original payload and request id; only an unchanged retry is admitted, preventing a second semantic Turn while the first delivery is uncertain.

The composer dock shows running/cancel, public failures, unchanged-retry guidance, and the latest durable commit. The `RP` conversation tab correlates `rp/context-activated` and `rp/turn-committed` by `turnId` to reconstruct user/Assistant exchanges and authorized images, then exposes the complete detached Agent/Pipeline event trace. Studio's Timeline page follows the latest browser Turn while retaining manual Session lookup. Session removal prunes its stores and aborts both Turn and Timeline requests; plugin unload removes the submission route, UI seats, stores, and transports.

The browser uses same-origin `/api/rp/v1` routes and does not embed or persist a deployment bearer secret. Loopback Web works directly. A non-loopback deployment that enables `turnApi.bearerToken` must supply the Authorization header through its authenticated proxy/client transport; exposing that deployment secret in the public client bundle is intentionally unsupported.

## Turn API

`POST /api/rp/v1/turn` and the in-process `executeRpTurn()` function execute the same business path:

`live Agent → Experience → frozen Turn Pipeline → effects validation → atomic Session commit → persistence flush → replay projection`

The request carries `schemaVersion: 1`, a unique `requestId`, matching `sessionId` and `agentId`, optional `experienceId` and scope, JSON input, optional bounded image transport values, and optional client context. It cannot carry permissions, trust, budget, network domains, file roots, or another authority field. The Host derives effective authority from deployment configuration and registered policy layers.

The named Session and its exact owning Agent must already be live. A supplied scope must stay inside that Session's conversation chain; an Agent scope must name the same Agent. The API deliberately does not create or resume identities. It enters the Agent's maintenance phase, so a normal Agent Loop turn, another RP Turn, or maintenance work on that Agent returns `BUSY` instead of racing the same Session.

`requestId` is idempotent over the normalized payload. An identical retry replays the existing commit without invoking the Agent again; payload drift is a conflict, and an aborted id cannot be reused. Cancellation before commit appends `rp/turn-aborted` and leaves no assistant, state, or memory partial commit.

A successful response is returned only after at least one Session persistence listener participates and all listeners settle successfully. `DURABILITY` means the Turn committed in memory but the persistence result is uncertain. The only supported retry is the identical payload with the same `requestId`; the retry re-runs the flush barrier and never re-executes the committed Agent turn.

HTTP requests must be JSON and are size-bounded; the same normalized-size limit applies to in-process Headless calls. Cross-site requests are rejected. A deployment bearer token is mandatory whenever the WebServer is not bound to `localhost`, `127.0.0.0/8`, or `::1`; when configured on loopback, it is still required. Internal causes are logged but never returned to the client.

### Deployment configuration

`turnApi` defaults to enabled with `rp-adaptive`, all first-party Experiences, trust ceiling `L2`, permissions `rp.pipeline.execute`, `agent:spawn`, and `attachment.write`, a 60-second/128k-token/64-tool/8-agent budget, no network or file grants, and an 8 MiB body limit (configurable up to 32 MiB). `defaultExperience` must appear in `allowedExperiences`; duplicate or unnormalized authority values and short bearer tokens fail plugin activation. Base64 exists only in this bounded transport body: the Journal, projection, Agent trace, and response retain immutable attachment references.

The HTTP failure mapping is `400` invalid request, `403` admission or authority denial, `404` missing live identity or Experience, `409` conflict or busy Agent, `499` cancellation, `503` uncertain durability, and `500` contained execution failure.

## Other Host routes

Catalog, Timeline, Registry, Creator, and preset routes expose detached JSON snapshots. Catalog requests return lightweight summaries; id-addressed GET requests return complete normalized IR only when an editor opens. POST can save imported source, replace a Character Card, Persona, lorebook, or preset in place under the same id, activate or deactivate an exact staged-or-live conversation scope, or remove a resource. Preset updates rebuild the executable Turn Prompt from the selected order and definitions while retaining the current Session binding. Library assets use the same pre-composition rule, so a new conversation can complete its bindings before its first live Agent Session is materialized. Turn execution still requires that exact live Session. Mutation and import requests are bounded; browser mutations reject cross-site callers. Source and execution authority remain with deployment-registered Providers and lifecycle adapters.

In RP mode the conversation UI exposes these routes as a three-column flow: the left resource rail imports, binds, and selects assets for editing; the center renders the standard durable chat transcript; and the right rail provides structured Character Card, Persona, lorebook, and preset editors alongside the composition and event inspector. Saving preserves unknown compatibility fields, stable resource ids, and Session bindings. The replay tab remains the authoritative RP Journal view and includes the exact frozen Prompt and snapshots used by each Turn.

## Model Experience

None, as this package adds no model-visible prompt or schema; a selected Experience owns any Agent, Tool, Skill, Subagent, Workflow, Pipeline, or model call.

#### KV Cache effect

The package adds no cache-prefix content. Cache reuse follows the selected Experience and its frozen context, composition, and Pipeline snapshots; an idempotent replay makes no model call.

## Known Limitations and Deferred Work

- The Turn API returns one terminal JSON result; token and stage streaming remain a separate transport plugin.
- Agent creation/resume and authentication-account mapping remain Host-owned capabilities rather than implicit Turn API behavior.
- Rich graph layout, incremental token/stage streaming, and live Timeline push remain separate plugins over the same Host data.
