/** Durable RP journal writer over the Harness Session log. @module @dsh-rp/journal */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  RpJournalEventMap,
  RpJournalEventType,
  RpTurnAbortRecord,
  RpTurnCommitRecord,
} from './types.ts'

export type * from './types.ts'

const RP_JOURNAL_EVENT_TYPE_MAP = {
  'rp/capability-authorized': true,
  'rp/capability-settled': true,
  'rp/composition-resolved': true,
  'rp/context-activated': true,
  'rp/pipeline-started': true,
  'rp/pipeline-stage': true,
  'rp/pipeline-completed': true,
  'rp/pipeline-failed': true,
  'rp/agent-started': true,
  'rp/agent-delegated': true,
  'rp/agent-completed': true,
  'rp/agent-interrupted': true,
  'rp/state-proposed': true,
  'rp/state-committed': true,
  'rp/state-rejected': true,
  'rp/branch-created': true,
  'rp/branch-activated': true,
  'rp/branch-removed': true,
  'rp/memory-proposed': true,
  'rp/memory-accepted': true,
  'rp/memory-compacted': true,
  'rp/media-requested': true,
  'rp/media-completed': true,
  'rp/media-failed': true,
  'rp/turn-committed': true,
  'rp/turn-aborted': true,
} as const satisfies Record<RpJournalEventType, true>

/** Runtime vocabulary accepted as required RP Session facts. */
export const RP_JOURNAL_EVENT_TYPES: readonly RpJournalEventType[] = Object.freeze(
  Object.keys(RP_JOURNAL_EVENT_TYPE_MAP) as RpJournalEventType[],
)

declare module '@deepseek-ai/cordis' {
  interface Context {
    rpJournal: RpJournal
  }
}

/** Typed writer for required RP facts in the canonical Harness session log. */
export class RpJournal extends Service {
  constructor(ctx: Context) {
    super(ctx, 'rpJournal')
  }

  /**
   * Append one required RP fact.
   * @param session - Owning Harness session.
   * @param type - RP event name.
   * @param data - Lossless JSON event data.
   * @returns The accepted immutable event.
   */
  append<T extends RpJournalEventType>(
    session: Session,
    type: T,
    data: RpJournalEventMap[T],
  ): SessionEvent<T> {
    const append = session.append.bind(session) as unknown as (
      eventType: RpJournalEventType,
      eventData: RpJournalEventMap[RpJournalEventType],
    ) => SessionEvent<RpJournalEventType>
    return append(type, data) as SessionEvent<T>
  }

  /**
   * Atomically publish the complete post-turn record as one Session event.
   * @param session - Owning Harness session.
   * @param record - Complete validated turn outcome.
   * @returns The accepted commit event.
   */
  commitTurn(session: Session, record: RpTurnCommitRecord): SessionEvent<'rp/turn-committed'> {
    return this.append(session, 'rp/turn-committed', record)
  }

  /**
   * Publish a terminal abort without a partial turn state.
   * @param session - Owning Harness session.
   * @param record - Abort reason and identity.
   * @returns The accepted abort event.
   */
  abortTurn(session: Session, record: RpTurnAbortRecord): SessionEvent<'rp/turn-aborted'> {
    return this.append(session, 'rp/turn-aborted', record)
  }
}

export default RpJournal
