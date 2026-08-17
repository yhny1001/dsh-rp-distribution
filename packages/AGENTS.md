# Package rules

These rules supplement the repository-wide [AGENTS.md](../AGENTS.md).

- A package owns one public plugin role or one intentional composition layer.
- Registrations are reversible effects. Registries return exact disposers, and lifecycle tests prove cleanup.
- Import sibling plugins by `@dsh-rp/*`, never by source-relative paths.
- Declare every runtime `@deepseek-ai/*` import as an exact peer dependency. Do not copy Host implementations or add runtime compatibility shims.
- Keep Core packages browser-independent. React and DSH browser-service imports belong only to Web packages.
- Package exports expose built `lib/` entries and declarations. Source files and source maps are not public payloads.
- Public APIs, configuration, errors, and non-obvious lifecycle behavior require concise JSDoc and matching English/Chinese README updates.
- Add focused unit coverage for behavior changes. Full DSH application assembly remains in the Host repository.
