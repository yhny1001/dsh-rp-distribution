/** DSH Web product surface for layered RP composition. */

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type {
  CharacterProfile,
  PersonaProfile,
  ProductEntity,
  ProductEntityKind,
  ProductState,
  PromptLayer,
  SessionComposition,
  SystemProfile,
  WorldProfile,
} from '../model.ts'

export const name = '@dsh-rp/product'
export const inject = ['slots', 'sessions']

const API = '/api/dsh-rp/product'
const STYLE_ID = 'dsh-rp-product-styles'

interface SessionListSnapshot {
  readonly current?: string | null
  readonly byId: Readonly<Record<string, unknown>>
}

interface CommandReceipt {
  readonly ok: boolean
  readonly value?: { readonly matched?: boolean; readonly result?: { readonly kind?: string; readonly text?: string } }
  readonly error?: { readonly message?: string }
}

interface ClientContext {
  readonly slots: {
    inject(name: string, factory: () => unknown): unknown
    register(options: Record<string, unknown>, component: (props: Record<string, unknown>) => ReactNode): unknown
  }
  readonly sessions: {
    readonly list: {
      getSnapshot(): SessionListSnapshot
      subscribe(listener: () => void): () => void
    }
    binding(sessionId: string): {
      readonly session: {
        command(line: string): Promise<CommandReceipt>
      }
    } | undefined
  }
  effect(factory: () => (() => void) | void, label?: string): unknown
}

interface ProductResponse {
  readonly ok: true
  readonly state: ProductState
  readonly sessionId: string
  readonly binding?: SessionComposition
  readonly layers: readonly PromptLayer[]
  readonly presetId: string
}

type ProductSection = 'compose' | ProductEntityKind

interface ProductClientState {
  readonly open: boolean
  readonly embedded: boolean
  readonly section: ProductSection
  readonly sessionId: string
  readonly loading: boolean
  readonly saving: boolean
  readonly error: string
  readonly notice: string
  readonly response: ProductResponse | undefined
}

let context: ClientContext | undefined
let snapshot: ProductClientState = Object.freeze({
  open: false,
  embedded: false,
  section: 'compose',
  sessionId: '',
  loading: false,
  saving: false,
  error: '',
  notice: '',
  response: undefined,
})
const listeners = new Set<() => void>()

/** Register the product panel and additive conversation context surfaces. */
export function apply(ctx: ClientContext): void {
  context = ctx
  ensureStyles()
  ctx.effect(() => {
    const dispose = ctx.sessions.list.subscribe(() => {
      const sessionId = currentSessionId(ctx)
      if (sessionId !== snapshot.sessionId) {
        update({ sessionId, response: undefined, error: '', notice: '' })
        void loadProduct(sessionId)
      }
    })
    return () => { dispose(); context = undefined; removeStyles() }
  }, 'dsh-rp-product: client lifetime')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dsh-rp-product', order: 18, label: 'RP 创作室',
  }, props => <ProductPanel embedded {...(typeof props.close === 'function' ? { close: props.close as () => void } : {})} />))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'dsh-rp-product-context', order: -40, label: 'RP Context',
  }, props => <ConversationContextButton sessionId={sessionIdFromProps(props)} />))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'dsh-rp-product-stack', order: -40,
  }, props => <ConversationContextDock sessionId={sessionIdFromProps(props)} />))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-rp-product-panel', order: 30,
  }, () => <ProductOverlay />))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'dsh-rp-product-open', order: 20, label: 'RP 创作室',
  }, props => <SidebarAction wide={props.wide === true} />))

  const sessionId = currentSessionId(ctx)
  update({ sessionId })
  void loadProduct(sessionId)
}

function ProductOverlay(): ReactNode {
  const state = useProductState()
  if (!state.open || state.embedded) return null
  return <div className="rpp-overlay" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) closeProduct()
  }}>
    <div className="rpp-modal" role="dialog" aria-modal="true" aria-label="RP 创作室">
      <ProductPanel close={closeProduct} />
    </div>
  </div>
}

function SidebarAction({ wide }: { readonly wide: boolean }): ReactNode {
  return <button type="button" className={`rpp-sidebar-action ${wide ? 'rpp-sidebar-action-wide' : 'rpp-sidebar-action-rail'}`}
    aria-label="打开 RP 创作室" title="RP 创作室" onClick={() => openProduct('compose')}>
    <span className="rpp-mark" aria-hidden="true">织</span>
    {wide ? <span>RP 创作室</span> : null}
  </button>
}

function ConversationContextButton({ sessionId }: { readonly sessionId: string }): ReactNode {
  const state = useProductState()
  useLoadSession(sessionId)
  const binding = state.sessionId === sessionId ? state.response?.binding : undefined
  const character = binding === undefined ? undefined : state.response?.state.characters
    .find(item => item.id === binding.primaryCharacterId)
  return <button type="button" className={`rpp-header-context ${binding === undefined ? 'rpp-header-context-empty' : ''}`}
    onClick={() => openProduct('compose', sessionId)} title="查看或修改 RP 分层设定">
    <span className="rpp-stack-icon" aria-hidden="true"><i /><i /><i /></span>
    <span>{character?.name ?? '配置 RP'}</span>
  </button>
}

function ConversationContextDock({ sessionId }: { readonly sessionId: string }): ReactNode {
  const state = useProductState()
  useLoadSession(sessionId)
  if (state.sessionId !== sessionId || state.response?.binding === undefined) return null
  return <button type="button" className="rpp-context-dock" onClick={() => openProduct('compose', sessionId)}>
    <span className="rpp-context-dock-label">本轮上下文</span>
    <span className="rpp-context-dock-layers">
      {state.response.layers.map(layer => <span key={layer.kind} className={`rpp-mini-layer ${layer.empty ? 'rpp-mini-layer-empty' : ''}`}
        style={{ '--rpp-accent': layer.accent } as CSSProperties}>
        <b>{layer.title}</b><span>{layer.subtitle}</span>
      </span>)}
    </span>
    <span className="rpp-context-edit">调整</span>
  </button>
}

function ProductPanel({ embedded = false, close }: { readonly embedded?: boolean; readonly close?: () => void }): ReactNode {
  const state = useProductState()
  const ctx = context
  useEffect(() => {
    if (ctx === undefined) return
    const sessionId = currentSessionId(ctx)
    update({ embedded, sessionId })
    void loadProduct(sessionId)
  }, [ctx, embedded])

  const response = state.response
  return <div className={`rpp-shell ${embedded ? 'rpp-shell-embedded' : ''}`}>
    <aside className="rpp-nav">
      <div className="rpp-brand">
        <span className="rpp-brand-mark">织</span>
        <span><strong>RP 创作室</strong><small>Layered story workspace</small></span>
      </div>
      <nav aria-label="RP 创作室分区">
        <NavButton section="compose" icon="◫" label="会话编排" hint="把五层设定组合到当前对话" />
        <NavButton section="systems" icon="✦" label="系统规则" hint="模型行为与叙事边界" />
        <NavButton section="characters" icon="◉" label="角色" hint="模型要扮演的人物" />
        <NavButton section="personas" icon="◇" label="用户人设" hint="对话中的用户身份" />
        <NavButton section="worlds" icon="◎" label="世界观" hint="环境、历史与客观规则" />
      </nav>
      <div className="rpp-nav-foot">
        <span className="rpp-status-dot" />
        <span>{state.sessionId === '' ? '未选择 DSH 会话' : `会话 ${shortId(state.sessionId)}`}</span>
      </div>
    </aside>
    <main className="rpp-main">
      <header className="rpp-main-header">
        <div>
          <span className="rpp-eyebrow">DSH NATIVE AGENTLOOP</span>
          <h2>{sectionTitle(state.section)}</h2>
          <p>{sectionDescription(state.section)}</p>
        </div>
        {close === undefined ? null : <button type="button" className="rpp-close" onClick={close} aria-label="关闭">×</button>}
      </header>
      <div className="rpp-content">
        {state.loading && response === undefined ? <LoadingState /> : null}
        {state.error !== '' ? <div className="rpp-banner rpp-banner-error">{state.error}</div> : null}
        {state.notice !== '' ? <div className="rpp-banner rpp-banner-success">{state.notice}</div> : null}
        {response === undefined ? null : state.section === 'compose'
          ? <CompositionEditor response={response} />
          : <EntityManager kind={state.section} response={response} />}
      </div>
    </main>
  </div>
}

function NavButton({ section, icon, label, hint }: {
  readonly section: ProductSection
  readonly icon: string
  readonly label: string
  readonly hint: string
}): ReactNode {
  const state = useProductState()
  return <button type="button" className={state.section === section ? 'rpp-nav-active' : ''}
    onClick={() => update({ section, error: '', notice: '' })}>
    <span className="rpp-nav-icon">{icon}</span>
    <span><strong>{label}</strong><small>{hint}</small></span>
  </button>
}

interface CompositionDraft {
  readonly systemId: string
  readonly characterIds: readonly string[]
  readonly primaryCharacterId: string
  readonly personaId: string
  readonly worldId: string
  readonly scene: string
}

function CompositionEditor({ response }: { readonly response: ProductResponse }): ReactNode {
  const state = useProductState()
  const initial = compositionDraft(response)
  const [draft, setDraft] = useState<CompositionDraft>(initial)
  useEffect(() => { setDraft(compositionDraft(response)) }, [response.state.revision, response.sessionId])
  const layers = useMemo(() => previewLayers(response.state, response.sessionId, draft), [response.state, response.sessionId, draft])
  const canApply = response.sessionId !== '' && draft.systemId !== '' && draft.characterIds.length > 0

  return <div className="rpp-compose-grid">
    <section className="rpp-compose-controls">
      <div className="rpp-section-heading">
        <span><b>上下文配方</b><small>每一层只负责一种语义，模型不会把用户人设误当成角色设定。</small></span>
        <span className="rpp-revision">REV {response.state.revision}</span>
      </div>
      <Field label="系统规则" note="控制模型如何叙事，不定义任何具体角色。" accent="#8b7cf6">
        <Select value={draft.systemId} onChange={systemId => setDraft({ ...draft, systemId })}
          items={response.state.systems} empty="选择系统规则" />
      </Field>
      <Field label="世界观" note="只提供环境、历史和客观规则。" accent="#42b883">
        <Select value={draft.worldId} onChange={worldId => setDraft({ ...draft, worldId })}
          items={response.state.worlds} empty="不绑定世界观" allowEmpty />
      </Field>
      <Field label="角色阵容" note="可选择多个角色，并指定本轮主要扮演者。" accent="#f47f6b">
        <div className="rpp-choice-grid">
          {response.state.characters.map(character => {
            const selected = draft.characterIds.includes(character.id)
            const primary = draft.primaryCharacterId === character.id
            return <div key={character.id} className={`rpp-choice-card ${selected ? 'rpp-choice-selected' : ''}`}
              style={{ '--rpp-accent': character.accent } as CSSProperties}>
              <button type="button" className="rpp-choice-main" onClick={() => {
                const characterIds = selected
                  ? draft.characterIds.filter(id => id !== character.id)
                  : [...draft.characterIds, character.id]
                setDraft({
                  ...draft,
                  characterIds,
                  primaryCharacterId: primary || !characterIds.includes(draft.primaryCharacterId)
                    ? characterIds[0] ?? ''
                    : draft.primaryCharacterId,
                })
              }}>
                <span className="rpp-avatar">{character.name.slice(0, 1)}</span>
                <span><b>{character.name}</b><small>{truncate(character.summary, 46)}</small></span>
                <i>{selected ? '✓' : '+'}</i>
              </button>
              {selected ? <button type="button" className={`rpp-primary ${primary ? 'rpp-primary-active' : ''}`}
                onClick={() => setDraft({ ...draft, primaryCharacterId: character.id })}>
                {primary ? '主要角色' : '设为主要'}
              </button> : null}
            </div>
          })}
        </div>
      </Field>
      <Field label="用户人设" note="描述对话中的用户是谁，绝不转移给模型扮演。" accent="#36b8d4">
        <Select value={draft.personaId} onChange={personaId => setDraft({ ...draft, personaId })}
          items={response.state.personas} empty="不绑定用户人设" allowEmpty />
      </Field>
      <Field label="当前场景" note="只影响这次会话，可随剧情进展调整。" accent="#e7a84f">
        <textarea value={draft.scene} rows={4} placeholder="例如：深夜的观星塔，夜潮正在逼近港口……"
          onChange={event => setDraft({ ...draft, scene: event.target.value })} />
      </Field>
      <div className="rpp-compose-actions">
        <span>{response.sessionId === '' ? '先在 DSH 中打开或创建一个会话' : `将应用到 ${shortId(response.sessionId)}`}</span>
        <button type="button" className="rpp-primary-action" disabled={!canApply || state.saving}
          onClick={() => { void applyComposition(response, draft) }}>
          {state.saving ? '正在应用…' : '应用到当前会话'}
        </button>
      </div>
    </section>
    <aside className="rpp-preview">
      <div className="rpp-preview-heading"><span>模型上下文预览</span><small>按实际注入顺序</small></div>
      <div className="rpp-layer-stack">
        {layers.map((layer, index) => <article key={layer.kind} className={`rpp-layer-card ${layer.empty ? 'rpp-layer-empty' : ''}`}
          style={{ '--rpp-accent': layer.accent } as CSSProperties}>
          <div className="rpp-layer-index">0{index + 1}</div>
          <div><span className="rpp-layer-kind">{layer.title}</span><h3>{layer.subtitle}</h3>
            <p>{layer.empty ? '本层不会注入模型上下文' : truncate(layer.content, 180)}</p></div>
        </article>)}
      </div>
      <div className="rpp-preview-note"><b>语义隔离</b><span>系统规则决定“如何响应”；角色决定“扮演谁”；用户人设决定“你在和谁对话”；世界观决定“故事发生在哪里”；场景决定“此刻发生什么”。</span></div>
    </aside>
  </div>
}

function Field({ label, note, accent, children }: {
  readonly label: string
  readonly note: string
  readonly accent: string
  readonly children: ReactNode
}): ReactNode {
  return <label className="rpp-field" style={{ '--rpp-accent': accent } as CSSProperties}>
    <span className="rpp-field-copy"><b>{label}</b><small>{note}</small></span>{children}
  </label>
}

function Select({ value, onChange, items, empty, allowEmpty = false }: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly items: readonly { readonly id: string; readonly name: string }[]
  readonly empty: string
  readonly allowEmpty?: boolean
}): ReactNode {
  return <select value={value} onChange={event => onChange(event.target.value)}>
    {allowEmpty || value === '' ? <option value="">{empty}</option> : null}
    {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
  </select>
}

function EntityManager({ kind, response }: { readonly kind: ProductEntityKind; readonly response: ProductResponse }): ReactNode {
  const entities = response.state[kind] as readonly ProductEntity[]
  const [selectedId, setSelectedId] = useState(entities[0]?.id ?? '')
  const selected = entities.find(entity => entity.id === selectedId) ?? entities[0]
  const [draft, setDraft] = useState<Record<string, string>>(selected === undefined ? emptyDraft(kind) : entityDraft(selected))
  useEffect(() => {
    const current = entities.find(entity => entity.id === selectedId) ?? entities[0]
    if (current !== undefined) { setSelectedId(current.id); setDraft(entityDraft(current)) }
    else { setSelectedId(''); setDraft(emptyDraft(kind)) }
  }, [response.state.revision, kind])
  const fields = entityFields(kind)
  return <div className="rpp-manager">
    <aside className="rpp-entity-list">
      <div className="rpp-list-heading"><span>{entityLabel(kind)}</span>
        <button type="button" onClick={() => { setSelectedId(''); setDraft(emptyDraft(kind)) }}>＋ 新建</button></div>
      <div className="rpp-list-scroll">
        {entities.map(entity => <button type="button" key={entity.id}
          className={entity.id === selected?.id && selectedId !== '' ? 'rpp-entity-active' : ''}
          onClick={() => { setSelectedId(entity.id); setDraft(entityDraft(entity)) }}>
          <span className="rpp-entity-avatar" style={{ '--rpp-accent': entityAccent(entity, kind) } as CSSProperties}>
            {entity.name.slice(0, 1)}
          </span>
          <span><b>{entity.name}</b><small>{entitySummary(entity, kind)}</small></span>
        </button>)}
      </div>
    </aside>
    <section className="rpp-editor">
      <div className="rpp-editor-hero">
        <span className="rpp-editor-orb" style={{ '--rpp-accent': draft.accent ?? kindAccent(kind) } as CSSProperties}>
          {(draft.name || entityLabel(kind)).slice(0, 1)}
        </span>
        <span><span className="rpp-eyebrow">{selectedId === '' ? 'CREATE NEW' : `EDIT · ${selectedId}`}</span>
          <h3>{draft.name || `新建${entityLabel(kind)}`}</h3><p>{entityEditorHint(kind)}</p></span>
      </div>
      <div className="rpp-editor-fields">
        {fields.map(field => <label key={field.key} className={field.rows > 1 ? 'rpp-editor-field rpp-editor-field-wide' : 'rpp-editor-field'}>
          <span>{field.label}<small>{field.note}</small></span>
          {field.rows > 1
            ? <textarea rows={field.rows} value={draft[field.key] ?? ''} onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} />
            : field.key === 'accent'
              ? <input type="color" value={draft.accent ?? kindAccent(kind)} onChange={event => setDraft({ ...draft, accent: event.target.value })} />
              : <input value={draft[field.key] ?? ''} onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} />}
        </label>)}
      </div>
      <div className="rpp-editor-actions">
        {selectedId === '' ? <span /> : <button type="button" className="rpp-danger-action"
          onClick={() => { if (window.confirm(`删除“${draft.name}”？`)) void deleteEntity(kind, selectedId, response) }}>删除</button>}
        <button type="button" className="rpp-primary-action" disabled={(draft.name ?? '').trim() === ''}
          onClick={() => { void saveEntity(kind, selectedId, draft, response) }}>保存{entityLabel(kind)}</button>
      </div>
    </section>
  </div>
}

function LoadingState(): ReactNode {
  return <div className="rpp-loading"><span className="rpp-loading-orb" /><b>正在读取 RP 工作区</b><small>从本地 Harness 加载角色、Persona 与世界观</small></div>
}

function useProductState(): ProductClientState {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}

function useLoadSession(sessionId: string): void {
  useEffect(() => {
    if (sessionId !== '' && (snapshot.sessionId !== sessionId || snapshot.response === undefined)) {
      update({ sessionId })
      void loadProduct(sessionId)
    }
  }, [sessionId])
}

function subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }

function update(patch: Partial<ProductClientState>): void {
  snapshot = Object.freeze({ ...snapshot, ...patch })
  for (const listener of listeners) listener()
}

async function loadProduct(sessionId = snapshot.sessionId): Promise<void> {
  update({ loading: true, error: '' })
  try {
    const response = await request(`state${sessionId === '' ? '' : `?sessionId=${encodeURIComponent(sessionId)}`}`)
    update({ loading: false, response, sessionId, error: '' })
  } catch (error: unknown) {
    update({ loading: false, error: publicError(error) })
  }
}

async function request(path: string, init?: RequestInit): Promise<ProductResponse> {
  const response = await fetch(`${API}/${path}`, init)
  const value = await response.json() as ProductResponse | { readonly error?: unknown }
  if (!response.ok || (value as { readonly ok?: unknown }).ok !== true) {
    const error = 'error' in value ? value.error : undefined
    throw new Error(typeof error === 'string' ? error : `RP product request failed (${String(response.status)})`)
  }
  return value as ProductResponse
}

async function applyComposition(response: ProductResponse, draft: CompositionDraft): Promise<void> {
  const ctx = context
  if (ctx === undefined || response.sessionId === '') return
  const binding = ctx.sessions.binding(response.sessionId)
  if (binding === undefined) { update({ error: '当前 DSH 会话尚未建立客户端绑定' }); return }
  update({ saving: true, error: '', notice: '' })
  try {
    const payload = base64Url(JSON.stringify({
      sessionId: response.sessionId,
      baseRevision: response.state.revision,
      ...draft,
    }))
    const receipt = await binding.session.command(`/rp-studio-bind ${payload}`)
    if (!receipt.ok || receipt.value?.matched !== true || receipt.value.result?.kind === 'error') {
      throw new Error(receipt.value?.result?.text ?? receipt.error?.message ?? 'DSH 拒绝了 RP 会话编排')
    }
    update({ saving: false, notice: receipt.value.result?.text ?? 'RP 设定已应用到当前会话' })
    await loadProduct(response.sessionId)
  } catch (error: unknown) {
    update({ saving: false, error: publicError(error) })
  }
}

async function saveEntity(
  kind: ProductEntityKind,
  selectedId: string,
  draft: Record<string, string>,
  response: ProductResponse,
): Promise<void> {
  update({ saving: true, error: '', notice: '' })
  try {
    const id = selectedId || slug(draft.name || entityLabel(kind))
    const next = await request('entity', {
      method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({
        kind, baseRevision: response.state.revision, sessionId: response.sessionId,
        entity: { ...draft, id, updatedAt: Date.now() },
      }),
    })
    update({ saving: false, response: next, notice: `已保存${entityLabel(kind)}“${draft.name}”` })
  } catch (error: unknown) { update({ saving: false, error: publicError(error) }) }
}

async function deleteEntity(kind: ProductEntityKind, id: string, response: ProductResponse): Promise<void> {
  update({ saving: true, error: '', notice: '' })
  try {
    const next = await request('entity', {
      method: 'DELETE', headers: jsonHeaders(), body: JSON.stringify({
        kind, id, baseRevision: response.state.revision, sessionId: response.sessionId,
      }),
    })
    update({ saving: false, response: next, notice: `已删除${entityLabel(kind)}` })
  } catch (error: unknown) { update({ saving: false, error: publicError(error) }) }
}

function compositionDraft(response: ProductResponse): CompositionDraft {
  const binding = response.binding
  return Object.freeze({
    systemId: binding?.systemId ?? response.state.systems[0]?.id ?? '',
    characterIds: binding?.characterIds ?? (response.state.characters[0] === undefined ? [] : [response.state.characters[0].id]),
    primaryCharacterId: binding?.primaryCharacterId ?? response.state.characters[0]?.id ?? '',
    personaId: binding?.personaId ?? response.state.personas[0]?.id ?? '',
    worldId: binding?.worldId ?? response.state.worlds[0]?.id ?? '',
    scene: binding?.scene ?? '',
  })
}

function previewLayers(state: ProductState, sessionId: string, draft: CompositionDraft): readonly PromptLayer[] {
  const id = sessionId || '__preview__'
  const synthetic: ProductState = {
    ...state,
    bindings: { ...state.bindings, [id]: { sessionId: id, ...draft, updatedAt: Date.now() } },
  }
  return resolveLayers(synthetic, id)
}

function resolveLayers(state: ProductState, sessionId: string): readonly PromptLayer[] {
  const binding = state.bindings[sessionId]
  const system = state.systems.find(item => item.id === binding?.systemId)
  const world = state.worlds.find(item => item.id === binding?.worldId)
  const persona = state.personas.find(item => item.id === binding?.personaId)
  const characters = binding?.characterIds.map(id => state.characters.find(item => item.id === id)).filter(isCharacter) ?? []
  const primary = characters.find(item => item.id === binding?.primaryCharacterId) ?? characters[0]
  return [
    clientLayer('system', '系统规则', system?.name, system === undefined ? '' : `${system.directive}\n叙事语调：${system.tone}\n边界：${system.boundaries}`, '#8b7cf6'),
    clientLayer('world', '世界观', world?.name, world === undefined ? '' : `${world.overview}\n世界规则：${world.rules}\n重要地点：${world.locations}\n背景知识：${world.lore}`, world?.accent ?? '#42b883'),
    clientLayer('character', '角色阵容', primary?.name, characters.map(item => `${item.name}：${item.summary}\n性格：${item.personality}\n说话方式：${item.speechStyle}`).join('\n\n'), primary?.accent ?? '#f47f6b'),
    clientLayer('persona', '用户人设', persona?.name, persona === undefined ? '' : `${persona.description}\n特征：${persona.traits}\n关系：${persona.relationship}\n称呼：${persona.addressAs}`, '#36b8d4'),
    clientLayer('scene', '当前场景', binding?.scene === '' || binding === undefined ? undefined : '会话场景', binding?.scene ?? '', '#e7a84f'),
  ]
}

function clientLayer(kind: PromptLayer['kind'], title: string, subtitle: string | undefined, content: string, accent: string): PromptLayer {
  return { kind, title, subtitle: subtitle ?? '未设置', content, accent, empty: content.trim() === '' }
}

function isCharacter(value: CharacterProfile | undefined): value is CharacterProfile { return value !== undefined }

function entityFields(kind: ProductEntityKind): readonly { readonly key: string; readonly label: string; readonly note: string; readonly rows: number }[] {
  const common = [{ key: 'name', label: '名称', note: '在选择器和上下文标签中显示', rows: 1 }]
  switch (kind) {
    case 'systems': return [...common,
      { key: 'directive', label: '系统指令', note: '定义模型如何回应，而不是扮演谁', rows: 5 },
      { key: 'tone', label: '叙事语调', note: '语言风格、节奏和镜头感', rows: 3 },
      { key: 'boundaries', label: '语义边界', note: '系统、角色、Persona 与世界观之间不可越过的边界', rows: 4 }]
    case 'characters': return [...common,
      { key: 'summary', label: '角色摘要', note: '角色身份与故事位置', rows: 3 },
      { key: 'personality', label: '性格', note: '稳定行为倾向，不包含用户身份', rows: 4 },
      { key: 'speechStyle', label: '说话方式', note: '语气、用词和表达习惯', rows: 3 },
      { key: 'appearance', label: '外观', note: '可观察的形象特征', rows: 3 },
      { key: 'goals', label: '目标', note: '角色自己的欲望与矛盾', rows: 3 },
      { key: 'openingMessage', label: '开场白', note: '创建新故事时的建议开场', rows: 4 },
      { key: 'accent', label: '角色色', note: '用于界面识别不同角色', rows: 1 }]
    case 'personas': return [...common,
      { key: 'description', label: '用户身份', note: '明确这是用户扮演的人，不是模型角色', rows: 4 },
      { key: 'traits', label: '用户特征', note: '性格、能力和已知背景', rows: 3 },
      { key: 'relationship', label: '关系背景', note: '用户与角色的既有关系', rows: 3 },
      { key: 'addressAs', label: '称呼', note: '角色应该如何称呼用户', rows: 1 }]
    case 'worlds': return [...common,
      { key: 'overview', label: '世界概览', note: '时代、地点与整体氛围', rows: 4 },
      { key: 'rules', label: '世界规则', note: '客观规律、禁忌和能力限制', rows: 5 },
      { key: 'locations', label: '重要地点', note: '可进入或可引用的场所', rows: 4 },
      { key: 'lore', label: '历史与知识', note: '传说、事件、阵营与背景事实', rows: 6 },
      { key: 'accent', label: '世界色', note: '用于界面识别不同世界', rows: 1 }]
  }
}

function emptyDraft(kind: ProductEntityKind): Record<string, string> {
  return Object.fromEntries(entityFields(kind).map(field => [field.key, field.key === 'accent' ? kindAccent(kind) : '']))
}

function entityDraft(entity: ProductEntity): Record<string, string> {
  return Object.fromEntries(Object.entries(entity).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function entityAccent(entity: ProductEntity, kind: ProductEntityKind): string {
  return 'accent' in entity && typeof entity.accent === 'string' ? entity.accent : kindAccent(kind)
}

function entitySummary(entity: ProductEntity, kind: ProductEntityKind): string {
  switch (kind) {
    case 'systems': return truncate((entity as SystemProfile).directive, 48)
    case 'characters': return truncate((entity as CharacterProfile).summary, 48)
    case 'personas': return truncate((entity as PersonaProfile).description, 48)
    case 'worlds': return truncate((entity as WorldProfile).overview, 48)
  }
}

function kindAccent(kind: ProductEntityKind): string {
  return kind === 'systems' ? '#8b7cf6' : kind === 'characters' ? '#f47f6b' : kind === 'personas' ? '#36b8d4' : '#42b883'
}

function entityLabel(kind: ProductEntityKind): string {
  return kind === 'systems' ? '系统规则' : kind === 'characters' ? '角色' : kind === 'personas' ? '用户人设' : '世界观'
}

function entityEditorHint(kind: ProductEntityKind): string {
  return kind === 'systems' ? '定义模型的叙事职责和不可越过的边界。'
    : kind === 'characters' ? '定义模型要扮演的人物；一个会话可以选择多个角色。'
      : kind === 'personas' ? '定义用户在故事中的身份；不同会话可以使用不同 Persona。'
        : '维护环境、历史和客观规律，不替角色决定行动。'
}

function sectionTitle(section: ProductSection): string { return section === 'compose' ? '会话编排' : entityLabel(section) }

function sectionDescription(section: ProductSection): string {
  return section === 'compose' ? '把系统、世界、角色、Persona 与场景组合成一份可审计的对话上下文。' : entityEditorHint(section)
}

function currentSessionId(ctx: ClientContext): string { return ctx.sessions.list.getSnapshot().current ?? '' }

function sessionIdFromProps(props: Record<string, unknown>): string {
  if (typeof props.sessionId === 'string') return props.sessionId
  if (typeof props.session === 'object' && props.session !== null && 'id' in props.session
    && typeof (props.session as { id?: unknown }).id === 'string') return (props.session as { id: string }).id
  return context === undefined ? '' : currentSessionId(context)
}

function openProduct(section: ProductSection, sessionId = context === undefined ? '' : currentSessionId(context)): void {
  update({ open: true, embedded: false, section, sessionId, error: '', notice: '' })
  void loadProduct(sessionId)
}

function closeProduct(): void { update({ open: false }) }

function jsonHeaders(): HeadersInit { return { 'content-type': 'application/json' } }

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '')
}

function slug(value: string): string {
  const normalized = value.normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return (normalized || `item-${crypto.randomUUID()}`).slice(0, 96)
}

function publicError(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function shortId(value: string): string { return value.length <= 14 ? value : `${value.slice(0, 7)}…${value.slice(-5)}` }
function truncate(value: string, max: number): string { return value.length <= max ? value : `${value.slice(0, max - 1)}…` }

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = PRODUCT_CSS
  document.head.appendChild(style)
}

function removeStyles(): void { document.getElementById(STYLE_ID)?.remove() }

const PRODUCT_CSS = String.raw`
:root{--rpp-bg:#0d1018;--rpp-panel:#151925;--rpp-panel-2:#1b2030;--rpp-line:rgba(255,255,255,.095);--rpp-muted:#8d96a9;--rpp-text:#edf0f7;--rpp-purple:#8b7cf6}
.rpp-overlay{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;padding:28px;background:rgba(5,7,12,.72);backdrop-filter:blur(18px);pointer-events:auto;animation:rpp-fade .18s ease-out}.rpp-modal{width:min(1160px,calc(100vw - 48px));height:min(780px,calc(100vh - 56px));overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:var(--rpp-bg);box-shadow:0 30px 100px rgba(0,0,0,.55),0 0 0 1px rgba(139,124,246,.08);animation:rpp-rise .24s cubic-bezier(.2,.9,.2,1)}
.rpp-shell{display:grid;grid-template-columns:244px minmax(0,1fr);width:100%;height:100%;min-height:0;color:var(--rpp-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:radial-gradient(circle at 84% -8%,rgba(139,124,246,.12),transparent 31%),var(--rpp-bg)}.rpp-shell-embedded{min-height:680px;height:calc(100vh - 160px);max-height:780px;border:1px solid var(--rpp-line);border-radius:18px;overflow:hidden}
.rpp-nav{display:flex;flex-direction:column;min-width:0;padding:22px 14px 14px;border-right:1px solid var(--rpp-line);background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012))}.rpp-brand{display:flex;align-items:center;gap:12px;padding:2px 9px 22px}.rpp-brand-mark,.rpp-mark{display:grid;place-items:center;color:white;background:linear-gradient(145deg,#8b7cf6,#5d52bf);box-shadow:0 8px 24px rgba(95,82,191,.3)}.rpp-brand-mark{width:40px;height:40px;border-radius:14px;font-family:serif;font-size:19px}.rpp-brand>span:last-child{display:flex;flex-direction:column;min-width:0}.rpp-brand strong{font-size:15px;letter-spacing:.02em}.rpp-brand small{margin-top:2px;color:var(--rpp-muted);font-size:10px;letter-spacing:.04em}.rpp-nav nav{display:flex;flex-direction:column;gap:5px}.rpp-nav nav button{display:grid;grid-template-columns:32px minmax(0,1fr);align-items:center;gap:8px;width:100%;min-height:55px;padding:7px 9px;border:1px solid transparent;border-radius:13px;color:var(--rpp-muted);background:transparent;text-align:left;cursor:pointer;transition:.16s ease}.rpp-nav nav button:hover{color:var(--rpp-text);background:rgba(255,255,255,.045)}.rpp-nav nav button.rpp-nav-active{color:var(--rpp-text);border-color:rgba(139,124,246,.25);background:linear-gradient(90deg,rgba(139,124,246,.17),rgba(139,124,246,.045));box-shadow:inset 3px 0 #8b7cf6}.rpp-nav-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:rgba(255,255,255,.055);font-size:15px}.rpp-nav nav button>span:last-child{display:flex;flex-direction:column;gap:2px;min-width:0}.rpp-nav nav b{font-size:13px;font-weight:600}.rpp-nav nav small{overflow:hidden;color:inherit;font-size:9px;text-overflow:ellipsis;white-space:nowrap;opacity:.72}.rpp-nav-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding:12px 9px 4px;color:var(--rpp-muted);font-size:10px}.rpp-status-dot{width:7px;height:7px;border-radius:50%;background:#55d89a;box-shadow:0 0 10px rgba(85,216,154,.75)}
.rpp-main{display:flex;flex-direction:column;min-width:0;min-height:0}.rpp-main-header{display:flex;justify-content:space-between;gap:20px;padding:26px 30px 20px;border-bottom:1px solid var(--rpp-line);background:rgba(13,16,24,.5)}.rpp-main-header h2{margin:3px 0 4px;font-family:Georgia,'Noto Serif SC',serif;font-size:25px;font-weight:500;letter-spacing:.02em}.rpp-main-header p{margin:0;color:var(--rpp-muted);font-size:12px}.rpp-eyebrow{color:#9c90ff;font-size:9px;font-weight:700;letter-spacing:.16em}.rpp-close{width:34px;height:34px;border:1px solid var(--rpp-line);border-radius:11px;color:var(--rpp-muted);background:rgba(255,255,255,.035);font-size:23px;line-height:1;cursor:pointer}.rpp-close:hover{color:white;background:rgba(255,255,255,.075)}.rpp-content{min-height:0;flex:1;overflow:auto;padding:24px 30px 30px}.rpp-banner{margin-bottom:16px;padding:11px 14px;border-radius:11px;font-size:12px}.rpp-banner-error{color:#ffc1c1;border:1px solid rgba(255,104,104,.25);background:rgba(255,84,84,.09)}.rpp-banner-success{color:#bdf4d7;border:1px solid rgba(85,216,154,.25);background:rgba(85,216,154,.09)}
.rpp-compose-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(300px,.92fr);gap:24px;min-height:0}.rpp-compose-controls,.rpp-preview{min-width:0}.rpp-section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px}.rpp-section-heading>span:first-child{display:flex;flex-direction:column;gap:3px}.rpp-section-heading b{font-size:14px}.rpp-section-heading small{color:var(--rpp-muted);font-size:10px}.rpp-revision{padding:4px 7px;border:1px solid var(--rpp-line);border-radius:6px;color:var(--rpp-muted);font-family:monospace;font-size:9px}.rpp-field{display:grid;grid-template-columns:150px minmax(0,1fr);align-items:start;gap:14px;margin-bottom:11px;padding:14px;border:1px solid var(--rpp-line);border-radius:14px;background:rgba(255,255,255,.026);box-shadow:inset 3px 0 var(--rpp-accent)}.rpp-field-copy{display:flex;flex-direction:column;gap:4px}.rpp-field-copy b{font-size:12px}.rpp-field-copy small{color:var(--rpp-muted);font-size:9px;line-height:1.45}.rpp-field select,.rpp-field textarea,.rpp-editor input,.rpp-editor textarea{box-sizing:border-box;width:100%;border:1px solid var(--rpp-line);border-radius:9px;outline:none;color:var(--rpp-text);background:#10141e;font:inherit;font-size:11px;transition:border .15s,box-shadow .15s}.rpp-field select,.rpp-editor input{height:36px;padding:0 10px}.rpp-field textarea,.rpp-editor textarea{padding:9px 10px;resize:vertical;line-height:1.55}.rpp-field select:focus,.rpp-field textarea:focus,.rpp-editor input:focus,.rpp-editor textarea:focus{border-color:color-mix(in srgb,var(--rpp-accent,#8b7cf6) 65%,white);box-shadow:0 0 0 3px color-mix(in srgb,var(--rpp-accent,#8b7cf6) 14%,transparent)}.rpp-choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.rpp-choice-card{overflow:hidden;border:1px solid var(--rpp-line);border-radius:11px;background:#10141e}.rpp-choice-selected{border-color:color-mix(in srgb,var(--rpp-accent) 55%,transparent);background:color-mix(in srgb,var(--rpp-accent) 8%,#10141e)}.rpp-choice-main{display:grid;grid-template-columns:31px minmax(0,1fr) 20px;align-items:center;gap:8px;width:100%;padding:8px;border:0;color:inherit;background:transparent;text-align:left;cursor:pointer}.rpp-avatar,.rpp-entity-avatar{display:grid;place-items:center;flex:none;color:white;background:linear-gradient(145deg,var(--rpp-accent),color-mix(in srgb,var(--rpp-accent) 55%,black));font-family:Georgia,serif}.rpp-avatar{width:31px;height:31px;border-radius:9px}.rpp-choice-main>span:nth-child(2){display:flex;flex-direction:column;min-width:0}.rpp-choice-main b{font-size:11px}.rpp-choice-main small{overflow:hidden;color:var(--rpp-muted);font-size:8px;text-overflow:ellipsis;white-space:nowrap}.rpp-choice-main i{font-style:normal;color:var(--rpp-accent)}.rpp-primary{width:100%;padding:5px;border:0;border-top:1px solid var(--rpp-line);color:var(--rpp-muted);background:rgba(255,255,255,.02);font-size:8px;cursor:pointer}.rpp-primary-active{color:var(--rpp-accent);font-weight:700}.rpp-compose-actions{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:17px}.rpp-compose-actions>span{color:var(--rpp-muted);font-size:10px}.rpp-primary-action,.rpp-danger-action{min-height:36px;padding:0 15px;border-radius:10px;font:inherit;font-size:11px;font-weight:650;cursor:pointer}.rpp-primary-action{border:1px solid rgba(255,255,255,.11);color:white;background:linear-gradient(135deg,#8b7cf6,#6657d2);box-shadow:0 9px 24px rgba(98,82,210,.25)}.rpp-primary-action:hover{filter:brightness(1.08)}.rpp-primary-action:disabled{cursor:not-allowed;filter:grayscale(.7);opacity:.45}.rpp-danger-action{border:1px solid rgba(255,105,105,.22);color:#ffb9b9;background:rgba(255,80,80,.07)}
.rpp-preview{position:sticky;top:0;align-self:start;padding:17px;border:1px solid var(--rpp-line);border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.038),rgba(255,255,255,.018))}.rpp-preview-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}.rpp-preview-heading span{font-size:12px;font-weight:650}.rpp-preview-heading small{color:var(--rpp-muted);font-size:9px}.rpp-layer-stack{display:flex;flex-direction:column;gap:8px}.rpp-layer-card{position:relative;display:grid;grid-template-columns:27px minmax(0,1fr);gap:9px;padding:11px;border:1px solid color-mix(in srgb,var(--rpp-accent) 25%,var(--rpp-line));border-radius:12px;background:linear-gradient(100deg,color-mix(in srgb,var(--rpp-accent) 9%,transparent),rgba(255,255,255,.016));overflow:hidden}.rpp-layer-card:before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:var(--rpp-accent)}.rpp-layer-index{padding-top:1px;color:var(--rpp-accent);font-family:monospace;font-size:9px}.rpp-layer-kind{color:var(--rpp-accent);font-size:8px;font-weight:700;letter-spacing:.12em}.rpp-layer-card h3{margin:2px 0 3px;font-size:12px}.rpp-layer-card p{display:-webkit-box;overflow:hidden;margin:0;color:var(--rpp-muted);font-size:9px;line-height:1.45;-webkit-line-clamp:3;-webkit-box-orient:vertical;white-space:pre-line}.rpp-layer-empty{filter:saturate(.2);opacity:.55}.rpp-preview-note{display:flex;flex-direction:column;gap:4px;margin-top:13px;padding:12px;border-radius:11px;color:var(--rpp-muted);background:rgba(139,124,246,.065);font-size:9px;line-height:1.5}.rpp-preview-note b{color:#b9b0ff;font-size:10px}
.rpp-manager{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:540px;border:1px solid var(--rpp-line);border-radius:17px;overflow:hidden;background:rgba(255,255,255,.018)}.rpp-entity-list{display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--rpp-line);background:rgba(255,255,255,.018)}.rpp-list-heading{display:flex;align-items:center;justify-content:space-between;padding:14px;border-bottom:1px solid var(--rpp-line)}.rpp-list-heading span{font-size:11px;font-weight:650}.rpp-list-heading button{border:0;color:#aaa1ff;background:transparent;font-size:9px;cursor:pointer}.rpp-list-scroll{overflow:auto;padding:8px}.rpp-list-scroll>button{display:grid;grid-template-columns:37px minmax(0,1fr);align-items:center;gap:9px;width:100%;margin-bottom:4px;padding:8px;border:1px solid transparent;border-radius:11px;color:var(--rpp-muted);background:transparent;text-align:left;cursor:pointer}.rpp-list-scroll>button:hover{background:rgba(255,255,255,.035)}.rpp-list-scroll>button.rpp-entity-active{color:var(--rpp-text);border-color:var(--rpp-line);background:rgba(139,124,246,.09)}.rpp-entity-avatar{width:37px;height:37px;border-radius:11px}.rpp-list-scroll>button>span:last-child{display:flex;flex-direction:column;min-width:0;gap:2px}.rpp-list-scroll b{font-size:11px}.rpp-list-scroll small{overflow:hidden;font-size:8px;text-overflow:ellipsis;white-space:nowrap;opacity:.7}.rpp-editor{display:flex;flex-direction:column;min-width:0;padding:22px}.rpp-editor-hero{display:flex;align-items:center;gap:14px;margin-bottom:22px}.rpp-editor-orb{display:grid;place-items:center;width:55px;height:55px;border-radius:18px;color:white;background:radial-gradient(circle at 30% 20%,color-mix(in srgb,var(--rpp-accent) 75%,white),var(--rpp-accent));box-shadow:0 12px 34px color-mix(in srgb,var(--rpp-accent) 25%,transparent);font-family:Georgia,serif;font-size:23px}.rpp-editor-hero>span:last-child{display:flex;flex-direction:column}.rpp-editor-hero h3{margin:3px 0 2px;font-family:Georgia,'Noto Serif SC',serif;font-size:21px;font-weight:500}.rpp-editor-hero p{margin:0;color:var(--rpp-muted);font-size:10px}.rpp-editor-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.rpp-editor-field{display:flex;flex-direction:column;gap:6px}.rpp-editor-field-wide{grid-column:1/-1}.rpp-editor-field>span{display:flex;justify-content:space-between;color:var(--rpp-text);font-size:10px}.rpp-editor-field small{color:var(--rpp-muted);font-size:8px}.rpp-editor input[type=color]{width:100%;padding:4px}.rpp-editor-actions{display:flex;justify-content:space-between;gap:10px;margin-top:auto;padding-top:22px}
.rpp-header-context,.rpp-context-dock,.rpp-sidebar-action{font:inherit}.rpp-header-context{display:flex;align-items:center;gap:7px;height:27px;padding:0 9px;border:1px solid rgba(139,124,246,.2);border-radius:8px;color:#c9c4ff;background:rgba(139,124,246,.08);font-size:10px;cursor:pointer}.rpp-header-context:hover{background:rgba(139,124,246,.14)}.rpp-header-context-empty{color:var(--dsw-alias-label-tertiary,#9299a8);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.18));background:transparent}.rpp-stack-icon{position:relative;display:block;width:13px;height:13px}.rpp-stack-icon i{position:absolute;left:1px;width:10px;height:5px;border:1px solid currentColor;border-radius:2px;background:inherit}.rpp-stack-icon i:nth-child(1){top:1px}.rpp-stack-icon i:nth-child(2){top:4px}.rpp-stack-icon i:nth-child(3){top:7px}.rpp-context-dock{box-sizing:border-box;display:flex;align-items:center;gap:9px;width:100%;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:11px;color:var(--dsw-alias-label-primary,#e8eaf0);background:color-mix(in srgb,var(--dsw-alias-bg-raised,#171a22) 88%,#8b7cf6 12%);text-align:left;cursor:pointer}.rpp-context-dock-label{flex:none;color:var(--dsw-alias-label-tertiary,#9299a8);font-size:9px;text-transform:uppercase;letter-spacing:.08em}.rpp-context-dock-layers{display:flex;align-items:center;gap:5px;min-width:0;flex:1;overflow:hidden}.rpp-mini-layer{display:flex;align-items:center;gap:4px;min-width:0;padding:3px 6px;border-left:2px solid var(--rpp-accent);border-radius:5px;background:color-mix(in srgb,var(--rpp-accent) 8%,transparent);font-size:8px}.rpp-mini-layer b{color:var(--rpp-accent);white-space:nowrap}.rpp-mini-layer span{overflow:hidden;max-width:82px;color:var(--dsw-alias-label-secondary,#babfca);text-overflow:ellipsis;white-space:nowrap}.rpp-mini-layer-empty{opacity:.45}.rpp-context-edit{flex:none;color:#aaa1ff;font-size:9px}.rpp-sidebar-action{box-sizing:border-box;display:flex;align-items:center;border:0;color:var(--dsw-alias-label-primary,#e8eaf0);background:transparent;cursor:pointer}.rpp-sidebar-action-wide{width:calc(100% + 8px);height:34px;gap:8px;margin:4px -4px;padding:5px 4px 5px 9px;border-radius:12px;font-size:13px}.rpp-sidebar-action-wide:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}.rpp-sidebar-action-rail{width:36px;height:36px;justify-content:center;margin:6px 0;border-radius:50%}.rpp-mark{width:22px;height:22px;border-radius:8px;font-family:serif;font-size:11px}
.rpp-loading{display:flex;min-height:380px;flex-direction:column;align-items:center;justify-content:center;color:var(--rpp-muted);gap:6px}.rpp-loading-orb{width:34px;height:34px;margin-bottom:8px;border:2px solid rgba(139,124,246,.2);border-top-color:#8b7cf6;border-radius:50%;animation:rpp-spin .8s linear infinite}.rpp-loading b{color:var(--rpp-text);font-size:12px}.rpp-loading small{font-size:9px}
@keyframes rpp-spin{to{transform:rotate(360deg)}}@keyframes rpp-fade{from{opacity:0}to{opacity:1}}@keyframes rpp-rise{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
@media(max-width:860px){.rpp-overlay{padding:10px}.rpp-modal{width:calc(100vw - 20px);height:calc(100vh - 20px);border-radius:17px}.rpp-shell{grid-template-columns:76px minmax(0,1fr)}.rpp-brand{justify-content:center;padding-inline:0}.rpp-brand>span:last-child,.rpp-nav nav button>span:last-child,.rpp-nav-foot span:last-child{display:none}.rpp-nav nav button{display:flex;justify-content:center;padding:6px}.rpp-compose-grid{grid-template-columns:1fr}.rpp-preview{position:static}.rpp-field{grid-template-columns:1fr}.rpp-manager{grid-template-columns:1fr}.rpp-entity-list{max-height:210px;border-right:0;border-bottom:1px solid var(--rpp-line)}.rpp-editor-fields{grid-template-columns:1fr}.rpp-editor-field-wide{grid-column:auto}.rpp-context-dock-layers{overflow-x:auto}.rpp-mini-layer span{display:none}}
@media(max-width:560px){.rpp-shell{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.rpp-nav{padding:9px;border-right:0;border-bottom:1px solid var(--rpp-line)}.rpp-brand{display:none}.rpp-nav nav{display:grid;grid-template-columns:repeat(5,1fr);gap:3px}.rpp-nav nav button{min-height:40px}.rpp-nav-icon{width:27px;height:27px}.rpp-nav-foot{display:none}.rpp-main-header{padding:17px}.rpp-main-header p{display:none}.rpp-content{padding:14px}.rpp-choice-grid{grid-template-columns:1fr}.rpp-shell-embedded{height:calc(100vh - 120px)}.rpp-context-dock-label{display:none}}
`
