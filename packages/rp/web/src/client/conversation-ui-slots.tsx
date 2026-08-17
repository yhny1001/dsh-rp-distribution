/** Installable RP package UI projected into trusted native conversation seats. */
import { useEffect, type ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { RpWebCatalogState } from './catalog-controller.ts'
import type { RpConversationInjected } from './rp-conversation.tsx'
import { RpSessionResources } from './session-resources.tsx'
import { UiSlotFrames } from './ui-slots.tsx'

/** Shared catalog face injected into each separately rooted Slot entry. */
export interface RpCatalogInjected {
  hooks: { rpCatalog: HostObservable<RpWebCatalogState> }
  loadCatalog: (refresh?: boolean) => Promise<void>
}

export type RpConversationSidebarProps =
  PropsRuntime<'sidebar.conversation'> & InjectFace<RpConversationInjected> & PropsLocale<'rp.studio'>

export type RpMessageAfterProps =
  PropsRuntime<'conversation.chat.message.after'> & InjectFace<RpCatalogInjected> & PropsLocale<'rp.studio'>

/** Session-bound first-party resources and package panels in the expanded navigation column. */
export function RpConversationSidebar(props: RpConversationSidebarProps): ReactNode {
  const { wide, useRpCatalog, useRpTurn, loadCatalog, t } = props
  const state = useRpCatalog(value => value)
  const turn = useRpTurn(value => value)
  useEffect(() => { void loadCatalog() }, [loadCatalog])
  if (!wide || turn.mode !== 'rp') return null
  return <>
    <RpSessionResources {...props} />
    {state.status === 'ready'
      ? <UiSlotFrames catalog={state.catalog} placement="conversation.sidebar" variant="sidebar" t={t} />
      : null}
  </>
}

/** Package presentation following each user or Assistant message row. */
export function RpMessageAfter({ role, nodeKey, useRpCatalog, loadCatalog, t }: RpMessageAfterProps): ReactNode {
  const state = useRpCatalog(value => value)
  useEffect(() => { void loadCatalog() }, [loadCatalog])
  if (state.status !== 'ready') return null
  return <div data-rp-message-after={nodeKey} data-rp-message-role={role}>
    <UiSlotFrames catalog={state.catalog} placement="message.after" variant="message" t={t} />
  </div>
}
