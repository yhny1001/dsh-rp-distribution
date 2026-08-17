# @dsh-rp/sdk

English | [中文](README.zh.md)

Pure package tooling used by `dsh rp` and the reference registry. It validates untrusted `rp.package.json` files, produces deterministic SHA-256 identities, hashes and verifies JSON SBOMs, signs and verifies canonical manifests with Ed25519, migrates the explicit schema-version-0 format, and creates L0 starter manifests.

`buildRpPackage()` creates a deterministic runtime archive, replaces stale integrity metadata with the archive digest, binds a CycloneDX SBOM, optionally signs the final Manifest, and verifies the result through the install-time reader. It enforces descriptor permissions and requires an Ed25519 signer for L2 releases. The returned Manifest, archive, and SBOM map directly to `rp.package.json`, `rp.package.tgz`, and `rp.sbom.json`.

Validation never loads package code and unknown fields do not grant capabilities.

`dsh rp init --template ui-panel` creates an L0 installable UI package whose entry and stylesheet are declared in both the Manifest and runtime descriptor. `dsh rp validate`, `build`, `test`, and `pack` apply the same path, declaration, trust, and script-permission checks used during Host activation. `dsh rp test` also evaluates a package-root `rp.eval.json` through `@dsh-rp/eval` before it runs the optional package test script.

## Model Experience

None, as the SDK does not assemble model requests or prompt content.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The SDK verifies SBOM identity but does not perform vulnerability-database analysis; scanners remain independent policy plugins.
- Private-key custody, transparency logs, timestamping, and remote signer integrations remain deployment concerns.
- Migration intentionally accepts only schema versions 0 and 1.
