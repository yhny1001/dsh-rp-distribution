/** Session-scoped browser controller for the shared Headless/Web RP Turn API. */
import {
  createSnapshotStore,
  type SessionId,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationEncodedDraftImage,
  ConversationSubmissionHandler,
  ConversationSubmissionRequest,
  DraftAttachmentId,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  RpWebTimelineResponse,
  RpWebTurnErrorResponse,
  RpWebTurnRequest,
  RpWebTurnResponse,
} from '../types.ts'

/** Client-safe failure retained beside a restored composer draft. */
export interface RpWebTurnClientFailure {
  readonly code: string
  readonly message: string
  /** An unchanged resubmission will reuse the exact request identity. */
  readonly retryWithSameRequestId: boolean
}

/** Observable state for one live browser Session. */
export interface RpWebTurnClientState {
  readonly mode: 'agent' | 'rp'
  readonly experienceId: string
  readonly phase: 'idle' | 'running' | 'error'
  readonly timelinePhase: 'idle' | 'loading' | 'ready' | 'error'
  readonly requestId: string | undefined
  readonly response: RpWebTurnResponse | undefined
  readonly timeline: RpWebTimelineResponse | undefined
  readonly error: RpWebTurnClientFailure | undefined
  readonly timelineError: string | undefined
}

/** Latest RP Session touched by an actual Turn, shared with Studio inspectors. */
export interface RpWebLatestTurnState {
  readonly sessionId?: SessionId
  readonly state?: RpWebTurnClientState
}

interface RetryLock {
  readonly requestId: string
  readonly fingerprint: string
}

interface SessionEntry {
  readonly store: SnapshotStore<RpWebTurnClientState>
  retry: RetryLock | undefined
  turnAbort: AbortController | undefined
  timelineAbort: AbortController | undefined
  timelineGeneration: number
}

type EncodeDraftImages = (
  imageIds: readonly DraftAttachmentId[],
  signal?: AbortSignal,
) => Promise<readonly ConversationEncodedDraftImage[]>

class RpWebTurnTransportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryWithSameRequestId: boolean,
  ) {
    super(message)
    this.name = 'RpWebTurnTransportError'
  }
}

const INITIAL: RpWebTurnClientState = Object.freeze({
  mode: 'rp',
  experienceId: 'rp-adaptive',
  phase: 'idle',
  timelinePhase: 'idle',
  requestId: undefined,
  response: undefined,
  timeline: undefined,
  error: undefined,
  timelineError: undefined,
})

/** One apply-scoped controller shared by composer controls, RP view, and Studio. */
export class RpWebTurnController {
  /** Global read face used only to link the latest live Turn into Studio. */
  readonly latest: SnapshotStore<RpWebLatestTurnState> = createSnapshotStore<RpWebLatestTurnState>({})
  /** Stable general-conversation route registered by the RP Web plugin. */
  readonly submissionHandler: ConversationSubmissionHandler
  private readonly entries = new Map<SessionId, SessionEntry>()
  private disposed = false

  /**
   * @param endpoint - Same-origin RP API prefix.
   * @param makeRequestId - Stable-id source, injectable for deterministic tests.
   */
  constructor(
    private readonly endpoint: string,
    private readonly makeRequestId: () => string = () => crypto.randomUUID(),
    private readonly encodeDraftImages: EncodeDraftImages = missingImageEncoder,
  ) {
    this.submissionHandler = Object.freeze({
      id: 'rp-web-turn',
      priority: 100,
      matches: (request: ConversationSubmissionRequest) => this.matches(request),
      submit: async (request: ConversationSubmissionRequest) => { await this.submit(request) },
    })
  }

  /**
   * Resolve or create the observable Session state.
   * @param sessionId - Exact browser Session identity.
   * @returns Stable store owned until Session pruning or plugin disposal.
   */
  storeFor(sessionId: SessionId): SnapshotStore<RpWebTurnClientState> {
    return this.entry(sessionId).store
  }

  /**
   * Switch future submissions between the ordinary Agent path and RP Turn API.
   * @param sessionId - Exact browser Session identity.
   * @param mode - Route selected for later composer submissions.
   */
  setMode(sessionId: SessionId, mode: 'agent' | 'rp'): void {
    const entry = this.entry(sessionId)
    if (entry.store.getSnapshot().phase === 'running') return
    this.update(sessionId, entry, { ...entry.store.getSnapshot(), mode })
  }

  /**
   * Select the Experience frozen into the next RP Turn request.
   * @param sessionId - Exact browser Session identity.
   * @param experienceId - Registered Experience requested from the Host.
   */
  setExperience(sessionId: SessionId, experienceId: string): void {
    if (experienceId.trim() === '') return
    const entry = this.entry(sessionId)
    if (entry.store.getSnapshot().phase === 'running') return
    this.update(sessionId, entry, { ...entry.store.getSnapshot(), experienceId })
  }

  /**
   * Whether this controller owns a general composer submission.
   * @param request - Frozen submission currency from ui-conversation.
   * @returns Whether this Session currently uses the RP route.
   */
  matches(request: ConversationSubmissionRequest): boolean {
    return !this.disposed && this.entry(request.sessionId).store.getSnapshot().mode === 'rp'
  }

  /**
   * Execute one RP submission. The Host owns authority and identity; the
   * browser sends only its Session, Experience, input, and idempotency key.
   * Rejection deliberately bubbles so InputHub restores text and attachments.
   * @param request - Frozen Session/text/attachment-id/mode submission.
   */
  async submit(request: ConversationSubmissionRequest): Promise<void> {
    if (this.disposed) throw new Error('RP Web Turn controller is disposed')
    const entry = this.entry(request.sessionId)
    const before = entry.store.getSnapshot()
    if (before.phase === 'running') throw new Error('An RP Turn is already running for this Session')
    const fingerprint = JSON.stringify({
      sessionId: request.sessionId,
      experienceId: before.experienceId,
      text: request.text,
      imageIds: request.imageIds,
    })
    if (entry.retry !== undefined && entry.retry.fingerprint !== fingerprint) {
      throw new Error('The previous RP Turn has uncertain delivery; resend the unchanged draft before editing it')
    }
    const requestId = entry.retry?.requestId ?? this.makeRequestId()
    const abort = new AbortController()
    entry.turnAbort?.abort()
    entry.turnAbort = abort
    this.update(request.sessionId, entry, {
      ...before,
      phase: 'running',
      requestId,
      error: undefined,
    }, true)
    try {
      const images = request.imageIds.length === 0
        ? Object.freeze([])
        : await this.encodeDraftImages(request.imageIds, abort.signal)
      const body: RpWebTurnRequest = {
        schemaVersion: 1,
        requestId,
        sessionId: request.sessionId,
        agentId: request.sessionId,
        experienceId: before.experienceId,
        input: { text: request.text },
        ...(images.length === 0 ? {} : {
          media: images.map(image => Object.freeze({
            schemaVersion: 1 as const,
            kind: 'image' as const,
            mediaType: image.mediaType,
            data: image.data,
            ...(image.name === undefined ? {} : { name: image.name }),
          })),
        }),
        context: { surface: 'dsh-web', submitMode: request.mode },
      }
      const response = await fetch(`${this.endpoint}/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      })
      const value = await decodeTurnResponse(response)
      if (value.requestId !== requestId || value.sessionId !== request.sessionId) {
        throw new RpWebTurnTransportError('RP Turn response identity did not match its request', 'INVALID_RESPONSE', true)
      }
      if (!this.isCurrentTurn(entry, abort)) return
      entry.retry = undefined
      entry.turnAbort = undefined
      this.update(request.sessionId, entry, {
        ...entry.store.getSnapshot(),
        phase: 'idle',
        response: value,
        requestId,
        error: undefined,
      }, true)
      void this.loadTimeline(request.sessionId)
    } catch (reason: unknown) {
      if (!this.isCurrentTurn(entry, abort)) return
      entry.turnAbort = undefined
      const cancelled = abort.signal.aborted
      const failure = turnFailure(reason, cancelled)
      entry.retry = failure.retryWithSameRequestId ? { requestId, fingerprint } : undefined
      this.update(request.sessionId, entry, {
        ...entry.store.getSnapshot(),
        phase: 'error',
        requestId,
        error: failure,
      }, true)
      throw new Error(failure.message, { cause: reason })
    }
  }

  /**
   * Abort the exact in-flight transport; the Host signal cancels before atomic commit.
   * @param sessionId - Session whose active RP transport should be aborted.
   */
  cancel(sessionId: SessionId): void {
    this.entries.get(sessionId)?.turnAbort?.abort('cancelled by user')
  }

  /**
   * Load a detached replay projection for the RP view and Studio inspector.
   * @param sessionId - Live Session whose RP events should be replayed.
   */
  async loadTimeline(sessionId: SessionId): Promise<void> {
    if (this.disposed) return
    const entry = this.entry(sessionId)
    entry.timelineAbort?.abort()
    const abort = new AbortController()
    const generation = entry.timelineGeneration + 1
    entry.timelineGeneration = generation
    entry.timelineAbort = abort
    this.update(sessionId, entry, {
      ...entry.store.getSnapshot(),
      timelinePhase: 'loading',
      timelineError: undefined,
    })
    try {
      const response = await fetch(`${this.endpoint}/timeline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sessionId }),
        signal: abort.signal,
      })
      const value = await response.json() as RpWebTimelineResponse | { error?: string }
      if (!response.ok) {
        throw new Error('error' in value && typeof value.error === 'string' ? value.error : `timeline ${response.status}`)
      }
      if (!isTimelineResponse(value) || value.sessionId !== sessionId) {
        throw new Error('Timeline response identity or shape is invalid')
      }
      if (!this.isCurrentTimeline(entry, generation)) return
      entry.timelineAbort = undefined
      this.update(sessionId, entry, {
        ...entry.store.getSnapshot(),
        timelinePhase: 'ready',
        timeline: value,
        timelineError: undefined,
      })
    } catch (reason: unknown) {
      if (!this.isCurrentTimeline(entry, generation) || abort.signal.aborted) return
      entry.timelineAbort = undefined
      this.update(sessionId, entry, {
        ...entry.store.getSnapshot(),
        timelinePhase: 'error',
        timelineError: reason instanceof Error ? reason.message : String(reason),
      })
    }
  }

  /**
   * Drop state and transports for Sessions no longer present in the client runtime.
   * @param liveSessionIds - Complete current client Session identity set.
   */
  prune(liveSessionIds: ReadonlySet<SessionId>): void {
    for (const [sessionId, entry] of this.entries) {
      if (liveSessionIds.has(sessionId)) continue
      entry.turnAbort?.abort('Session removed')
      entry.timelineAbort?.abort('Session removed')
      this.entries.delete(sessionId)
      if (this.latest.getSnapshot().sessionId === sessionId) this.latest.set({})
    }
  }

  /** Cancel every browser operation and release all apply-scoped stores. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.entries.values()) {
      entry.turnAbort?.abort('RP Web plugin disposed')
      entry.timelineAbort?.abort('RP Web plugin disposed')
    }
    this.entries.clear()
    this.latest.set({})
  }

  private entry(sessionId: SessionId): SessionEntry {
    const existing = this.entries.get(sessionId)
    if (existing !== undefined) return existing
    const created: SessionEntry = {
      store: createSnapshotStore<RpWebTurnClientState>(INITIAL),
      retry: undefined,
      turnAbort: undefined,
      timelineAbort: undefined,
      timelineGeneration: 0,
    }
    this.entries.set(sessionId, created)
    return created
  }

  private update(sessionId: SessionId, entry: SessionEntry, state: RpWebTurnClientState, promote = false): void {
    entry.store.set(state)
    if (promote || this.latest.getSnapshot().sessionId === sessionId) {
      this.latest.set({ sessionId, state })
    }
  }

  private isCurrentTurn(entry: SessionEntry, abort: AbortController): boolean {
    return !this.disposed && entry.turnAbort === abort
  }

  private isCurrentTimeline(entry: SessionEntry, generation: number): boolean {
    return !this.disposed && entry.timelineGeneration === generation
  }
}

async function decodeTurnResponse(response: Response): Promise<RpWebTurnResponse> {
  let value: unknown
  try {
    value = await response.json()
  } catch (_reason: unknown) {
    throw new RpWebTurnTransportError('RP Turn returned invalid JSON', 'INVALID_RESPONSE', response.ok)
  }
  if (!response.ok) {
    const error = turnErrorPayload(value)
    throw new RpWebTurnTransportError(error.message, error.code, error.retryWithSameRequestId === true)
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.requestId !== 'string'
    || typeof value.sessionId !== 'string' || typeof value.assistantMessage !== 'string') {
    throw new RpWebTurnTransportError('RP Turn response shape is invalid', 'INVALID_RESPONSE', true)
  }
  return value as unknown as RpWebTurnResponse
}

function turnErrorPayload(value: unknown): RpWebTurnErrorResponse['error'] {
  if (!isRecord(value) || !isRecord(value.error)) {
    return { code: 'HTTP_ERROR', message: 'RP Turn request failed' }
  }
  return {
    code: typeof value.error.code === 'string' ? value.error.code : 'HTTP_ERROR',
    message: typeof value.error.message === 'string' ? value.error.message : 'RP Turn request failed',
    ...(value.error.retryWithSameRequestId === true ? { retryWithSameRequestId: true } : {}),
  }
}

function turnFailure(reason: unknown, cancelled: boolean): RpWebTurnClientFailure {
  if (cancelled) {
    return { code: 'CANCELLED', message: 'RP Turn cancelled before completion', retryWithSameRequestId: false }
  }
  if (reason instanceof RpWebTurnTransportError) {
    return {
      code: reason.code,
      message: reason.message,
      retryWithSameRequestId: reason.retryWithSameRequestId,
    }
  }
  return {
    code: 'TRANSPORT_UNCERTAIN',
    message: reason instanceof Error ? reason.message : String(reason),
    retryWithSameRequestId: true,
  }
}

function isTimelineResponse(value: unknown): value is RpWebTimelineResponse {
  return isRecord(value) && typeof value.sessionId === 'string' && Array.isArray(value.events)
    && Object.hasOwn(value, 'projection')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function missingImageEncoder(): Promise<never> {
  return Promise.reject(new Error('RP Web image transport is not composed'))
}
