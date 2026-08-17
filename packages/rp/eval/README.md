# `@dsh-rp/eval`

English | [中文](README.zh.md)

`@dsh-rp/eval` validates bounded `rp.eval.json` suites, restores each exact Session Event log through the Harness Session boundary, folds it twice with `@dsh-rp/projection`, and compares content-addressed golden assertions. Object keys are sorted before SHA-256 hashing, so hashes do not depend on property insertion order.

Known RP events must be required. Unknown extension events are accepted only with `ignorable: true`; malformed envelopes, non-contiguous sequence numbers, duplicate ids, and unbounded suites fail before replay. A scenario is settled by default: no Pipeline or Agent may remain running, no capability may remain merely authorized, and no state, memory, or media proposal may remain open. Set `expected.settled` to `false` only when the open lifecycle is the subject of the fixture.

`dsh rp test` automatically evaluates `rp.eval.json` in the package root after the runtime package builds and before an optional package `test` script runs. The pure `evaluateRpSuite` API is available to CI systems that do not use the CLI.

## Model Experience

None, as the package only evaluates recorded outcomes and never assembles prompts, tools, or provider requests.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Golden replay evaluates durable outcomes and lifecycle integrity; it does not make a live model call or grade subjective prose quality.
- Fixture files are limited by the CLI JSON bound and by 256 scenarios with 100,000 events per scenario. Large production corpora should shard suites across CI jobs.
