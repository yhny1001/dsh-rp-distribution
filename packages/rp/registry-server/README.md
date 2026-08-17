# `@dsh-rp/registry-server`

English | [中文](README.zh.md)

Self-hosted MIT reference server for open RP package distribution. It stores immutable releases on a local filesystem, publishes a lock-free atomic catalog, validates Manifest, payload SHA-256, hash-bound SBOM, runtime archive shape, and configured Ed25519 publisher keys, and serves the exact response consumed by `@dsh-rp/registry-sources`. It is a publication service, not the Host's installed-package Registry; install, activation, ownership, and rollback remain in `ctx.rpRegistry`.

Each writer takes a cross-process index lock, stages the three release files, renames the complete directory, and then atomically replaces `index.json`. Readers reverify stored evidence before serving it. A repeated identical publication is idempotent; the same package id and version can never be replaced. Package and signing-key revocations are append-only and immediately make matching Manifest, payload, and SBOM routes return HTTP 410.

The package exports a Fetch handler, a Node HTTP adapter, and the `dsh-rp-registry` executable. Mutations are disabled unless `DSH_RP_REGISTRY_PUBLISH_TOKEN` is set. `DSH_RP_REGISTRY_ORIGIN` is the public origin written into evidence URLs, while `DSH_RP_REGISTRY_LISTEN_HOST` and `DSH_RP_REGISTRY_LISTEN_PORT` independently control the private listener behind a reverse proxy. `DSH_RP_REGISTRY_ROOT` selects storage, and optional `DSH_RP_REGISTRY_KEYS` names a JSON file mapping publisher key ids to PEM public keys. Plain HTTP public origins are accepted only for loopback; deploy behind an HTTPS reverse proxy for remote access.

```powershell
$env:DSH_RP_REGISTRY_ORIGIN='http://127.0.0.1:3090'
$env:DSH_RP_REGISTRY_ROOT='data/rp-registry'
$env:DSH_RP_REGISTRY_PUBLISH_TOKEN='replace-with-a-secret'
pnpm exec dsh-rp-registry
```

Publish the same strict SDK release used by local, Git, and npm acquisition:

```powershell
$env:DSH_RP_REGISTRY_TOKEN='replace-with-a-secret'
dsh rp publish ./my-rp-plugin --registry http://127.0.0.1:3090
```

Public endpoints are `GET /`, `GET /api/rp/v1/catalog`, `GET /api/rp/v1/revocations`, and `GET /api/rp/v1/packages/{id}/{version}` plus immutable `/payload` and `/sbom` resources. Bearer-protected mutation endpoints are `POST /api/rp/v1/releases`, `POST /api/rp/v1/revocations/packages`, and `POST /api/rp/v1/revocations/keys`. The HTML catalog contains no script and ships a restrictive CSP.

## Model Experience

None, as this standalone service stores and serves package evidence and never assembles a model request.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The reference store coordinates writers sharing one filesystem. Multi-region replication, transparency logs, vulnerability scanning, delegated publisher administration, rate limiting, object-store backends, and external identity-provider authentication remain replaceable deployment concerns.
- The executable buffers one bounded request or response in memory. The repository and Fetch handler are reusable behind a streaming or object-storage adapter when deployments need larger artifacts.
- Revocations prevent new downloads immediately, but already running Hosts must mirror or otherwise receive the revocation feed before their local Registry can stop an installed package.
