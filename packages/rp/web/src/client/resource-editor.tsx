/** Structured right-rail editors for durable RP resources. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { CharacterIR, JsonObject, LoreEntryIR, LoreIR, PersonaIR } from '@dsh-rp/contracts'
import type { RpWebPresetDocument } from '../types.ts'
import type { RpStudioLocaleKey } from './locales.ts'
import type { RpResourceEditorDocument, RpResourceEditorState } from './resource-controller.ts'

interface RpResourceEditorProps {
  readonly editor: RpResourceEditorState
  readonly onSave: (document: RpResourceEditorDocument) => Promise<void>
  readonly onClose: () => void
  readonly t: (key: RpStudioLocaleKey) => string
}

/** Edit complete normalized resources while keeping compatibility envelopes and stable ids intact. */
export function RpResourceEditor({ editor, onSave, onClose, t }: RpResourceEditorProps): ReactNode {
  const [draft, setDraft] = useState<RpResourceEditorDocument>()
  const [generationText, setGenerationText] = useState('{}')
  const [localError, setLocalError] = useState<string>()

  useEffect(() => {
    const next = editor.document === undefined ? undefined : structuredClone(editor.document)
    setDraft(next)
    setGenerationText(next?.kind === 'preset' ? JSON.stringify(next.preset.generation, null, 2) : '{}')
    setLocalError(undefined)
  }, [editor.document])

  if (editor.phase === 'closed') return null
  const busy = editor.phase === 'loading' || editor.phase === 'saving'
  const title = editor.target === undefined ? t('resourceEditor') : `${resourceKindLabel(editor.target.kind, t)} · ${editor.target.id}`

  const save = async (): Promise<void> => {
    if (draft === undefined) return
    let output = draft
    if (draft.kind === 'preset') {
      let generation: unknown
      try { generation = JSON.parse(generationText) }
      catch { setLocalError(t('invalidGenerationJson')); return }
      if (!isRecord(generation)) { setLocalError(t('invalidGenerationJson')); return }
      output = { ...draft, preset: { ...draft.preset, generation: generation as JsonObject } }
    }
    const name = output.kind === 'preset' ? output.preset.name : output.asset.name
    if (name.trim() === '') { setLocalError(t('nameRequired')); return }
    setLocalError(undefined)
    await onSave(output)
  }

  return <section style={styles.editor} data-rp-resource-editor={editor.target?.kind ?? ''}>
    <header style={styles.header}>
      <div>
        <strong>{t('resourceEditor')}</strong>
        <div style={styles.mini}>{title}</div>
      </div>
      <button type="button" style={styles.close} aria-label={t('closeEditor')} onClick={onClose}>×</button>
    </header>
    {editor.phase === 'loading' ? <p style={styles.notice}>{t('loadingResource')}</p> : null}
    {draft?.kind === 'character' ? <CharacterEditor value={draft.asset} onChange={(asset) => { setDraft({ ...draft, asset }) }} t={t} /> : null}
    {draft?.kind === 'persona' ? <PersonaEditor value={draft.asset} onChange={(asset) => { setDraft({ ...draft, asset }) }} t={t} /> : null}
    {draft?.kind === 'lore' ? <LoreEditor value={draft.asset} onChange={(asset) => { setDraft({ ...draft, asset }) }} t={t} /> : null}
    {draft?.kind === 'preset' ? <PresetEditor
      value={draft.preset}
      generationText={generationText}
      onGenerationText={setGenerationText}
      onChange={(preset) => { setDraft({ ...draft, preset }) }}
      t={t}
    /> : null}
    {localError === undefined && editor.error === undefined ? null : <p role="alert" style={styles.error}>
      {localError ?? editor.error}
    </p>}
    {draft === undefined ? null : <footer style={styles.actions}>
      <button type="button" style={styles.secondary} disabled={busy} onClick={onClose}>{t('cancelEdit')}</button>
      <button
        type="button" style={styles.primary} disabled={busy}
        data-rp-resource-save=""
        onClick={() => { void save() }}
      >{editor.phase === 'saving' ? t('savingResource') : t('saveChanges')}</button>
    </footer>}
  </section>
}

function CharacterEditor({ value, onChange, t }: {
  value: CharacterIR
  onChange: (value: CharacterIR) => void
  t: RpResourceEditorProps['t']
}): ReactNode {
  const patch = (next: Partial<CharacterIR>): void => { onChange({ ...value, ...next }) }
  return <div style={styles.form}>
    <TextField label={t('name')} value={value.name} onChange={(name) => { patch({ name }) }} />
    <TextArea label={t('description')} value={value.description ?? ''} rows={4} onChange={(description) => { patch({ description }) }} />
    <TextArea label={t('personality')} value={value.personality ?? ''} rows={4} onChange={(personality) => { patch({ personality }) }} />
    <TextArea label={t('scenario')} value={value.scenario ?? ''} rows={4} onChange={(scenario) => { patch({ scenario }) }} />
    <TextField label={t('tags')} value={(value.tags ?? []).join(', ')} onChange={(text) => { patch({ tags: csv(text) }) }} />
    <EditorGroup title={t('firstMessages')}>
      {value.firstMessages.map((message, index) => <div key={index} style={styles.repeatRow}>
        <textarea
          style={styles.textarea} rows={5} aria-label={`${t('firstMessage')} ${index + 1}`}
          value={message}
          onChange={(event) => {
            const messages = [...value.firstMessages]
            messages[index] = event.currentTarget.value
            patch({ firstMessages: messages })
          }}
        />
        <button type="button" style={styles.remove} onClick={() => {
          patch({ firstMessages: value.firstMessages.filter((_, itemIndex) => itemIndex !== index) })
        }}>{t('removeItem')}</button>
      </div>)}
      <button type="button" style={styles.add} onClick={() => { patch({ firstMessages: [...value.firstMessages, ''] }) }}>
        + {t('addFirstMessage')}
      </button>
    </EditorGroup>
    <TextArea
      label={t('examples')}
      value={(value.examples ?? []).join('\n\n---\n\n')}
      rows={7}
      onChange={(text) => { patch({ examples: text.trim() === '' ? [] : text.split(/\n\n---\n\n/u) }) }}
    />
  </div>
}

function PersonaEditor({ value, onChange, t }: {
  value: PersonaIR
  onChange: (value: PersonaIR) => void
  t: RpResourceEditorProps['t']
}): ReactNode {
  return <div style={styles.form}>
    <TextField label={t('name')} value={value.name} onChange={(name) => { onChange({ ...value, name }) }} />
    <TextArea label={t('description')} value={value.description} rows={8} onChange={(description) => {
      onChange({ ...value, description })
    }} />
  </div>
}

function LoreEditor({ value, onChange, t }: {
  value: LoreIR
  onChange: (value: LoreIR) => void
  t: RpResourceEditorProps['t']
}): ReactNode {
  const replace = (index: number, entry: LoreEntryIR): void => {
    const entries = [...value.entries]
    entries[index] = entry
    onChange({ ...value, entries })
  }
  return <div style={styles.form}>
    <TextField label={t('name')} value={value.name} onChange={(name) => { onChange({ ...value, name }) }} />
    <EditorGroup title={`${t('loreEntries')} (${value.entries.length})`}>
      {value.entries.map((entry, index) => <details key={entry.id} style={styles.details} open={index === 0}>
        <summary style={styles.summary}>{entry.keys[0] ?? entry.id}</summary>
        <div style={styles.detailsBody}>
          <TextField label={t('entryKeys')} value={entry.keys.join(', ')} onChange={(text) => {
            replace(index, { ...entry, keys: csv(text) })
          }} />
          <TextField label={t('secondaryKeys')} value={(entry.secondaryKeys ?? []).join(', ')} onChange={(text) => {
            replace(index, { ...entry, secondaryKeys: csv(text) })
          }} />
          <TextArea label={t('entryContent')} value={entry.content} rows={8} onChange={(content) => {
            replace(index, { ...entry, content })
          }} />
          <label style={styles.inlineField}>{t('priority')}
            <input type="number" style={styles.numberInput} value={entry.priority} onChange={(event) => {
              replace(index, { ...entry, priority: Number(event.currentTarget.value) })
            }} />
          </label>
          <label style={styles.check}><input type="checkbox" checked={entry.enabled} onChange={(event) => {
            replace(index, { ...entry, enabled: event.currentTarget.checked })
          }} />{t('entryEnabled')}</label>
          <label style={styles.check}><input type="checkbox" checked={entry.constant === true} onChange={(event) => {
            replace(index, { ...entry, constant: event.currentTarget.checked })
          }} />{t('entryConstant')}</label>
          <button type="button" style={styles.remove} onClick={() => {
            onChange({ ...value, entries: value.entries.filter((_, itemIndex) => itemIndex !== index) })
          }}>{t('removeEntry')}</button>
        </div>
      </details>)}
      <button type="button" style={styles.add} onClick={() => {
        onChange({ ...value, entries: [...value.entries, newLoreEntry(value)] })
      }}>+ {t('addLoreEntry')}</button>
    </EditorGroup>
  </div>
}

function PresetEditor({ value, generationText, onGenerationText, onChange, t }: {
  value: RpWebPresetDocument
  generationText: string
  onGenerationText: (value: string) => void
  onChange: (value: RpWebPresetDocument) => void
  t: RpResourceEditorProps['t']
}): ReactNode {
  const selected = value.promptOrders.find(order => order.id === value.selectedPromptOrderId)
  const names = new Map(value.promptDefinitions.map(item => [item.id, item.name]))
  return <div style={styles.form}>
    <TextField label={t('name')} value={value.name} onChange={(name) => { onChange({ ...value, name }) }} />
    <label style={styles.field}>{t('selectedPromptOrder')}
      <select style={styles.input} value={value.selectedPromptOrderId} onChange={(event) => {
        onChange({ ...value, selectedPromptOrderId: event.currentTarget.value })
      }}>
        {value.promptOrders.map(order => <option key={order.id} value={order.id}>{order.id}</option>)}
      </select>
    </label>
    <EditorGroup title={t('promptOrder')}>
      {selected?.entries.map((entry, index) => <label key={entry.identifier} style={styles.orderEntry}>
        <input type="checkbox" checked={entry.enabled} onChange={(event) => {
          const promptOrders = value.promptOrders.map(order => order.id !== selected.id ? order : {
            ...order,
            entries: order.entries.map((item, itemIndex) => itemIndex === index
              ? { ...item, enabled: event.currentTarget.checked } : item),
          })
          onChange({ ...value, promptOrders })
        }} />
        <span>{names.get(entry.identifier) ?? entry.identifier}</span>
        <code style={styles.code}>{entry.identifier}</code>
      </label>)}
    </EditorGroup>
    <EditorGroup title={`${t('promptDefinitions')} (${value.promptDefinitions.length})`}>
      {value.promptDefinitions.map((definition, index) => <details key={definition.id} style={styles.details} open={index === 0}>
        <summary style={styles.summary}>{definition.name || definition.id}</summary>
        <div style={styles.detailsBody}>
          <TextField label={t('promptName')} value={definition.name} onChange={(name) => {
            onChange({ ...value, promptDefinitions: value.promptDefinitions.map((item, itemIndex) => itemIndex === index
              ? { ...item, name } : item) })
          }} />
          <label style={styles.field}>{t('promptRole')}
            <select style={styles.input} value={definition.role} onChange={(event) => {
              const role = event.currentTarget.value as 'system' | 'user' | 'assistant'
              onChange({ ...value, promptDefinitions: value.promptDefinitions.map((item, itemIndex) => itemIndex === index
                ? { ...item, role } : item) })
            }}>
              <option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option>
            </select>
          </label>
          <TextArea label={t('promptContent')} value={definition.content} rows={9} onChange={(content) => {
            onChange({ ...value, promptDefinitions: value.promptDefinitions.map((item, itemIndex) => itemIndex === index
              ? { ...item, content } : item) })
          }} />
          <label style={styles.check}><input type="checkbox" checked={definition.marker} onChange={(event) => {
            onChange({ ...value, promptDefinitions: value.promptDefinitions.map((item, itemIndex) => itemIndex === index
              ? { ...item, marker: event.currentTarget.checked } : item) })
          }} />{t('markerPrompt')}</label>
          <button type="button" style={styles.remove} onClick={() => { onChange(removePrompt(value, definition.id)) }}>
            {t('removePrompt')}
          </button>
        </div>
      </details>)}
      <button type="button" style={styles.add} onClick={() => { onChange(addPrompt(value)) }}>+ {t('addPrompt')}</button>
    </EditorGroup>
    <TextArea label={t('generationParameters')} value={generationText} rows={8} onChange={onGenerationText} monospace />
  </div>
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): ReactNode {
  return <label style={styles.field}>{label}<input style={styles.input} value={value} onChange={(event) => {
    onChange(event.currentTarget.value)
  }} /></label>
}

function TextArea({ label, value, rows, onChange, monospace = false }: {
  label: string
  value: string
  rows: number
  onChange: (value: string) => void
  monospace?: boolean
}): ReactNode {
  return <label style={styles.field}>{label}<textarea
    style={{ ...styles.textarea, ...(monospace ? styles.monospace : {}) }} rows={rows} value={value}
    onChange={(event) => { onChange(event.currentTarget.value) }}
  /></label>
}

function EditorGroup({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return <section style={styles.group}><div style={styles.groupTitle}>{title}</div>{children}</section>
}

function csv(value: string): string[] {
  return value.split(/[,，]/u).map(item => item.trim()).filter(Boolean)
}

function newLoreEntry(lore: LoreIR): LoreEntryIR {
  const ids = new Set(lore.entries.map(item => item.id))
  let index = lore.entries.length + 1
  while (ids.has(`entry-${index}`)) index += 1
  return { id: `entry-${index}`, content: '', keys: [], enabled: true, priority: index }
}

function addPrompt(preset: RpWebPresetDocument): RpWebPresetDocument {
  const ids = new Set(preset.promptDefinitions.map(item => item.id))
  let index = preset.promptDefinitions.length + 1
  while (ids.has(`prompt-${index}`)) index += 1
  const id = `prompt-${index}`
  return {
    ...preset,
    promptDefinitions: [...preset.promptDefinitions, {
      schemaVersion: 1, id, name: id, role: 'system', content: '', marker: false,
    }],
    promptOrders: preset.promptOrders.map(order => ({
      ...order,
      entries: [...order.entries, { identifier: id, enabled: order.id === preset.selectedPromptOrderId }],
    })),
  }
}

function removePrompt(preset: RpWebPresetDocument, id: string): RpWebPresetDocument {
  return {
    ...preset,
    promptDefinitions: preset.promptDefinitions.filter(item => item.id !== id),
    promptOrders: preset.promptOrders.map(order => ({
      ...order, entries: order.entries.filter(item => item.identifier !== id),
    })),
  }
}

function resourceKindLabel(kind: string, t: RpResourceEditorProps['t']): string {
  if (kind === 'character') return t('characterCard')
  if (kind === 'persona') return t('persona')
  if (kind === 'lore') return t('lorebook')
  return t('preset')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const styles: Record<string, CSSProperties> = {
  editor: { marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid var(--dsw-alias-border-l2)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  mini: { marginTop: 2, color: 'var(--dsw-alias-label-tertiary)', fontSize: 9, overflowWrap: 'anywhere' },
  close: { width: 28, height: 28, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 18 },
  notice: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
  form: { display: 'grid', gap: 10 },
  field: { display: 'grid', gap: 4, color: 'var(--dsw-alias-label-secondary)', fontSize: 10 },
  input: { width: '100%', minWidth: 0, boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, padding: '7px 8px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', fontSize: 11 },
  textarea: { width: '100%', minWidth: 0, boxSizing: 'border-box', resize: 'vertical', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, padding: 8, background: 'var(--dsw-alias-bg-base)', color: 'inherit', fontSize: 11, lineHeight: 1.45 },
  monospace: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 10 },
  group: { display: 'grid', gap: 6, marginTop: 3 },
  groupTitle: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' },
  repeatRow: { display: 'grid', gap: 4 },
  details: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'rgba(120,130,150,.04)' },
  summary: { padding: '7px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 600 },
  detailsBody: { display: 'grid', gap: 8, padding: '2px 8px 9px' },
  add: { justifySelf: 'start', border: '1px solid rgba(111,120,232,.32)', borderRadius: 7, padding: '6px 8px', background: 'rgba(111,120,232,.1)', color: 'inherit', cursor: 'pointer', fontSize: 10 },
  remove: { justifySelf: 'start', border: 0, padding: '3px 0', background: 'transparent', color: '#d85f70', cursor: 'pointer', fontSize: 9 },
  inlineField: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, color: 'var(--dsw-alias-label-secondary)', fontSize: 10 },
  numberInput: { width: 90, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '5px 7px', background: 'var(--dsw-alias-bg-base)', color: 'inherit' },
  check: { display: 'flex', alignItems: 'center', gap: 6, color: 'var(--dsw-alias-label-secondary)', fontSize: 10 },
  orderEntry: { display: 'grid', gridTemplateColumns: '16px minmax(0,1fr) auto', alignItems: 'center', gap: 5, padding: '5px 6px', borderRadius: 6, background: 'rgba(120,130,150,.05)', fontSize: 10 },
  code: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 8 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 12, position: 'sticky', bottom: 0, padding: '8px 0', background: 'var(--dsw-alias-bg-base)' },
  secondary: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, padding: '7px 9px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 10 },
  primary: { border: 0, borderRadius: 7, padding: '7px 10px', background: '#6f78e8', color: '#fff', cursor: 'pointer', fontSize: 10, fontWeight: 600 },
  error: { margin: '8px 0 0', padding: '6px 8px', borderRadius: 7, color: '#d85f70', background: 'rgba(210,65,80,.08)', fontSize: 10 },
}
