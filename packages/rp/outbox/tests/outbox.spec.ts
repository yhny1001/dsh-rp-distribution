import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import RpOutbox from '../src/index.ts'

describe('RP outbox', () => {
  it('deduplicates work and retries without duplicating a completed effect', async () => {
    const outbox = new RpOutbox(new Context()); let calls = 0
    outbox.register({ id: 'media', execute: async () => { calls++; if (calls === 1) throw new Error('transient'); return { uri: 'asset://1' } } })
    const request = { idempotencyKey: 'turn:1:image', handler: 'media', scope: { kind: 'turn' as const, id: '1' }, payload: { prompt: 'moon' } }
    expect(outbox.enqueue(request)).toBe(outbox.enqueue(request))
    expect((await outbox.dispatch(request.idempotencyKey)).status).toBe('pending')
    expect((await outbox.dispatch(request.idempotencyKey)).status).toBe('completed')
    expect((await outbox.dispatch(request.idempotencyKey)).status).toBe('completed'); expect(calls).toBe(2)
  })

  it('compensates completed saga steps in reverse order', async () => {
    const outbox = new RpOutbox(new Context()); const events: string[] = []
    outbox.register({
      id: 'ok',
      execute: async (entry) => {
        events.push(`do:${(entry.payload as { id: string }).id}`)
        return true
      },
      compensate: async (entry) => {
        events.push(`undo:${(entry.payload as { id: string }).id}`)
      },
    })
    outbox.register({ id: 'fail', execute: async () => { throw new Error('boom') } })
    const outcome = await outbox.saga('s1', [
      { id: 'a', request: { idempotencyKey: 'a', handler: 'ok', scope: { kind: 'turn', id: 't' }, payload: { id: 'a' } } },
      { id: 'b', request: { idempotencyKey: 'b', handler: 'ok', scope: { kind: 'turn', id: 't' }, payload: { id: 'b' } } },
      { id: 'c', request: { idempotencyKey: 'c', handler: 'fail', scope: { kind: 'turn', id: 't' }, payload: null, maxAttempts: 1 } },
    ])
    expect(outcome).toMatchObject({ status: 'failed', compensated: ['b', 'a'] }); expect(events).toEqual(['do:a', 'do:b', 'undo:b', 'undo:a'])
  })
})
