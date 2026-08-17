/** First-party RP conversation rails: resource assembly on the left and live inspection on the right. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { RpWebLibraryCatalogResponse } from '../types.ts'
import type { RpConversationInjected } from './rp-conversation.tsx'
import { RpResourceEditor } from './resource-editor.tsx'
import type { RpResourceEditorTarget, RpSessionAssetKind, RpSessionImportKind } from './resource-controller.ts'

export type RpSessionResourcesProps =
  PropsRuntime<'sidebar.conversation'> & InjectFace<RpConversationInjected> & PropsLocale<'rp.studio'>

export type RpSessionInspectorProps =
  PropsRuntime<'conversation.rail.right'> & InjectFace<RpConversationInjected> & PropsLocale<'rp.studio'>

interface AssetRow {
  readonly kind: RpSessionAssetKind
  readonly id: string
  readonly name: string
  readonly detail: string
  readonly active: boolean
}

/** Expanded-left-column resource importer and current Session composition. */
export function RpSessionResources({
  wide, useRpTurn, useRpResources, loadResources, importResource,
  setResourceActive, setPresetActive, openResourceEditor, t,
}: RpSessionResourcesProps): ReactNode {
  const turn = useRpTurn(value => value)
  const state = useRpResources(value => value)
  const [kind, setKind] = useState<RpSessionImportKind>('character-card-png')
  useEffect(() => {
    if (turn.mode === 'rp') void loadResources()
  }, [loadResources, turn.mode])
  if (!wide || turn.mode !== 'rp') return null

  const assets = resourceRows(state.library, t('entries'))
  const busy = state.phase === 'loading' || state.phase === 'mutating'
  return <section style={styles.rail} data-rp-session-resources="">
    <header style={styles.railHeader}>
      <div>
        <strong style={styles.railTitle}>{t('rpResources')}</strong>
        <div style={styles.mini}>{t('currentSessionAssembly')}</div>
      </div>
      <button
        type="button" style={styles.iconButton} disabled={busy}
        aria-label={t('refreshResources')}
        onClick={() => { void loadResources(true) }}
      >↻</button>
    </header>

    <div style={styles.importBox}>
      <select
        style={styles.select} value={kind} aria-label={t('importType')}
        onChange={(event) => { setKind(event.currentTarget.value as RpSessionImportKind) }}
      >
        <option value="character-card-png">{t('characterCardPng')}</option>
        <option value="character-card-json">{t('characterCardJson')}</option>
        <option value="character-card-charx">{t('characterCardCharx')}</option>
        <option value="persona">{t('persona')}</option>
        <option value="world-info">{t('lorebook')}</option>
        <option value="preset">{t('preset')}</option>
      </select>
      <label style={{ ...styles.importButton, ...(busy ? styles.disabled : {}) }}>
        {busy ? t('importingResource') : t('importAndActivate')}
        <input
          type="file" style={styles.hiddenInput} disabled={busy}
          data-rp-session-import={kind}
          aria-label={t('importResourceFile')}
          accept={acceptFor(kind)}
          onChange={(event) => {
            const input = event.currentTarget
            const file = input.files?.[0]
            if (file !== undefined) void importResource(kind, file)
            input.value = ''
          }}
        />
      </label>
      <small style={styles.hint}>{t('importHint')}</small>
    </div>

    {state.importedFile === undefined ? null : <div role="status" style={styles.success}>
      {t('importedAndActivated')}: {state.importedFile}
    </div>}
    {state.error === undefined ? null : <div role="alert" style={styles.error}>{state.error}</div>}

    <ResourceGroup title={t('characters')} empty={t('noCharacters')} rows={assets.filter(row => row.kind === 'character')} busy={busy} onToggle={setResourceActive} onEdit={openResourceEditor} t={t} />
    <ResourceGroup title={t('personas')} empty={t('noPersonas')} rows={assets.filter(row => row.kind === 'persona')} busy={busy} onToggle={setResourceActive} onEdit={openResourceEditor} t={t} />
    <ResourceGroup title={t('lorebooks')} empty={t('noLorebooks')} rows={assets.filter(row => row.kind === 'lore')} busy={busy} onToggle={setResourceActive} onEdit={openResourceEditor} t={t} />

    <div style={styles.group}>
      <div style={styles.groupTitle}>{t('presets')}</div>
      {(state.presets?.presets.length ?? 0) === 0
        ? <div style={styles.empty}>{t('noPresets')}</div>
        : state.presets?.presets.map((item) => {
          const active = state.presets?.active?.presetId === item.id
          return <div
            key={item.id}
            style={{ ...styles.resource, ...(active ? styles.resourceActive : {}) }}
          >
            <span style={styles.resourceCopy}>
              <strong style={styles.resourceName}>{item.name}</strong>
              <small style={styles.resourceDetail}>
                {item.promptDefinitionCount} {t('promptDefinitions')} · {item.enabledPromptIds.length} {t('enabledPrompts')} · {item.promptOrderCount} {t('promptOrders')}
              </small>
            </span>
            <span style={styles.rowActions}>
              <button
                type="button" disabled={busy} style={styles.editButton}
                aria-label={`${t('editResource')} ${item.name}`}
                onClick={() => { void openResourceEditor({ kind: 'preset', id: item.id }) }}
              >{t('edit')}</button>
              <button
                type="button" disabled={busy} aria-pressed={active}
                style={{ ...styles.statePill, ...(active ? styles.statePillActive : {}) }}
                aria-label={`${active ? t('deactivateAsset') : t('activateAsset')} ${item.name}`}
                onClick={() => { void setPresetActive(active ? undefined : item.id) }}
              >{active ? t('enabled') : t('enable')}</button>
            </span>
          </div>
        })}
    </div>
  </section>
}

function ResourceGroup({ title, empty, rows, busy, onToggle, onEdit, t }: {
  title: string
  empty: string
  rows: readonly AssetRow[]
  busy: boolean
  onToggle: (kind: RpSessionAssetKind, id: string, active: boolean) => Promise<void>
  onEdit: (target: RpResourceEditorTarget) => Promise<void>
  t: RpSessionResourcesProps['t']
}): ReactNode {
  return <div style={styles.group}>
    <div style={styles.groupTitle}>{title}</div>
    {rows.length === 0 ? <div style={styles.empty}>{empty}</div> : rows.map(row => <div
      key={`${row.kind}:${row.id}`}
      style={{ ...styles.resource, ...(row.active ? styles.resourceActive : {}) }}
    >
      <span style={styles.resourceCopy}>
        <strong style={styles.resourceName}>{row.name}</strong>
        {row.detail === '' ? null : <small style={styles.resourceDetail}>{row.detail}</small>}
      </span>
      <span style={styles.rowActions}>
        <button
          type="button" disabled={busy} style={styles.editButton}
          aria-label={`${t('editResource')} ${row.name}`}
          onClick={() => { void onEdit({ kind: row.kind, id: row.id }) }}
        >{t('edit')}</button>
        <button
          type="button" disabled={busy} aria-pressed={row.active}
          style={{ ...styles.statePill, ...(row.active ? styles.statePillActive : {}) }}
          aria-label={`${row.active ? t('deactivateAsset') : t('activateAsset')} ${row.name}`}
          onClick={() => { void onToggle(row.kind, row.id, !row.active) }}
        >{row.active ? t('enabled') : t('enable')}</button>
      </span>
    </div>)}
  </div>
}

/** Right-column summary of the frozen RP composition and replay projection. */
export function RpSessionInspector({
  sessionId, useRpTurn, useRpResources, loadResources, loadTimeline,
  saveResourceEditor, closeResourceEditor, t,
}: RpSessionInspectorProps): ReactNode {
  const turn = useRpTurn(value => value)
  const resources = useRpResources(value => value)
  useEffect(() => {
    if (turn.mode !== 'rp') return
    void loadResources()
    void loadTimeline()
  }, [loadResources, loadTimeline, turn.mode])
  if (turn.mode !== 'rp') return null

  const projection = asRecord(turn.timeline?.projection)
  const activeCharacters = activeNames(resources.library, 'character')
  const activePersonas = activeNames(resources.library, 'persona')
  const activeLorebooks = activeNames(resources.library, 'lore')
  const activePreset = resources.presets?.presets.find(item => item.id === resources.presets?.active?.presetId)
  const lastEvent = turn.timeline?.events.findLast(event => event.type.startsWith('rp/'))
  const lastCommitted = turn.timeline?.events.findLast(event => event.type === 'rp/turn-committed')
  const lastTurnId = turn.response?.turnId ?? stringField(lastCommitted?.data, 'turnId')

  return <section style={styles.inspector} data-rp-session-inspector={sessionId}>
    <RpResourceEditor
      editor={resources.editor}
      onSave={saveResourceEditor}
      onClose={closeResourceEditor}
      t={t}
    />
    <header style={styles.inspectorHeader}>
      <div>
        <strong>{t('rpInspector')}</strong>
        <div style={styles.mini}>{turn.experienceId}</div>
      </div>
      <button type="button" style={styles.iconButton} aria-label={t('refreshResources')} onClick={() => {
        void loadResources(true)
        void loadTimeline()
      }}>↻</button>
    </header>

    <InspectorSection title={t('currentComposition')}>
      <InspectorLine label={t('characters')} values={activeCharacters} empty={t('notConfigured')} />
      <InspectorLine label={t('personas')} values={activePersonas} empty={t('notConfigured')} />
      <InspectorLine label={t('lorebooks')} values={activeLorebooks} empty={t('notConfigured')} />
      <InspectorLine label={t('preset')} values={activePreset === undefined ? [] : [
        activePreset.name,
        `${activePreset.promptDefinitionCount} ${t('promptDefinitions')} · ${activePreset.enabledPromptIds.length} ${t('enabledPrompts')} · ${activePreset.promptOrderCount} ${t('promptOrders')}`,
      ]} empty={t('notConfigured')} />
    </InspectorSection>

    <InspectorSection title={t('worldState')}>
      <Metric label={t('stateRevision')} value={nestedNumber(projection, 'state', 'revision') ?? 0} />
      <Metric label={t('memories')} value={arrayLength(projection, 'memories')} />
      <Metric label={t('branches')} value={arrayLength(projection, 'branches')} />
      <Metric label={t('agents')} value={arrayLength(projection, 'agents')} />
      <Metric label={t('pipelines')} value={arrayLength(projection, 'pipelines')} />
    </InspectorSection>

    <InspectorSection title={t('runtimeTrace')}>
      <div style={styles.traceLine}><span>{t('events')}</span><strong>{turn.timeline?.events.length ?? 0}</strong></div>
      <div style={styles.traceLine}><span>{t('lastEvent')}</span><code style={styles.inlineCode}>{lastEvent?.type ?? '—'}</code></div>
      <div style={styles.traceLine}><span>{t('lastTurn')}</span><code style={styles.inlineCode}>{lastTurnId ?? '—'}</code></div>
    </InspectorSection>

    {turn.timeline === undefined ? null : <details style={styles.rawDetails}>
      <summary>{t('rawProjection')}</summary>
      <pre style={styles.rawPre}>{JSON.stringify(turn.timeline.projection, null, 2)}</pre>
    </details>}
  </section>
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return <section style={styles.inspectorSection}><div style={styles.groupTitle}>{title}</div>{children}</section>
}

function InspectorLine({ label, values, empty }: { label: string; values: readonly string[]; empty: string }): ReactNode {
  return <div style={styles.inspectorLine}>
    <span style={styles.inspectorLabel}>{label}</span>
    <div style={styles.chips}>{values.length === 0
      ? <span style={styles.mutedChip}>{empty}</span>
      : values.map(value => <span key={value} style={styles.chip}>{value}</span>)}</div>
  </div>
}

function Metric({ label, value }: { label: string; value: number }): ReactNode {
  return <div style={styles.metric}><span>{label}</span><strong>{value}</strong></div>
}

function resourceRows(library: RpWebLibraryCatalogResponse | undefined, entriesLabel: string): readonly AssetRow[] {
  if (library === undefined) return []
  return [
    ...library.characters.map(item => ({
      kind: 'character' as const, id: item.id, name: item.name, detail: item.description ?? '',
      active: library.active?.characterIds.includes(item.id) === true,
    })),
    ...library.personas.map(item => ({
      kind: 'persona' as const, id: item.id, name: item.name, detail: item.description,
      active: library.active?.personaIds.includes(item.id) === true,
    })),
    ...library.lorebooks.map(item => ({
      kind: 'lore' as const, id: item.id, name: item.name, detail: `${item.entryCount} ${entriesLabel}`,
      active: library.active?.lorebookIds.includes(item.id) === true,
    })),
  ]
}

function activeNames(
  library: RpWebLibraryCatalogResponse | undefined,
  kind: RpSessionAssetKind,
): readonly string[] {
  if (library === undefined) return []
  const ids = kind === 'character' ? library.active?.characterIds
    : kind === 'persona' ? library.active?.personaIds : library.active?.lorebookIds
  const items = kind === 'character' ? library.characters
    : kind === 'persona' ? library.personas : library.lorebooks
  return items.filter(item => ids?.includes(item.id) === true).map(item => item.name)
}

function acceptFor(kind: RpSessionImportKind): string {
  if (kind === 'character-card-png') return '.png,image/png'
  if (kind === 'character-card-charx') return '.charx,application/zip'
  return '.json,application/json'
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function arrayLength(value: Record<string, unknown>, key: string): number {
  return Array.isArray(value[key]) ? value[key].length : 0
}

function nestedNumber(value: Record<string, unknown>, key: string, nested: string): number | undefined {
  const child = asRecord(value[key])
  return typeof child[nested] === 'number' ? child[nested] : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  const record = asRecord(value)
  return typeof record[key] === 'string' ? record[key] : undefined
}

const styles: Record<string, CSSProperties> = {
  rail: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '10px 8px 14px', color: 'var(--dsw-alias-label-primary)' },
  railHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 9 },
  railTitle: { fontSize: 13 },
  mini: { marginTop: 2, fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' },
  iconButton: { width: 26, height: 26, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, background: 'transparent', color: 'inherit', cursor: 'pointer' },
  importBox: { display: 'grid', gap: 6, padding: 8, border: '1px solid rgba(111,120,232,.2)', borderRadius: 10, background: 'rgba(111,120,232,.06)' },
  select: { width: '100%', minWidth: 0, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, padding: '6px 8px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', fontSize: 11 },
  importButton: { display: 'block', padding: '7px 9px', borderRadius: 7, background: 'rgba(111,120,232,.18)', color: 'inherit', textAlign: 'center', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' },
  disabled: { opacity: .55, cursor: 'default' },
  hint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 9, lineHeight: 1.35 },
  success: { marginTop: 7, padding: '6px 8px', borderRadius: 7, color: '#55a878', background: 'rgba(70,170,110,.09)', fontSize: 10, overflowWrap: 'anywhere' },
  error: { marginTop: 7, padding: '6px 8px', borderRadius: 7, color: '#d85f70', background: 'rgba(210,65,80,.08)', fontSize: 10, overflowWrap: 'anywhere' },
  group: { marginTop: 11 },
  groupTitle: { marginBottom: 5, color: 'var(--dsw-alias-label-secondary)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' },
  empty: { padding: '5px 7px', color: 'var(--dsw-alias-label-tertiary)', fontSize: 10 },
  resource: { display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 7, marginBottom: 4, padding: '7px 8px', border: '1px solid transparent', borderRadius: 8, background: 'rgba(120,130,150,.05)', color: 'inherit', textAlign: 'left', cursor: 'pointer' },
  resourceActive: { borderColor: 'rgba(111,120,232,.32)', background: 'rgba(111,120,232,.1)' },
  resourceCopy: { display: 'grid', minWidth: 0, gap: 2 },
  resourceName: { overflow: 'hidden', fontSize: 11, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  resourceDetail: { overflow: 'hidden', color: 'var(--dsw-alias-label-tertiary)', fontSize: 9, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowActions: { display: 'flex', flex: 'none', alignItems: 'center', gap: 4 },
  editButton: { border: 0, padding: '2px 4px', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: 9 },
  statePill: { flex: 'none', border: 0, padding: '2px 5px', borderRadius: 99, color: 'var(--dsw-alias-label-tertiary)', background: 'rgba(120,130,150,.09)', cursor: 'pointer', fontSize: 9 },
  statePillActive: { color: '#6571d8', background: 'rgba(111,120,232,.15)' },
  inspector: { color: 'var(--dsw-alias-label-primary)' },
  inspectorHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 },
  inspectorSection: { marginBottom: 17 },
  inspectorLine: { marginBottom: 9 },
  inspectorLabel: { display: 'block', marginBottom: 4, color: 'var(--dsw-alias-label-tertiary)', fontSize: 10 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  chip: { padding: '3px 6px', borderRadius: 6, background: 'rgba(111,120,232,.12)', color: 'var(--dsw-alias-label-primary)', fontSize: 10 },
  mutedChip: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 10 },
  metric: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(130,145,180,.1)', fontSize: 11 },
  traceLine: { display: 'grid', gridTemplateColumns: '70px minmax(0,1fr)', gap: 7, alignItems: 'center', padding: '5px 0', fontSize: 10 },
  inlineCode: { overflow: 'hidden', color: 'var(--dsw-alias-label-secondary)', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rawDetails: { marginTop: 10, color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
  rawPre: { maxHeight: 300, overflow: 'auto', padding: 8, borderRadius: 8, background: 'var(--dsw-alias-markdown-code-block)', fontSize: 9, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
}
