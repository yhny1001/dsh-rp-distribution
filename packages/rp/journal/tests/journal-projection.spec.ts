import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { RpCompositionId, RpPipelineId, RpTurnId } from '@dsh-rp/contracts'
import RpJournal, { RP_JOURNAL_EVENT_TYPES } from '../src/index.ts'

describe('@dsh-rp/journal', () => {
  it('exports the required runtime event vocabulary for bounded consumers', () => {
    expect(Object.isFrozen(RP_JOURNAL_EVENT_TYPES)).toBe(true)
    expect(RP_JOURNAL_EVENT_TYPES).toContain('rp/turn-committed')
    expect(RP_JOURNAL_EVENT_TYPES).toContain('rp/pipeline-stage')
    expect([...RP_JOURNAL_EVENT_TYPES]).toHaveLength(26)
  })

  it('commits one complete event at the local transaction boundary', async () => {
    const ctx = new Context()
    await ctx.plugin(RpJournal)
    const session = Session.create(SessionId('rp-journal'))
    const turnId = RpTurnId('turn-1')
    const event = ctx.rpJournal.commitTurn(session, {
      schemaVersion: 1,
      turnId,
      composition: {
        turnId, compositionId: RpCompositionId('c'.repeat(64)), componentIds: ['actor'],
        scope: { kind: 'conversation', id: 'c' },
      },
      pipeline: { turnId, pipelineId: RpPipelineId('turn.default'), snapshotHash: 'p'.repeat(64), kind: 'turn' },
      assistantMessage: 'Hello',
      state: { schemaVersion: 1, revision: 1, owner: 'state', value: { mood: 'calm' } },
      memories: [{ schemaVersion: 1, id: 'm1', owner: 'character', content: 'Met the user', salience: 0.8, createdAt: 1 }],
      branch: { id: 'b1', active: true, message: 'Hello' },
      committedAt: 2,
    })
    expect(event.type).toBe('rp/turn-committed')
    expect(session.events.filter(item => item.type === 'rp/turn-committed')).toHaveLength(1)
  })
})
