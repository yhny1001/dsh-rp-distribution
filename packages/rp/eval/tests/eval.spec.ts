import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluateRpSuite, hashRpEvalValue } from '../src/index.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/golden-session.json', import.meta.url), 'utf8')) as unknown

describe('@dsh-rp/eval', () => {
  it('replays a content-addressed golden Session deterministically', () => {
    const report = evaluateRpSuite(fixture)
    expect(report.valid).toBe(true)
    expect(report.scenarios).toHaveLength(1)
    expect(report.scenarios[0]).toMatchObject({
      id: 'directed-turn',
      passed: true,
      projectionSha256: '4448ac33195bf6b95ecf445742ef54d930ef07ef2ff40c553e5a48805b21d083',
      eventLogSha256: 'b47fe556df404533638b7b4bf12406c710a4b4a9a223a9b4c6eb73bc3978b584',
    })
    expect(report.scenarios[0]?.projection?.pipelines).toMatchObject([{
      pipelineId: 'turn.directed', status: 'completed', stages: [{ stageId: 'actor', outcome: 'completed' }],
    }])
  })

  it('canonicalizes object keys before hashing', () => {
    expect(hashRpEvalValue({ alpha: 1, nested: { beta: true, gamma: null } })).toBe(
      hashRpEvalValue({ nested: { gamma: null, beta: true }, alpha: 1 }),
    )
  })

  it('rejects discontinuous envelopes and unknown required facts before replay', () => {
    expect(evaluateRpSuite({
      schemaVersion: 1,
      scenarios: [{
        schemaVersion: 1,
        id: 'invalid-log',
        events: [{ type: 'rp/future-required', seq: 1, time: 0, data: {} }],
        expected: { counts: { turns: 0 } },
      }],
    })).toMatchObject({
      valid: false,
      passed: false,
      diagnostics: [
        { path: 'scenarios[0].events[0].seq' },
        { path: 'scenarios[0].events[0].type' },
      ],
    })
  })

  it('rejects misspelled suite and scenario fields instead of silently ignoring assertions', () => {
    expect(evaluateRpSuite({
      schemaVersion: 1,
      scenario: [],
      scenarios: [{ schemaVersion: 1, id: 'typo', events: [], expects: {}, expected: { settled: true } }],
    })).toMatchObject({
      valid: false,
      diagnostics: [
        { path: '$.scenario' },
        { path: 'scenarios[0].expects' },
      ],
    })
  })

  it('detects open lifecycle work unless a scenario explicitly expects it', () => {
    const suite = {
      schemaVersion: 1,
      scenarios: [{
        schemaVersion: 1,
        id: 'open-pipeline',
        events: [{
          type: 'rp/pipeline-started', seq: 0, time: 0,
          data: { turnId: 'turn-open', pipelineId: 'sidecar.open', snapshotHash: 's'.repeat(64), kind: 'sidecar' },
        }],
        expected: { settled: false },
      }],
    }
    expect(evaluateRpSuite(suite)).toMatchObject({ passed: true, scenarios: [{ passed: true }] })
    suite.scenarios[0]!.expected.settled = true
    expect(evaluateRpSuite(suite)).toMatchObject({
      passed: false,
      scenarios: [{ passed: false, diagnostics: [{ path: 'expected.settled' }] }],
    })
  })
})
