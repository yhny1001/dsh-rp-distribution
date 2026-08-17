// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSubmissionRequest } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { RpWebTurnController } from '../src/client/turn-controller.ts'

afterEach(() => { vi.unstubAllGlobals() })

const sessionId = 'session-rp' as SessionId
const submission = (text = 'Open the door'): ConversationSubmissionRequest => ({
  sessionId,
  text,
  imageIds: [],
  mode: 'queue',
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new Error('expected a JSON string request body')
  return init.body
}

function turn(requestId: string) {
  return {
    schemaVersion: 1,
    requestId,
    replayed: false,
    sessionId,
    agentId: sessionId,
    experienceId: 'rp-adaptive',
    turnId: 'turn-1',
    eventSeq: 8,
    assistantMessage: 'The door opens.',
    authority: { permissions: [], trust: 'L0', budget: {}, layers: [] },
    projection: { history: [] },
  }
}

describe('RP Web Turn controller', () => {
  it('owns RP mode by default, commits one request, then refreshes the replay timeline', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestUrl(input).endsWith('/turn')) return json(turn('request-1'))
      expect(JSON.parse(requestBody(init)) as unknown).toEqual({ sessionId })
      return json({ sessionId, events: [], projection: { turns: [] } })
    })
    vi.stubGlobal('fetch', fetcher)
    const controller = new RpWebTurnController('/api/rp/v1', () => 'request-1')

    expect(controller.matches(submission())).toBe(true)
    await controller.submit(submission())
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/rp/v1/turn', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(requestBody(fetcher.mock.calls[0]?.[1])) as unknown).toMatchObject({
      requestId: 'request-1',
      sessionId,
      agentId: sessionId,
      experienceId: 'rp-adaptive',
      input: { text: 'Open the door' },
    })
    await vi.waitFor(() => {
      expect(controller.storeFor(sessionId).getSnapshot()).toMatchObject({
        phase: 'idle', timelinePhase: 'ready', response: { assistantMessage: 'The door opens.' },
      })
    })
    expect(controller.latest.getSnapshot()).toMatchObject({ sessionId, state: { requestId: 'request-1' } })
    controller.dispose()
  })

  it('reuses an exact request id after an uncertain durability response', async () => {
    let turnCalls = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (requestUrl(input).endsWith('/timeline')) {
        return json({ sessionId, events: [], projection: { turns: [] } })
      }
      turnCalls += 1
      return turnCalls === 1
        ? json({ error: { code: 'DURABILITY', message: 'flush uncertain', retryWithSameRequestId: true } }, 500)
        : json({ ...turn('request-fixed'), replayed: true })
    })
    vi.stubGlobal('fetch', fetcher)
    const controller = new RpWebTurnController('/api/rp/v1', () => 'request-fixed')

    await expect(controller.submit(submission())).rejects.toThrow('flush uncertain')
    expect(controller.storeFor(sessionId).getSnapshot()).toMatchObject({
      phase: 'error', error: { code: 'DURABILITY', retryWithSameRequestId: true },
    })
    await expect(controller.submit(submission('edited'))).rejects.toThrow(/resend the unchanged draft/)
    await controller.submit(submission())
    const turnBodies = fetcher.mock.calls
      .filter(call => requestUrl(call[0]).endsWith('/turn'))
      .map(call => JSON.parse(requestBody(call[1])) as unknown as { requestId: string })
    expect(turnBodies.map(body => body.requestId)).toEqual(['request-fixed', 'request-fixed'])
    controller.dispose()
  })

  it('aborts the exact live transport and releases removed Session state', async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
    }))
    vi.stubGlobal('fetch', fetcher)
    const controller = new RpWebTurnController('/api/rp/v1', () => 'request-cancel')
    const pending = controller.submit(submission())
    controller.cancel(sessionId)
    await expect(pending).rejects.toThrow('cancelled')
    expect(controller.storeFor(sessionId).getSnapshot()).toMatchObject({
      phase: 'error', error: { code: 'CANCELLED', retryWithSameRequestId: false },
    })

    controller.prune(new Set())
    expect(controller.latest.getSnapshot()).toEqual({})
    controller.setMode(sessionId, 'agent')
    expect(controller.matches(submission())).toBe(false)
    controller.dispose()
  })

  it('materializes RP draft images only after route selection and sends bounded media transport values', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => requestUrl(input).endsWith('/turn')
      ? json(turn('request-media'))
      : json({ sessionId, events: [], projection: { turns: [] } }))
    vi.stubGlobal('fetch', fetcher)
    const encode = vi.fn(() => Promise.resolve([{
      mediaType: 'image/png' as const,
      data: 'AQ==',
      name: 'scene.png',
    }]))
    const controller = new RpWebTurnController('/api/rp/v1', () => 'request-media', encode)
    const imageIds = ['draft-1' as never]
    await controller.submit({ ...submission(), imageIds })
    expect(encode).toHaveBeenCalledWith(imageIds, expect.any(AbortSignal))
    expect(JSON.parse(requestBody(fetcher.mock.calls[0]?.[1])) as unknown).toMatchObject({
      requestId: 'request-media',
      media: [{ schemaVersion: 1, kind: 'image', mediaType: 'image/png', data: 'AQ==', name: 'scene.png' }],
    })
    controller.dispose()
  })
})
