/** Native DSH Web controls and replay view for live RP Turns. */
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { ImageGallery, type ImageLoader, type MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment'
import type {
  HostObservable,
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { JsonValue } from '@dsh-rp/contracts'
import type { RpWebTimelineEvent } from '../types.ts'
import type { RpWebCatalogState } from './catalog-controller.ts'
import { experienceLabel } from './locales.ts'
import type {
  RpResourceEditorDocument,
  RpResourceEditorTarget,
  RpSessionAssetKind,
  RpSessionImportKind,
  RpWebResourceClientState,
} from './resource-controller.ts'
import type { RpWebTurnClientState } from './turn-controller.ts'

/** Session-specific actions and stores injected into each native RP seat. */
export interface RpConversationInjected {
  hooks: {
    rpTurn: HostObservable<RpWebTurnClientState>
    rpCatalog: HostObservable<RpWebCatalogState>
    rpResources: HostObservable<RpWebResourceClientState>
  }
  loadCatalog: (refresh?: boolean) => Promise<void>
  loadResources: (refresh?: boolean) => Promise<void>
  importResource: (kind: RpSessionImportKind, file: File) => Promise<void>
  setResourceActive: (kind: RpSessionAssetKind, id: string, active: boolean) => Promise<void>
  setPresetActive: (presetId: string | undefined) => Promise<void>
  openResourceEditor: (target: RpResourceEditorTarget) => Promise<void>
  saveResourceEditor: (document: RpResourceEditorDocument) => Promise<void>
  closeResourceEditor: () => void
  setMode: (mode: 'agent' | 'rp') => void
  setExperience: (experienceId: string) => void
  cancelTurn: () => void
  loadTimeline: () => Promise<void>
  resolveImage: ImageLoader
}

export type RpModeControlProps =
  (PropsRuntime<'conversation.hero.mode'> | PropsRuntime<'conversation.session.header.actions'>)
  & InjectFace<RpConversationInjected> & PropsLocale<'rp.studio'>
export type RpTurnStatusProps =
  PropsRuntime<'conversation.input.dock'> & InjectFace<RpConversationInjected> & PropsLocale<'rp.studio'>
export type RpConversationViewProps =
  PropsRuntime<'conversation.view'> & InjectFace<RpConversationInjected> & PropsLocale<'rp.studio'>

/** Primary Agent/RP mode selector beside the session's Agent preset. */
export function RpModeControl({
  useRpTurn,
  useRpCatalog,
  loadCatalog,
  setMode,
  setExperience,
  t,
}: RpModeControlProps): ReactNode {
  const turn = useRpTurn(value => value)
  const catalog = useRpCatalog(value => value)
  useEffect(() => { void loadCatalog() }, [loadCatalog])
  const experiences = catalog.status === 'ready' ? catalog.catalog.experiences : []
  const value = turn.mode === 'agent' ? 'agent' : turn.experienceId
  return <div style={styles.controls} data-rp-mode={turn.mode}>
    <select
      aria-label={t('conversationMode')}
      data-rp-mode-selector=""
      style={{ ...styles.modeSelect, ...(turn.mode === 'rp' ? styles.modeActive : {}) }}
      value={value}
      disabled={turn.phase === 'running'}
      title={turn.mode === 'rp' ? t('switchToAgent') : t('switchToRp')}
      onChange={(event) => {
        const next = event.currentTarget.value
        if (next === 'agent') {
          setMode('agent')
          return
        }
        setExperience(next)
        setMode('rp')
      }}
    >
      <option value="agent">{t('agentMode')}</option>
      {turn.mode === 'rp' && !experiences.some(experience => experience.id === turn.experienceId)
        ? <option value={turn.experienceId}>{t('rpMode')} · {turn.experienceId}</option>
        : null}
      {experiences.map(experience => <option key={experience.id} value={experience.id}>
        {t('rpMode')} · {experienceLabel(experience.id, experience.name, t)}
      </option>)}
    </select>
  </div>
}

/** Running, cancellation, idempotent-retry, and latest-commit feedback above the composer. */
export function RpTurnStatus({ useRpTurn, cancelTurn, t }: RpTurnStatusProps): ReactNode {
  const state = useRpTurn(value => value)
  if (state.mode !== 'rp') return null
  if (state.phase === 'running') {
    return <div style={styles.status} data-rp-turn-status="running">
      <span><i style={styles.pulse} />{t('runningTurn')} · {state.experienceId}</span>
      <button type="button" style={styles.cancel} onClick={cancelTurn}>{t('cancelTurn')}</button>
    </div>
  }
  if (state.phase === 'error' && state.error !== undefined) {
    return <div role="alert" style={{ ...styles.status, ...styles.error }} data-rp-turn-status="error">
      <span>{state.error.code}: {state.error.message}</span>
      {state.error.retryWithSameRequestId ? <small>{t('retryUnchanged')}</small> : null}
    </div>
  }
  if (state.response !== undefined) {
    return <div style={{ ...styles.status, ...styles.committed }} data-rp-turn-status="committed">
      <span>{t('lastTurn')}: {state.response.turnId} · {state.response.experienceId}</span>
      <small>event #{state.response.eventSeq}{state.response.replayed ? ' · replayed' : ''}</small>
    </div>
  }
  return null
}

/** Replay-backed RP transcript plus raw Agent/Pipeline event inspector. */
export function RpConversationView({ sessionId, useRpTurn, loadTimeline, resolveImage, t }: RpConversationViewProps): ReactNode {
  const state = useRpTurn(value => value)
  useEffect(() => { void loadTimeline() }, [loadTimeline])
  const turns = committedTurns(state.timeline?.events ?? [])
  return <section style={styles.view} data-rp-conversation-view={sessionId}>
    <header style={styles.viewHeader}>
      <div>
        <h2 style={styles.heading}>{t('rpView')}</h2>
        <p style={styles.subtle}>{sessionId} · {state.experienceId}</p>
      </div>
      <button type="button" style={styles.refresh} onClick={() => { void loadTimeline() }}>
        {t('refreshTimeline')}
      </button>
    </header>
    {state.timelinePhase === 'loading' && turns.length === 0 ? <p style={styles.empty}>{t('timelineLoading')}</p> : null}
    {state.timelinePhase === 'error' ? <p role="alert" style={styles.errorText}>
      {t('timelineError')}: {state.timelineError}
    </p> : null}
    {state.timelinePhase !== 'loading' && turns.length === 0 ? <p style={styles.empty}>{t('timelineEmpty')}</p> : null}
    <div style={styles.transcript}>
      {turns.map(turn => <article key={`${turn.turnId}:${turn.seq}`} style={styles.turn}>
        <div style={styles.user}>
          <strong>User</strong>
          {turn.images.length === 0 ? null : <ImageGallery
            images={turn.images.map(attachment => ({ attachment }))}
            load={resolveImage}
            align="end"
            labels={imageLabels(t)}
          />}
          {inputText(turn.input) === '' ? null : <p style={styles.message}>{inputText(turn.input)}</p>}
        </div>
        <div style={styles.assistant}><strong>{t('assistant')}</strong><p style={styles.message}>{turn.assistantMessage}</p></div>
        <footer style={styles.meta}>#{turn.seq} · {turn.turnId}</footer>
      </article>)}
    </div>
    {state.timeline === undefined ? null : <details style={styles.inspector}>
      <summary>{t('eventTrace')} · {state.timeline.events.length}</summary>
      <pre style={styles.pre}>{JSON.stringify(state.timeline, null, 2)}</pre>
    </details>}
  </section>
}

interface CommittedTurn {
  readonly seq: number
  readonly turnId: string
  readonly input: JsonValue
  readonly images: readonly ImageAttachmentRef[]
  readonly assistantMessage: string
}

function committedTurns(events: readonly RpWebTimelineEvent[]): readonly CommittedTurn[] {
  const contexts = new Map<string, { input: JsonValue; images: readonly ImageAttachmentRef[] }>()
  const turns: CommittedTurn[] = []
  for (const event of events) {
    if (event.type === 'rp/context-activated' && isRecord(event.data)
      && typeof event.data.turnId === 'string' && Object.hasOwn(event.data, 'input')) {
      contexts.set(event.data.turnId, {
        input: event.data.input as JsonValue,
        images: imageReferences(event.data.content),
      })
      continue
    }
    if (event.type !== 'rp/turn-committed' || !isRecord(event.data)) continue
    if (typeof event.data.turnId !== 'string' || typeof event.data.assistantMessage !== 'string') continue
    const context = contexts.get(event.data.turnId)
    turns.push({
      seq: event.seq,
      turnId: event.data.turnId,
      input: context?.input ?? null,
      images: context?.images ?? Object.freeze([]),
      assistantMessage: event.data.assistantMessage,
    })
  }
  return turns
}

function imageReferences(value: unknown): readonly ImageAttachmentRef[] {
  if (!Array.isArray(value)) return Object.freeze([])
  return Object.freeze(value.flatMap((block): ImageAttachmentRef[] => {
    if (!isRecord(block) || block.type !== 'image' || !isRecord(block.attachment)) return []
    const attachment = block.attachment
    if (typeof attachment.attachmentId !== 'string' || !isImageMediaType(attachment.mediaType)
      || !isPositiveInteger(attachment.bytes) || !isPositiveInteger(attachment.width)
      || !isPositiveInteger(attachment.height)
      || attachment.name !== undefined && typeof attachment.name !== 'string') return []
    return [{
      attachmentId: attachment.attachmentId as ImageAttachmentRef['attachmentId'],
      mediaType: attachment.mediaType,
      bytes: attachment.bytes,
      width: attachment.width,
      height: attachment.height,
      ...(typeof attachment.name === 'string' ? { name: attachment.name } : {}),
    }]
  }))
}

function imageLabels(t: RpConversationViewProps['t']): MessageImageLabels {
  return {
    image: t('inputImage'),
    open: t('openImage'),
    openNamed: label => `${t('openImage')}: ${label}`,
    loading: t('imageLoading'),
    loadFailed: t('imageFailed'),
    lightbox: { dialog: t('imagePreview'), close: t('closeImage') },
  }
}

function isImageMediaType(value: unknown): value is ImageMediaType {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function inputText(input: JsonValue): string {
  if (isRecord(input) && typeof input.text === 'string') return input.text
  return JSON.stringify(input, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const styles: Record<string, CSSProperties> = {
  controls: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 },
  modeSelect: {
    border: '1px solid rgba(130,145,180,.25)', background: 'rgba(255,255,255,.04)', color: 'inherit',
    borderRadius: 8, padding: '5px 26px 5px 9px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
    maxWidth: 210, minWidth: 112, textOverflow: 'ellipsis',
  },
  modeActive: { borderColor: 'rgba(111,120,232,.58)', background: 'rgba(111,120,232,.13)' },
  status: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    border: '1px solid rgba(130,145,180,.18)', borderRadius: 9, padding: '8px 10px',
    background: 'rgba(111,120,232,.08)', color: 'var(--dsw-alias-label-secondary,#c7cedd)', fontSize: 11,
  },
  pulse: {
    display: 'inline-block', width: 7, height: 7, borderRadius: 99, marginRight: 7, background: '#9fa8ff',
  },
  cancel: {
    border: '1px solid rgba(255,105,120,.35)', borderRadius: 7, padding: '4px 8px',
    background: 'rgba(255,82,105,.1)', color: '#ffb2bd', cursor: 'pointer',
  },
  error: { borderColor: 'rgba(255,105,120,.3)', background: 'rgba(255,82,105,.08)', color: '#ffb2bd' },
  committed: { background: 'rgba(90,200,140,.06)', borderColor: 'rgba(90,200,140,.18)' },
  view: { padding: '18px 20px 36px', maxWidth: 980, margin: '0 auto', color: 'var(--dsw-alias-label-primary,#e8edf6)' },
  viewHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18 },
  heading: { fontSize: 22, margin: 0 },
  subtle: { margin: '5px 0 0', color: 'var(--dsw-alias-label-tertiary,#9099ab)', fontSize: 11 },
  refresh: {
    border: '1px solid rgba(130,145,180,.25)', borderRadius: 8, padding: '7px 10px',
    background: 'rgba(255,255,255,.04)', color: 'inherit', cursor: 'pointer',
  },
  transcript: { display: 'grid', gap: 12 },
  turn: { border: '1px solid rgba(130,145,180,.15)', borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,.02)' },
  user: { padding: '12px 14px', background: 'rgba(111,120,232,.07)' },
  assistant: { padding: '14px' },
  message: { whiteSpace: 'pre-wrap', margin: '6px 0 0', lineHeight: 1.55 },
  meta: { padding: '7px 14px', borderTop: '1px solid rgba(130,145,180,.1)', color: '#747e91', fontSize: 10 },
  empty: { padding: 40, textAlign: 'center', color: 'var(--dsw-alias-label-tertiary,#9099ab)' },
  errorText: { color: '#ff9dab' },
  inspector: { marginTop: 18, borderTop: '1px solid rgba(130,145,180,.16)', paddingTop: 12, color: '#aeb7ca' },
  pre: { overflow: 'auto', maxHeight: 560, padding: 12, borderRadius: 9, background: '#101219', fontSize: 11 },
}
