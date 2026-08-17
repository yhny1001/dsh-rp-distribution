/** RP Web's required generic Host extensions pending their next public DSH package release. */

import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { DraftAttachmentId as HostDraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.plugins.tab': {
      kind: 'list'
      scope: 'root'
      owner: { children?: never }
    }
    'sidebar.conversation': {
      kind: 'list'
      scope: 'session'
      owner: { wide: boolean }
    }
    'conversation.chat.message.after': {
      kind: 'list'
      scope: 'session'
      owner: {
        role: 'user' | 'assistant'
        nodeKey: string
        status: 'running' | 'settled' | 'interrupted'
      }
    }
    'conversation.hero.mode': {
      kind: 'list'
      scope: 'session'
      owner: { children?: never }
    }
    'conversation.rail.right': {
      kind: 'list'
      scope: 'session'
      owner: object
    }
  }

  interface SessionStandardProps {
    sessionId: SessionId
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  export interface ConversationEncodedDraftImage {
    readonly mediaType: ImageMediaType
    readonly data: string
    readonly name?: string
  }

  export interface ConversationSubmissionRequest {
    readonly sessionId: SessionId
    readonly text: string
    readonly imageIds: readonly HostDraftAttachmentId[]
    readonly mode: 'queue' | 'steer'
  }

  export interface ConversationSubmissionHandler {
    readonly id: string
    readonly priority?: number
    readonly matches: (request: ConversationSubmissionRequest) => boolean
    readonly submit: (request: ConversationSubmissionRequest) => Promise<void>
  }

  interface IConversation {
    registerSubmissionHandler(handler: ConversationSubmissionHandler): () => void
    encodeDraftImages(
      imageIds: readonly HostDraftAttachmentId[],
      signal?: AbortSignal,
    ): Promise<readonly ConversationEncodedDraftImage[]>
    resolveImage(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string>
  }
}

export {}
