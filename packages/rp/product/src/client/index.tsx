/** DSH Web product surface for Tavern-style RP composition and conversation. */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
import type {
  CharacterProfile,
  PersonaProfile,
  ProductEntity,
  ProductEntityKind,
  ProductState,
  PromptLayer,
  PromptPreset,
  SessionComposition,
  SessionRuntimeState,
  SessionTranscript,
  SystemProfile,
  WorldEntry,
  WorldProfile,
} from '../model.ts'
import { PRODUCT_PROMPT_SEAT_COUNT, resolvePromptLayers } from '../model.ts'

export const name = '@dsh-rp/product'
export const inject = ['slots', 'sessions', 'connection', 'workspaces']

const API = '/api/dsh-rp/product'
const STYLE_ID = 'dsh-rp-product-styles'
const MAX_IMPORT_FILES = 32
const MAX_IMPORT_FILE_BYTES = 32 * 1024 * 1024

interface SessionListSnapshot { readonly current?: string | null; readonly byId: Readonly<Record<string, unknown>> }
interface CommandReceipt {
  readonly ok: boolean
  readonly value?: { readonly matched?: boolean; readonly result?: { readonly kind?: string; readonly text?: string } }
  readonly error?: { readonly message?: string }
}
interface PromptReceipt { readonly ok: boolean; readonly error?: { readonly message?: string } }

interface AgentPresetOption {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly isDefault: boolean
}

interface AgentPresetSeatState {
  readonly options: readonly AgentPresetOption[]
  readonly current: string
  readonly busy: boolean
  readonly error: string
}

type WireResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }

interface ClientContext {
  readonly slots: {
    inject(name: string, factory: () => unknown): unknown
    register(options: Record<string, unknown>, component: (props: Record<string, unknown>) => ReactNode): unknown
  }
  readonly sessions: {
    readonly list: { getSnapshot(): SessionListSnapshot; subscribe(listener: () => void): () => void }
    noteAgentPreset(sessionId: string, agentPreset: string): void
    binding(sessionId: string): { readonly session: {
      command(line: string): Promise<CommandReceipt>
      prompt(content: readonly { readonly type: 'text'; readonly text: string }[], mode: 'queue'): Promise<PromptReceipt>
    } } | undefined
  }
  readonly workspaces: { startSession(): void }
  readonly connection: { readonly api: { readonly agentPresets: {
    list(payload: Record<string, never>): Promise<{ readonly result: WireResult<{ readonly presets: readonly {
      readonly id: string
      readonly name?: string
      readonly description?: string
      readonly isDefault: boolean
      readonly broken?: string
    }[] }> }>
    select(payload: { readonly sessionId: string; readonly agentPreset: string }): Promise<{
      readonly result: WireResult<{ readonly agentPreset: string }>
    }>
  } } }
  effect(factory: () => (() => void) | void, label?: string): unknown
}

interface ImportReport {
  readonly fileName: string
  readonly kind: 'character' | 'persona' | 'world' | 'preset' | 'error'
  readonly ids: readonly string[]
  readonly names: readonly string[]
  readonly warnings: readonly string[]
  readonly error?: string
}

interface ProductResponse {
  readonly ok: true
  readonly state: ProductState
  readonly sessionId: string
  readonly binding?: SessionComposition
  readonly layers: readonly PromptLayer[]
  readonly transcript?: SessionTranscript
  readonly runtime?: SessionRuntimeState
  readonly agentPresetId: string
  readonly importReports?: readonly ImportReport[]
  readonly adaptedPresetId?: string
}

type EditableKind = Exclude<ProductEntityKind, 'presets'>
type ProductSection = 'compose' | 'import' | ProductEntityKind

interface ProductClientState {
  readonly open: boolean
  readonly embedded: boolean
  readonly section: ProductSection
  readonly sessionId: string
  readonly loading: boolean
  readonly saving: boolean
  readonly error: string
  readonly notice: string
  readonly preferredPresetId: string
  readonly response: ProductResponse | undefined
}

let context: ClientContext | undefined
let snapshot: ProductClientState = Object.freeze({
  open: false, embedded: false, section: 'compose', sessionId: '', loading: false, saving: false,
  error: '', notice: '', preferredPresetId: '', response: undefined,
})
const listeners = new Set<() => void>()
const agentPresetListeners = new Set<() => void>()
let agentPresetSnapshot: AgentPresetSeatState = Object.freeze({ options: [], current: '', busy: false, error: '' })
let stagedAgentPreset: string | undefined
let fallbackAgentPreset = ''
let applyingAgentPreset: Promise<void> | undefined

/** Register product management, context surfaces, and the RP conversation view. */
export function apply(ctx: ClientContext): void {
  context = ctx
  ensureStyles()
  ctx.effect(() => {
    const dispose = ctx.sessions.list.subscribe(() => {
      const sessionId = currentSessionId(ctx)
      if (sessionId !== snapshot.sessionId) {
        update({ sessionId, response: undefined, error: '', notice: '', preferredPresetId: '' })
        void loadProduct(sessionId)
      }
      void applyStagedAgentPreset()
    })
    return () => { dispose(); context = undefined; removeStyles() }
  }, 'dsh-rp-product: client lifetime')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dsh-rp-product', order: 18, label: 'RP 创作室',
  }, props => <ProductPanel embedded {...(typeof props.close === 'function' ? { close: props.close as () => void } : {})} />))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'dsh-rp-product-context', order: -40, label: 'RP Context',
  }, props => <ConversationContextButton sessionId={sessionIdFromProps(props)} />))
  ctx.slots.inject('conversation.hero.agentPreset', () => ctx.slots.register({
    name: 'conversation.hero.agentPreset', priority: -40,
  }, () => <RpAgentPresetSeat />))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'dsh-rp-product-stack', order: -40,
  }, props => <ConversationContextDock sessionId={sessionIdFromProps(props)} />))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'rp-story', order: -5, label: '角色对话',
  }, props => <RpConversationSeat {...props} />))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'dsh-rp-product-panel', order: 30,
  }, () => <ProductOverlay />))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'dsh-rp-product-open', order: 20, label: 'RP 创作室',
  }, props => <SidebarAction wide={props.wide === true} />))

  const sessionId = currentSessionId(ctx)
  update({ sessionId })
  void loadAgentPresetOptions()
  void loadProduct(sessionId)
}

function ProductOverlay(): ReactNode {
  const state = useProductState()
  if (!state.open || state.embedded) return null
  return <div className="rpp-overlay" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) closeProduct()
  }}>
    <div className="rpp-modal" role="dialog" aria-modal="true" aria-label="RP 创作室"><ProductPanel close={closeProduct} /></div>
  </div>
}

function SidebarAction({ wide }: { readonly wide: boolean }): ReactNode {
  return <button type="button" className={`rpp-sidebar-action ${wide ? 'rpp-sidebar-action-wide' : 'rpp-sidebar-action-rail'}`}
    aria-label="打开 RP 创作室" title="RP 创作室" onClick={() => openProduct('compose')}>
    <span className="rpp-mark" aria-hidden="true">织</span>{wide ? <span>RP 创作室</span> : null}
  </button>
}

function RpAgentPresetSeat(): ReactNode {
  const state = useAgentPresetSeat()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  const selected = state.options.find(option => option.id === state.current)
  if (selected === undefined) return null
  return <div className="rpp-agent-seat" ref={root}>
    <button type="button" className="rpp-agent-seat-button" aria-haspopup="menu" aria-expanded={open}
      disabled={state.busy} title={state.error || '选择新会话使用的 Agent Preset'} onClick={() => setOpen(value => !value)}>
      <span aria-hidden="true" className="rpp-agent-seat-icon">◌</span><span>{selected.name}</span><span aria-hidden="true" className="rpp-agent-seat-chevron">⌄</span>
    </button>
    {open ? <div className="rpp-agent-seat-menu" role="menu">{state.options.map(option => <button type="button" role="menuitem"
      key={option.id} className={option.id === state.current ? 'rpp-agent-seat-selected' : ''} onClick={() => {
        setOpen(false); void selectAgentPreset(option.id)
      }}><span><b>{option.name}</b><small>{option.description || '没有说明'}</small></span>{option.id === state.current ? <i>✓</i> : null}</button>)}</div> : null}
  </div>
}

function ConversationContextButton({ sessionId }: { readonly sessionId: string }): ReactNode {
  const state = useProductState()
  useLoadSession(sessionId)
  const response = state.sessionId === sessionId ? state.response : undefined
  const character = response?.state.characters.find(item => item.id === response.binding?.primaryCharacterId)
  const preset = response?.state.presets.find(item => item.id === response.binding?.presetId)
  return <button type="button" className={`rpp-header-context ${response?.binding === undefined ? 'rpp-header-context-empty' : ''}`}
    onClick={() => openProduct('compose', sessionId)} title="编辑 RP 会话编排">
    <span className="rpp-stack-icon"><i /><i /><i /></span>
    <span>{character === undefined ? '配置 RP' : `${response?.binding?.mode === 'agent' ? 'Agent' : 'Tavern'} · ${character.name} · ${preset?.name ?? '预设'}`}</span>
  </button>
}

function ConversationContextDock({ sessionId }: { readonly sessionId: string }): ReactNode {
  const state = useProductState()
  const agentPreset = useAgentPreset(sessionId)
  useLoadSession(sessionId)
  const response = state.sessionId === sessionId ? state.response : undefined
  const layers = response?.layers ?? []
  if (response?.binding === undefined && (agentPreset === 'rp-tavern' || agentPreset === 'rp-agent')) {
    return <QuickSetup response={response} sessionId={sessionId} mode={agentPreset === 'rp-agent' ? 'agent' : 'tavern'} />
  }
  if (layers.length === 0) return null
  return <button type="button" className="rpp-context-dock" onClick={() => openProduct('compose', sessionId)}>
    <span className="rpp-context-dock-label">Prompt Stack</span>
    <span className="rpp-context-dock-layers">{layers.slice(0, 8).map((layer, index) => <span key={`${layer.id}:${index}`}
      className={`rpp-mini-layer ${layer.empty ? 'rpp-mini-layer-empty' : ''}`} style={{ '--rpp-accent': layer.accent } as CSSProperties}>
      <b>{String(index + 1).padStart(2, '0')}</b><span>{layer.title}</span>
    </span>)}</span>
    <span className="rpp-context-edit">编辑</span>
  </button>
}

function QuickSetup({ response, sessionId, mode }: {
  readonly response: ProductResponse | undefined
  readonly sessionId: string
  readonly mode: CompositionDraft['mode']
}): ReactNode {
  const initial = useMemo<CompositionDraft>(() => ({
    mode,
    experienceId: 'rp-adaptive',
    presetId: response?.state.presets.find(preset => preset.mode === 'harness')?.id ?? response?.state.presets[0]?.id ?? '',
    systemId: response?.state.systems[0]?.id ?? '',
    characterIds: [], primaryCharacterId: '', personaId: '', worldId: '', scene: '',
  }), [mode, response?.state.revision, sessionId])
  const [draft, setDraft] = useState(initial)
  useEffect(() => setDraft(initial), [initial])
  if (response === undefined) return <section className="rpp-quick-setup"><div className="rpp-loading-orb" /><span>正在加载 RP 资源…</span></section>
  const primary = response.state.characters.find(character => character.id === draft.primaryCharacterId)
  return <section className="rpp-quick-setup" data-rp-quick-setup={mode}>
    <header><span className="rpp-quick-mode">{mode === 'agent' ? 'AGENT RP' : 'TAVERN CHAT'}</span><div><h3>开始前选择本次 RP 资源</h3>
      <p>{mode === 'agent' ? '导入 Preset + 角色资源，并启用世界、时间、状态、记忆与选项工具。' : '使用导入 Preset、角色卡、Persona、世界书与原生历史进行传统酒馆生成。'}</p></div>
      <button type="button" onClick={() => openProduct('compose', sessionId)}>完整设置</button></header>
    <div className="rpp-quick-grid">
      <label>Prompt Preset<select value={draft.presetId} onChange={event => setDraft({ ...draft, presetId: event.target.value })}>
        {response.state.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.mode === 'sillytavern' ? '[ST]' : '[Harness]'} {preset.name}</option>)}</select></label>
      <label>角色卡<select value={draft.primaryCharacterId} onChange={event => {
        const id = event.target.value; setDraft({ ...draft, primaryCharacterId: id, characterIds: id === '' ? [] : [id] })
      }}><option value="">选择主要角色</option>{response.state.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
      <label>Persona<select value={draft.personaId} onChange={event => setDraft({ ...draft, personaId: event.target.value })}><option value="">不使用 Persona</option>
        {response.state.personas.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}</select></label>
      <label>世界书<select value={draft.worldId} onChange={event => setDraft({ ...draft, worldId: event.target.value })}><option value="">不使用世界书</option>
        {response.state.worlds.map(world => <option key={world.id} value={world.id}>{world.name} · {world.entries.filter(entry => entry.enabled).length}/{world.entries.length}</option>)}</select></label>
      {mode === 'agent' ? <label>Experience<select value={draft.experienceId} onChange={event => setDraft({ ...draft, experienceId: event.target.value })}>
        <option value="rp-adaptive">Adaptive · 状态/记忆/场景/关系</option><option value="rp-world-sim">World Simulation</option>
        <option value="rp-multi-character">Multi-character</option><option value="rp-trpg">TRPG</option><option value="rp-companion">Companion</option></select></label> : null}
      <label className="rpp-quick-scene">当前场景<input value={draft.scene} placeholder="地点、时间和当前事实" onChange={event => setDraft({ ...draft, scene: event.target.value })} /></label>
    </div>
    <footer>{primary === undefined ? <span>请选择一个主要角色后开始。</span> : <span><AvatarFace character={primary} className="rpp-quick-avatar" fallback={primary.name.slice(0, 1)} />{primary.name}</span>}
      <button type="button" className="rpp-primary-action" disabled={primary === undefined || draft.presetId === '' || snapshot.saving}
        onClick={() => { void applyComposition(response, draft) }}>{snapshot.saving ? '正在应用…' : `应用并开始 ${mode === 'agent' ? 'Agent RP' : 'Tavern Chat'}`}</button></footer>
  </section>
}

function ProductPanel({ close, embedded = false }: { readonly close?: () => void; readonly embedded?: boolean }): ReactNode {
  const state = useProductState()
  useEffect(() => { update({ embedded }) }, [embedded])
  const response = state.response
  const nav: readonly { id: ProductSection; icon: string; title: string; note: string }[] = [
    { id: 'compose', icon: '◫', title: '会话编排', note: '组合当前故事' },
    { id: 'presets', icon: '≡', title: '预设', note: response === undefined ? 'Prompt Manager' : `${response.state.presets.length} 套` },
    { id: 'characters', icon: '角', title: '角色卡', note: response === undefined ? 'Characters' : `${response.state.characters.length} 张` },
    { id: 'personas', icon: '我', title: '用户人设', note: response === undefined ? 'Personas' : `${response.state.personas.length} 份` },
    { id: 'worlds', icon: '界', title: '世界书', note: response === undefined ? 'Lorebooks' : `${response.state.worlds.length} 本` },
    { id: 'systems', icon: '则', title: '系统规则', note: response === undefined ? 'System' : `${response.state.systems.length} 套` },
    { id: 'import', icon: '⇩', title: '批量导入', note: 'JSON · PNG · CHARX' },
  ]
  return <div className={`rpp-shell ${embedded ? 'rpp-shell-embedded' : ''}`}>
    <aside className="rpp-nav">
      <div className="rpp-brand"><span className="rpp-brand-mark">织</span><span><strong>RP 创作室</strong><small>TAVERN WORKSPACE</small></span></div>
      <nav>{nav.map(item => <button type="button" key={item.id} className={state.section === item.id ? 'rpp-nav-active' : ''}
        onClick={() => update({ section: item.id, error: '', notice: '' })}>
        <span className="rpp-nav-icon">{item.icon}</span><span><b>{item.title}</b><small>{item.note}</small></span>
      </button>)}</nav>
      <div className="rpp-nav-foot"><span className="rpp-status-dot" /><span>本地 Harness · schema v2</span></div>
    </aside>
    <main className="rpp-main">
      <header className="rpp-main-header"><div><span className="rpp-eyebrow">ROLEPLAY PRODUCT</span>
        <h2>{sectionTitle(state.section)}</h2><p>{sectionDescription(state.section)}</p></div>
        {close === undefined ? null : <button type="button" className="rpp-close" aria-label="关闭" onClick={close}>×</button>}
      </header>
      <div className="rpp-content">
        {state.error === '' ? null : <div className="rpp-banner rpp-banner-error" role="alert">{state.error}</div>}
        {state.notice === '' ? null : <div className="rpp-banner rpp-banner-success">{state.notice}</div>}
        {state.loading && response === undefined ? <LoadingState /> : null}
        {response === undefined ? null : state.section === 'compose'
          ? <CompositionEditor response={response} />
          : state.section === 'presets'
            ? <PresetManager response={response} />
            : state.section === 'import'
              ? <ImportHub response={response} />
              : <EntityManager kind={state.section} response={response} />}
      </div>
    </main>
  </div>
}

interface CompositionDraft {
  readonly mode: 'tavern' | 'agent'
  readonly experienceId: string
  readonly presetId: string
  readonly systemId: string
  readonly characterIds: readonly string[]
  readonly primaryCharacterId: string
  readonly personaId: string
  readonly worldId: string
  readonly scene: string
}

function CompositionEditor({ response }: { readonly response: ProductResponse }): ReactNode {
  const initial = useMemo(() => compositionDraft(response), [response.state.revision, response.sessionId])
  const [draft, setDraft] = useState(initial)
  useEffect(() => setDraft(initial), [initial])
  const layers = previewLayers(response, draft)
  const primary = response.state.characters.find(character => character.id === draft.primaryCharacterId)
  const hasOpening = primary !== undefined && [primary.openingMessage, ...primary.alternateGreetings].some(value => value.trim() !== '')
  return <div className="rpp-compose-grid">
    <section className="rpp-compose-controls">
      <div className="rpp-section-heading"><span><b>当前会话配方</b><small>{response.sessionId === '' ? '请先选择一个会话' : `Session · ${shortId(response.sessionId)}`}</small></span>
        <span className="rpp-revision">rev {response.state.revision}</span></div>
      <Field label="运行模式" note="传统酒馆单次生成，或带领域工具和自动维护的 Agent RP" accent="#e7a84f">
        <Select value={draft.mode} onChange={mode => setDraft({ ...draft, mode: mode as CompositionDraft['mode'] })}
          items={[{ id: 'tavern', name: 'Tavern Chat · 传统酒馆' }, { id: 'agent', name: 'Agent RP · 自动维护' }]} empty="选择运行模式" />
      </Field>
      {draft.mode === 'agent' ? <Field label="Agent Experience" note="决定自动维护和多 Agent 深度；不替换 Prompt Preset" accent="#e7a84f">
        <Select value={draft.experienceId} onChange={experienceId => setDraft({ ...draft, experienceId })} items={[
          { id: 'rp-adaptive', name: 'Adaptive · 状态/记忆/场景/关系' },
          { id: 'rp-world-sim', name: 'World Simulation · 世界模拟' },
          { id: 'rp-multi-character', name: 'Multi-character · 多角色调度' },
          { id: 'rp-trpg', name: 'TRPG · 世界与规则' },
          { id: 'rp-companion', name: 'Companion · 关系与长期记忆' },
        ]} empty="选择 Experience" />
      </Field> : null}
      <Field label="酒馆预设" note="Prompt 定义、顺序、Marker 与生成参数" accent="#c084fc">
        <Select value={draft.presetId} onChange={presetId => setDraft({ ...draft, presetId })}
          items={response.state.presets.map(preset => ({ id: preset.id, name: `${preset.mode === 'sillytavern' ? '[ST 兼容]' : '[Harness]'} ${preset.name}` }))} empty="选择预设" />
      </Field>
      <Field label="系统规则" note="叙事职责、语调与不可越过的边界" accent="#8b7cf6">
        <Select value={draft.systemId} onChange={systemId => setDraft({ ...draft, systemId })} items={response.state.systems} empty="选择系统规则" />
      </Field>
      <Field label="世界观" note="环境、历史与客观规律" accent="#42b883">
        <Select value={draft.worldId} onChange={worldId => setDraft({ ...draft, worldId })} items={response.state.worlds} empty="不使用世界观" allowEmpty />
      </Field>
      <Field label="角色阵容" note="勾选参与者，并指定回复署名的主要角色" accent="#f47f6b">
        <div className="rpp-choice-grid">{response.state.characters.map(character => {
          const selected = draft.characterIds.includes(character.id)
          const primary = draft.primaryCharacterId === character.id
          return <div key={character.id} className={`rpp-choice-card ${selected ? 'rpp-choice-selected' : ''}`}
            style={{ '--rpp-accent': character.accent } as CSSProperties}>
            <button type="button" className="rpp-choice-main" onClick={() => {
              const ids = selected ? draft.characterIds.filter(id => id !== character.id) : [...draft.characterIds, character.id]
              setDraft({ ...draft, characterIds: ids, primaryCharacterId: primary ? ids[0] ?? '' : draft.primaryCharacterId || ids[0] || '' })
            }}><AvatarFace character={character} className="rpp-avatar" fallback={character.name.slice(0, 1)} /><span><b>{character.name}</b><small>{character.summary}</small></span><i>{selected ? '✓' : '+'}</i></button>
            {selected ? <button type="button" className={`rpp-primary ${primary ? 'rpp-primary-active' : ''}`}
              onClick={() => setDraft({ ...draft, primaryCharacterId: character.id })}>{primary ? '★ 主要角色 · 回复署名' : '设为主要角色'}</button> : null}
          </div>
        })}</div>
      </Field>
      <Field label="用户人设" note="对话中的“我”是谁，与角色设定互不覆盖" accent="#36b8d4">
        <Select value={draft.personaId} onChange={personaId => setDraft({ ...draft, personaId })} items={response.state.personas} empty="不使用用户人设" allowEmpty />
      </Field>
      <Field label="当前场景" note="只描述此刻地点、时间与已发生事实" accent="#e7a84f">
        <textarea rows={3} value={draft.scene} placeholder="例如：旧灯塔顶层，暴雨刚停，发光海雾正沿楼梯上涌。"
          onChange={event => setDraft({ ...draft, scene: event.target.value })} />
      </Field>
      <div className="rpp-compose-actions"><span>应用后由 DSH 原生 AgentLoop 继续对话</span><div className="rpp-compose-buttons">
        {hasOpening && response.binding?.primaryCharacterId === draft.primaryCharacterId
          ? <button type="button" className="rpp-secondary-action" disabled={snapshot.saving}
              onClick={() => { void addOpening(response.sessionId, 0) }}>＋ 加入{primary?.name ?? '角色'}的开场白</button>
          : null}
        <button type="button" className="rpp-primary-action" disabled={response.sessionId === '' || draft.presetId === '' || draft.systemId === ''}
          onClick={() => { void applyComposition(response, draft) }}>{snapshot.saving ? '正在应用…' : '应用到当前会话'}</button></div></div>
    </section>
    <aside className="rpp-preview">
      <div className="rpp-preview-heading"><span>Prompt Manager 预览</span><small>实际启用顺序</small></div>
      <div className="rpp-layer-stack">{layers.map((layer, index) => <article key={`${layer.id}:${index}`}
        className={`rpp-layer-card ${layer.empty ? 'rpp-layer-empty' : ''}`} style={{ '--rpp-accent': layer.accent } as CSSProperties}>
        <div className="rpp-layer-index">{String(index + 1).padStart(2, '0')}</div><div>
          <span className="rpp-layer-kind">{layer.marker ? 'MARKER' : layer.role.toUpperCase()} · {layer.kind}</span>
          <h3>{layer.title}<small>{layer.subtitle}</small></h3><p>{layer.kind === 'history' ? '由 DSH 原生 Session 历史承载' : layer.empty ? '本项当前没有可注入内容' : truncate(layer.content, 210)}</p>
        </div>
      </article>)}</div>
      <div className="rpp-preview-note"><b>语义隔离仍然保留</b><span>预设只决定这些内容的启停与顺序；系统规则、角色、用户人设、世界书和场景仍是不同的数据对象。</span></div>
    </aside>
  </div>
}

function PresetManager({ response }: { readonly response: ProductResponse }): ReactNode {
  const [selectedId, setSelectedId] = useState(response.state.presets[0]?.id ?? '')
  const selected = response.state.presets.find(preset => preset.id === selectedId) ?? response.state.presets[0]
  const [draft, setDraft] = useState<PresetDraft>(() => presetDraft(selected))
  const [activePromptId, setActivePromptId] = useState('')
  const [promptQuery, setPromptQuery] = useState('')
  const [enabledOnly, setEnabledOnly] = useState(false)
  useEffect(() => {
    const current = response.state.presets.find(preset => preset.id === selectedId) ?? response.state.presets[0]
    if (current !== undefined) { setSelectedId(current.id); setDraft(presetDraft(current)); setActivePromptId(current.promptOrders[0]?.entries[0]?.identifier ?? '') }
  }, [response.state.revision])
  if (selected === undefined) return <p className="rpp-empty">暂无预设</p>
  const order = draft.promptOrders.find(item => item.id === draft.selectedPromptOrderId) ?? draft.promptOrders[0]
  const active = draft.promptDefinitions.find(item => item.id === activePromptId) ?? draft.promptDefinitions[0]
  const normalizedQuery = promptQuery.trim().toLocaleLowerCase()
  const visibleEntries = (order?.entries ?? []).flatMap((entry, index) => {
    const definition = draft.promptDefinitions.find(item => item.id === entry.identifier)
    if (definition === undefined || enabledOnly && !entry.enabled) return []
    if (normalizedQuery !== '' && !`${definition.name}\n${definition.id}`.toLocaleLowerCase().includes(normalizedQuery)) return []
    return [{ entry, index, definition }]
  })
  const orderedIds = new Set(order?.entries.map(entry => entry.identifier) ?? [])
  const unassigned = draft.promptDefinitions.filter(definition => !enabledOnly && !orderedIds.has(definition.id)
    && (normalizedQuery === '' || `${definition.name}\n${definition.id}`.toLocaleLowerCase().includes(normalizedQuery)))
  const enabledCount = order?.entries.filter(entry => entry.enabled).length ?? 0
  return <div className="rpp-preset-layout">
    <aside className="rpp-entity-list"><div className="rpp-list-heading"><span>Prompt Presets</span></div><div className="rpp-list-scroll">
      {response.state.presets.map(preset => <button type="button" key={preset.id} className={preset.id === selected.id ? 'rpp-entity-active' : ''}
        onClick={() => { setSelectedId(preset.id); setDraft(presetDraft(preset)); setActivePromptId(preset.promptOrders[0]?.entries[0]?.identifier ?? '') }}>
        <span className="rpp-entity-avatar" style={{ '--rpp-accent': '#c084fc' } as CSSProperties}>≡</span><span><b>{preset.name}</b><small>{preset.mode === 'sillytavern' ? 'ST COMPAT' : 'HARNESS'} · {preset.promptDefinitions.length} prompts</small></span>
      </button>)}</div></aside>
    <section className="rpp-preset-main">
      <header className="rpp-preset-header"><div><span className="rpp-eyebrow">PROMPT MANAGER</span><input value={draft.name} aria-label="预设名称" onChange={event => setDraft({ ...draft, name: event.target.value })} /></div>
        <div className="rpp-generation"><label>Temperature<input type="number" min="0" max="2" step="0.1" value={draft.temperature}
          onChange={event => setDraft({ ...draft, temperature: event.target.value })} /></label><label>Max tokens<input type="number" min="1" step="1" value={draft.maxTokens}
            onChange={event => setDraft({ ...draft, maxTokens: event.target.value })} /></label><label>Reasoning<input value={draft.reasoningEffort}
              placeholder="可选" onChange={event => setDraft({ ...draft, reasoningEffort: event.target.value })} /></label></div></header>
      <div className="rpp-prompt-workbench">
        <div className="rpp-prompt-order"><div className="rpp-subheading"><span>Prompt 顺序 · {enabledCount}/{order?.entries.length ?? 0} 启用</span>
          <select value={draft.selectedPromptOrderId} onChange={event => setDraft({ ...draft, selectedPromptOrderId: event.target.value })}>
            {draft.promptOrders.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></div>
          <div className="rpp-prompt-filters"><input aria-label="搜索 Prompt" placeholder="搜索名称或 identifier" value={promptQuery}
            onChange={event => setPromptQuery(event.target.value)} /><label><input type="checkbox" checked={enabledOnly}
              onChange={event => setEnabledOnly(event.target.checked)} />仅看已启用</label></div>
          <div className="rpp-order-list">{visibleEntries.map(({ entry, index, definition }) => {
            return <button type="button" key={entry.identifier} className={active?.id === definition.id ? 'rpp-order-active' : ''}
              onClick={() => setActivePromptId(definition.id)}>
              <input type="checkbox" checked={entry.enabled} aria-label={`启用 ${definition.name}`} onClick={event => event.stopPropagation()}
                onChange={() => setDraft(updateOrderEntry(draft, order?.id ?? '', index, { ...entry, enabled: !entry.enabled }))} />
              <span className={`rpp-role rpp-role-${definition.role}`}>{definition.marker ? 'MARKER' : definition.role}</span>
              <span><b>{definition.name}</b><small>{definition.id}</small></span>
              <span className="rpp-order-arrows"><i onClick={event => { event.stopPropagation(); setDraft(moveOrderEntry(draft, order?.id ?? '', index, -1)) }}>↑</i>
                <i onClick={event => { event.stopPropagation(); setDraft(moveOrderEntry(draft, order?.id ?? '', index, 1)) }}>↓</i></span>
            </button>
          })}
          {unassigned.length === 0 ? null : <details className="rpp-unassigned"><summary>未编排 Prompt · {unassigned.length}</summary>
            {unassigned.map(definition => <button type="button" key={definition.id} onClick={() => {
              if (order === undefined) return
              setDraft(addOrderEntry(draft, order.id, definition.id))
              setActivePromptId(definition.id)
            }}><span>＋</span><span><b>{definition.name}</b><small>{definition.id}</small></span></button>)}</details>}
          </div>
        </div>
        <div className="rpp-prompt-editor">{active === undefined ? <p className="rpp-empty">选择一个 Prompt</p> : <>
          <div className="rpp-editor-row"><label>显示名称<input value={active.name} onChange={event => setDraft(updatePrompt(draft, active.id, { ...active, name: event.target.value }))} /></label>
            <label>Role<select value={active.role} onChange={event => setDraft(updatePrompt(draft, active.id, { ...active, role: event.target.value as PresetPromptDraft['role'] }))}>
              <option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option></select></label></div>
          <label className="rpp-marker-switch"><input type="checkbox" checked={active.marker}
            onChange={() => setDraft(updatePrompt(draft, active.id, { ...active, marker: !active.marker }))} /> Marker（由角色、Persona、世界书或聊天历史填充）</label>
          <div className="rpp-prompt-meta"><span>{active.systemPrompt ? 'System Prompt' : '普通 Prompt'}</span>
            <span>位置 {active.injectionPosition ?? 0}</span><span>深度 {active.injectionDepth ?? '—'}</span>
            <span>{active.forbidOverrides ? '禁止覆盖' : '允许覆盖'}</span></div>
          <textarea rows={15} value={active.content} disabled={active.marker} placeholder={active.marker ? 'Marker 内容由会话编排解析' : '支持 {{system}}、{{char}}、{{user}}、{{persona}}、{{world}}、{{scenario}}'}
            onChange={event => setDraft(updatePrompt(draft, active.id, { ...active, content: event.target.value }))} />
          {selected.source === undefined ? null : <div className="rpp-source-note"><b>{selected.source.format}</b><span>{selected.source.sourceId}</span><small>{selected.source.warnings.length} 条兼容提示</small></div>}
        </>}</div>
      </div>
      <footer className="rpp-preset-actions"><span>Prompt 的启停和顺序会直接改变下一次请求的系统上下文。</span>
        <button type="button" className="rpp-primary-action" onClick={() => { void savePreset(selected, draft, response) }}>保存预设</button></footer>
    </section>
  </div>
}

interface PresetPromptDraft {
  readonly id: string
  readonly name: string
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
  readonly marker: boolean
  readonly systemPrompt?: boolean
  readonly forbidOverrides?: boolean
  readonly injectionPosition?: number
  readonly injectionDepth?: number
  readonly injectionOrder?: number
  readonly injectionTrigger?: readonly string[]
}
interface PresetDraft {
  readonly name: string
  readonly promptDefinitions: readonly PresetPromptDraft[]
  readonly promptOrders: readonly { readonly id: string; readonly entries: readonly { readonly identifier: string; readonly enabled: boolean }[] }[]
  readonly selectedPromptOrderId: string
  readonly temperature: string
  readonly maxTokens: string
  readonly reasoningEffort: string
}

function ImportHub({ response }: { readonly response: ProductResponse }): ReactNode {
  const [files, setFiles] = useState<readonly File[]>([])
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const accept = (incoming: FileList | readonly File[]): void => {
    const next = Array.from(incoming).slice(0, MAX_IMPORT_FILES)
    const oversized = next.find(file => file.size > MAX_IMPORT_FILE_BYTES)
    if (oversized !== undefined) { update({ error: `${oversized.name} 超过 32 MiB` }); return }
    setFiles(next)
    update({ error: '', notice: '' })
  }
  return <div className="rpp-import-page">
    <section className={`rpp-dropzone ${dragging ? 'rpp-dropzone-active' : ''}`}
      onDragOver={(event: DragEvent) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)} onDrop={(event: DragEvent) => { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files) }}>
      <div className="rpp-import-glyph">⇩</div><h3>把酒馆资源拖到这里</h3>
      <p>一次最多 32 个文件。支持 Character Card V1/V2/V3 JSON、PNG、CHARX、World Info、Persona 和 Chat Completion Preset JSON。</p>
      <button type="button" className="rpp-secondary-action" onClick={() => input.current?.click()}>选择一批文件</button>
      <input ref={input} hidden multiple type="file" accept=".json,.png,.charx,application/json,image/png" onChange={(event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.files !== null) accept(event.target.files)
      }} />
    </section>
    {files.length === 0 ? null : <section className="rpp-import-queue"><div className="rpp-section-heading"><span><b>待导入 · {files.length}</b><small>导入器不会执行脚本、正则或远程资源</small></span>
      <button type="button" className="rpp-primary-action" disabled={snapshot.saving} onClick={() => { void importFiles(files, response) }}>{snapshot.saving ? '正在解析…' : '开始批量导入'}</button></div>
      <div className="rpp-file-grid">{files.map(file => <article key={`${file.name}:${file.lastModified}`}><span>{file.name.split('.').pop()?.toUpperCase()}</span><div><b>{file.name}</b><small>{formatBytes(file.size)}</small></div></article>)}</div>
    </section>}
    {response.importReports === undefined ? null : <section className="rpp-import-results"><div className="rpp-section-heading"><span><b>最近一次导入结果</b><small>单个坏文件不会回滚同批有效资源</small></span></div>
      {response.importReports.map(report => {
        const importedPreset = report.kind === 'preset' ? response.state.presets.find(preset => report.ids.includes(preset.id)) : undefined
        return <article key={report.fileName} className={report.kind === 'error' ? 'rpp-import-error' : ''}>
          <span>{report.kind === 'error' ? '×' : '✓'}</span><div><b>{report.fileName}</b><p>{report.kind === 'error' ? report.error ?? '导入失败' : `${kindLabel(report.kind)}：${report.names.join('、')}`}</p>
          {report.warnings.length === 0 ? null : <small>{report.warnings.length} 条内容被安全禁用或省略</small>}
          {importedPreset === undefined ? null : <div className="rpp-import-preset-actions"><span>已保留为可直接使用的 ST 兼容版。是否另外生成 Harness 适配副本？</span>
            <button type="button" onClick={() => chooseImportedPreset(importedPreset.id)}>选择 ST 兼容版</button>
            <button type="button" className="rpp-primary-action" onClick={() => { void adaptImportedPreset(importedPreset.id, response) }}>生成 Harness 副本</button></div>}
          </div></article>
      })}</section>}
  </div>
}

function EntityManager({ kind, response }: { readonly kind: EditableKind; readonly response: ProductResponse }): ReactNode {
  const entities = response.state[kind] as readonly Exclude<ProductEntity, PromptPreset>[]
  const [selectedId, setSelectedId] = useState(entities[0]?.id ?? '')
  const selected = entities.find(entity => entity.id === selectedId) ?? entities[0]
  const [draft, setDraft] = useState<Record<string, string>>(selected === undefined ? emptyDraft(kind) : entityDraft(selected))
  useEffect(() => {
    const current = entities.find(entity => entity.id === selectedId) ?? entities[0]
    if (current !== undefined) { setSelectedId(current.id); setDraft(entityDraft(current)) } else { setSelectedId(''); setDraft(emptyDraft(kind)) }
  }, [response.state.revision, kind])
  return <div className="rpp-manager">
    <aside className="rpp-entity-list"><div className="rpp-list-heading"><span>{entityLabel(kind)}</span>
      <button type="button" onClick={() => { setSelectedId(''); setDraft(emptyDraft(kind)) }}>＋ 新建</button></div>
      <div className="rpp-list-scroll">{entities.map(entity => <button type="button" key={entity.id}
        className={entity.id === selected?.id && selectedId !== '' ? 'rpp-entity-active' : ''}
        onClick={() => { setSelectedId(entity.id); setDraft(entityDraft(entity)) }}>
        {kind === 'characters'
          ? <AvatarFace character={entity as CharacterProfile} className="rpp-entity-avatar" fallback={entity.name.slice(0, 1)} />
          : <span className="rpp-entity-avatar" style={{ '--rpp-accent': entityAccent(entity, kind) } as CSSProperties}>{entity.name.slice(0, 1)}</span>}
        <span><b>{entity.name}</b><small>{entitySummary(entity, kind)}</small></span>
      </button>)}</div></aside>
    <section className="rpp-editor"><div className="rpp-editor-hero">
      {kind === 'characters' && selected !== undefined
        ? <AvatarFace character={selected as CharacterProfile} className="rpp-editor-orb" fallback={(draft.name || entityLabel(kind)).slice(0, 1)} />
        : <span className="rpp-editor-orb" style={{ '--rpp-accent': draft.accent ?? kindAccent(kind) } as CSSProperties}>{(draft.name || entityLabel(kind)).slice(0, 1)}</span>}
      <span><span className="rpp-eyebrow">{selectedId === '' ? 'CREATE NEW' : `EDIT · ${selectedId}`}</span><h3>{draft.name || `新建${entityLabel(kind)}`}</h3>
        <p>{entityEditorHint(kind)}</p>{sourceOf(selected) === undefined ? null : <small className="rpp-import-badge">{sourceOf(selected)?.format} · {sourceOf(selected)?.sourceId}</small>}</span>
    </div><div className="rpp-editor-fields">{entityFields(kind).map(field => <label key={field.key} className={field.rows > 1 ? 'rpp-editor-field rpp-editor-field-wide' : 'rpp-editor-field'}>
      <span>{field.label}<small>{field.note}</small></span>{field.rows > 1
        ? <textarea rows={field.rows} value={draft[field.key] ?? ''} onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} />
        : field.key === 'accent' ? <input type="color" value={draft.accent ?? kindAccent(kind)} onChange={event => setDraft({ ...draft, accent: event.target.value })} />
          : <input value={draft[field.key] ?? ''} onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} />}</label>)}</div>
      {kind === 'worlds' ? <WorldEntriesEditor serialized={draft._entries ?? '[]'} onChange={entries => setDraft({ ...draft, _entries: JSON.stringify(entries) })} /> : null}
      <div className="rpp-editor-actions">{selectedId === '' ? <span /> : <button type="button" className="rpp-danger-action"
        onClick={() => { if (window.confirm(`删除“${draft.name}”？`)) void deleteEntity(kind, selectedId, response) }}>删除</button>}
        <button type="button" className="rpp-primary-action" disabled={(draft.name ?? '').trim() === ''}
          onClick={() => { void saveEntity(kind, selectedId, draft, selected, response) }}>保存{entityLabel(kind)}</button></div>
    </section>
  </div>
}

function WorldEntriesEditor({ serialized, onChange }: {
  readonly serialized: string
  readonly onChange: (entries: readonly WorldEntry[]) => void
}): ReactNode {
  const entries = useMemo(() => parseWorldEntries(serialized), [serialized])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(entries[0]?.id ?? '')
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0]
  useEffect(() => {
    if (selected === undefined && entries.length > 0) setSelectedId(entries[0]!.id)
  }, [entries.length, selected?.id])
  const visible = entries.filter(entry => `${entry.name}\n${entry.id}\n${entry.keys.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const updateEntry = (id: string, patch: Partial<WorldEntry>): void => onChange(entries.map(entry => entry.id === id ? { ...entry, ...patch } : entry))
  return <section className="rpp-worldbook">
    <header><span><b>世界书条目</b><small>{entries.filter(entry => entry.enabled).length}/{entries.length} 启用</small></span>
      <button type="button" onClick={() => {
        const id = `entry-${crypto.randomUUID()}`
        onChange([...entries, { id, name: '新条目', content: '待填写', keys: [], secondaryKeys: [], enabled: true, constant: false, priority: 0 }])
        setSelectedId(id)
      }}>＋ 新建条目</button></header>
    <div className="rpp-worldbook-grid"><aside><input aria-label="搜索世界书条目" placeholder="搜索名称、ID、关键词" value={query} onChange={event => setQuery(event.target.value)} />
      <div>{visible.map(entry => <div key={entry.id} className={entry.id === selected?.id ? 'rpp-world-entry-active' : ''}>
        <input type="checkbox" aria-label={`启用世界书条目 ${entry.name || entry.id}`} checked={entry.enabled}
          onChange={() => updateEntry(entry.id, { enabled: !entry.enabled })} />
        <button type="button" onClick={() => setSelectedId(entry.id)}><b>{entry.name || entry.id}</b><small>{entry.keys.join('、') || '无关键词'} · P{entry.priority}</small></button>
      </div>)}</div></aside>
      <div className="rpp-world-entry-editor">{selected === undefined ? <p className="rpp-empty">暂无世界书条目</p> : <>
        <div className="rpp-editor-row"><label>名称<input value={selected.name} onChange={event => updateEntry(selected.id, { name: event.target.value })} /></label>
          <label>优先级<input type="number" value={selected.priority} onChange={event => updateEntry(selected.id, { priority: Number(event.target.value) })} /></label></div>
        <div className="rpp-editor-row"><label>主关键词<input value={selected.keys.join('，')} onChange={event => updateEntry(selected.id, { keys: splitKeywords(event.target.value) })} /></label>
          <label>次关键词<input value={selected.secondaryKeys.join('，')} onChange={event => updateEntry(selected.id, { secondaryKeys: splitKeywords(event.target.value) })} /></label></div>
        <label className="rpp-marker-switch"><input type="checkbox" checked={selected.constant} onChange={() => updateEntry(selected.id, { constant: !selected.constant })} /> 常驻条目</label>
        <textarea rows={8} value={selected.content} onChange={event => updateEntry(selected.id, { content: event.target.value })} />
        <div className="rpp-world-entry-actions"><small>{selected.id}</small><button type="button" className="rpp-danger-action" onClick={() => {
          onChange(entries.filter(entry => entry.id !== selected.id)); setSelectedId('')
        }}>删除条目</button></div>
      </>}</div>
    </div>
  </section>
}

function parseWorldEntries(value: string): WorldEntry[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new Error('世界书条目草稿必须是数组')
  return parsed as WorldEntry[]
}

function splitKeywords(value: string): string[] {
  return value.split(/[,，\n]/u).map(item => item.trim()).filter(item => item !== '')
}

function RpConversationSeat(props: Record<string, unknown>): ReactNode {
  const sessionId = sessionIdFromProps(props)
  const candidate = props.useSession
  if (typeof candidate !== 'function') return <div className="rpp-story-empty">当前 DSH 版本没有提供会话读取 Hook。</div>
  return <RpConversationView sessionId={sessionId} useSession={candidate as UseSession} />
}

interface ViewNode {
  readonly kind: string
  readonly seq: number
  readonly time?: number
  readonly content?: readonly unknown[]
  readonly blocks?: readonly unknown[]
}
interface ConversationSnapshot { readonly nodes: readonly ViewNode[]; readonly partial?: { readonly blocks: readonly unknown[] } | null; readonly running: boolean }
type UseSession = <T>(selector: (session: ConversationSnapshot) => T) => T

function RpConversationView({ sessionId, useSession }: { readonly sessionId: string; readonly useSession: UseSession }): ReactNode {
  const client = useProductState()
  useLoadSession(sessionId)
  const nodes = useSession(value => value.nodes)
  const partial = useSession(value => value.partial)
  const running = useSession(value => value.running)
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProduct(sessionId) }, 140)
    return () => window.clearTimeout(timer)
  }, [sessionId, nodes.length, running])
  const response = client.sessionId === sessionId ? client.response : undefined
  const binding = response?.binding
  const character = response?.state.characters.find(item => item.id === binding?.primaryCharacterId)
  const persona = response?.state.personas.find(item => item.id === binding?.personaId)
  const world = response?.state.worlds.find(item => item.id === binding?.worldId)
  const runtime = response?.runtime
  const messages = storyMessages(nodes, response?.transcript, character?.name ?? '角色', persona?.name ?? '你')
  const [editing, setEditing] = useState<number | undefined>()
  const [body, setBody] = useState('')
  const greetings = character === undefined ? [] : [character.openingMessage, ...character.alternateGreetings].filter(value => value.trim() !== '')
  return <section className="rpp-story" data-rp-story={sessionId}>
    <header className="rpp-story-header"><div className="rpp-story-identity">
      <AvatarFace character={character} className="rpp-story-avatar" fallback={character?.name.slice(0, 1) ?? '角'} />
      <div><span className="rpp-eyebrow">{binding?.mode === 'agent' ? 'AGENT RP SESSION' : 'TAVERN CHAT SESSION'}</span><h2>{character?.name ?? '尚未配置角色'}</h2><p>{world?.name ?? '未选择世界'} · 与 {persona?.name ?? '用户'} 对话{binding?.mode === 'agent' ? ` · ${binding.experienceId}` : ''}</p></div>
    </div><div className="rpp-story-actions">
      {greetings.length === 0 ? null : <button type="button" disabled={client.saving || running} onClick={() => { void addOpening(sessionId, 0) }}>＋ 角色开场白</button>}
      <button type="button" onClick={() => openProduct('compose', sessionId)}>设定</button>
    </div></header>
    {binding === undefined ? <div className="rpp-story-empty"><span>✦</span><h3>先为这个会话选择角色与预设</h3><p>角色对话页会保留每条消息生成时的说话者，并允许编辑正文。</p>
      <button type="button" className="rpp-primary-action" onClick={() => openProduct('compose', sessionId)}>打开 RP 创作室</button></div> : <>
      <div className="rpp-story-thread">{messages.length === 0 ? <div className="rpp-story-empty rpp-story-empty-compact"><span>☾</span><h3>故事还没有开始</h3>
        <p>{greetings.length === 0 ? '从下方输入第一句话。' : `可以先加入${character?.name ?? '角色'}的角色卡开场白。`}</p>
        {greetings.length === 0 ? null : <button type="button" className="rpp-secondary-action" onClick={() => { void addOpening(sessionId, 0) }}>加入开场白</button>}</div> : null}
        {messages.map(message => {
          const speakerCharacter = message.role === 'assistant' ? response?.state.characters.find(item => item.id === message.speakerId) : undefined
          return <article key={message.sourceSeq} className={`rpp-message rpp-message-${message.role}`}>
          <div className="rpp-message-head"><AvatarFace character={speakerCharacter} className="rpp-message-avatar" fallback={message.speakerName.slice(0, 1)} accent={message.role === 'assistant' ? speakerCharacter?.accent ?? '#f47f6b' : '#36b8d4'} />
            <span><b>{message.speakerName}</b><small>{message.role === 'assistant' ? '角色' : 'Persona'} · #{message.sourceSeq}{message.editRevision > 0 ? ` · 已编辑 v${message.editRevision}` : ''}</small></span>
            <button type="button" onClick={() => { setEditing(message.sourceSeq); setBody(message.content) }}>编辑正文</button></div>
          {editing === message.sourceSeq ? <div className="rpp-message-editor"><textarea rows={Math.max(4, Math.min(12, body.split('\n').length + 2))} value={body}
            onChange={event => setBody(event.target.value)} /><div><button type="button" onClick={() => setEditing(undefined)}>取消</button>
              <button type="button" className="rpp-primary-action" disabled={body.trim() === '' || client.saving}
                onClick={() => { void editMessage(sessionId, message, body).then(() => setEditing(undefined)) }}>保存并更新上下文</button></div></div>
            : <div className="rpp-message-body">{message.content}</div>}
        </article>})}
        {runtime === undefined ? null : <RuntimeProjection runtime={runtime} sessionId={sessionId} running={running} />}
        {partial === null || partial === undefined ? null : <article className="rpp-message rpp-message-assistant rpp-message-streaming">
          <div className="rpp-message-head"><AvatarFace character={character} className="rpp-message-avatar" fallback={character?.name.slice(0, 1) ?? '角'} />
            <span><b>{character?.name ?? '角色'}</b><small>正在回复</small></span></div><div className="rpp-message-body">{blocksText(partial.blocks)}<i className="rpp-caret" /></div></article>}
      </div>
      <footer className="rpp-story-foot"><span>正文编辑会追加可审计的 Surface replacement；原始日志不会被覆盖。</span><button type="button" onClick={() => openProduct('presets', sessionId)}>Prompt Manager</button></footer>
    </>}
  </section>
}

function RuntimeProjection({ runtime, sessionId, running }: {
  readonly runtime: SessionRuntimeState
  readonly sessionId: string
  readonly running: boolean
}): ReactNode {
  return <div className="rpp-runtime-projection">
    {runtime.effects.map(effect => <article key={effect.id} className={`rpp-effect-card rpp-effect-${effect.kind}`}>
      <span className="rpp-effect-icon">{effectIcon(effect.kind)}</span><div><span>{effect.kind.toUpperCase()}</span><h3>{effect.title}</h3><p>{effect.summary}</p>
        {Object.keys(effect.data).length === 0 ? null : <details><summary>结构化数据</summary><pre>{JSON.stringify(effect.data, null, 2)}</pre></details>}</div>
    </article>)}
    {runtime.choices.length === 0 ? null : <section className="rpp-choices"><h3>{runtime.choicesTitle}</h3><div>{runtime.choices.map(choice => <button type="button" key={choice.id}
      disabled={running || runtime.selectedChoiceId !== ''} className={runtime.selectedChoiceId === choice.id ? 'rpp-choice-picked' : ''}
      onClick={() => { void chooseRuntimeOption(sessionId, choice.id, choice.prompt) }}>{choice.label}</button>)}</div></section>}
  </div>
}

function effectIcon(kind: string): string {
  return kind === 'world' ? '界' : kind === 'time' ? '时' : kind === 'scene' ? '景' : kind === 'character' ? '角'
    : kind === 'persona' ? '我' : kind === 'relationship' ? '缘' : '忆'
}

interface StoryMessage {
  readonly sourceSeq: number
  readonly role: 'user' | 'assistant'
  readonly speakerId: string
  readonly speakerName: string
  readonly content: string
  readonly editRevision: number
}

function storyMessages(nodes: readonly ViewNode[], transcript: SessionTranscript | undefined, fallbackCharacter: string, fallbackPersona: string): readonly StoryMessage[] {
  const records = new Map(transcript?.messages.map(message => [message.sourceSeq, message]) ?? [])
  return nodes.flatMap((node): StoryMessage[] => {
    const record = records.get(node.seq)
    const ordinaryRole = node.kind === 'assistant' ? 'assistant' : node.kind === 'user' || node.kind === 'steering' ? 'user' : undefined
    const role = record?.role ?? ordinaryRole
    if (role === undefined || ordinaryRole === undefined && record?.synthetic !== true) return []
    const content = record?.editedContent ?? blocksText(node.kind === 'assistant' ? node.blocks ?? [] : node.content ?? [])
    if (content.trim() === '') return []
    return [{
      sourceSeq: node.seq,
      role,
      speakerId: record?.speakerId ?? '',
      speakerName: record?.speakerName ?? (role === 'assistant' ? fallbackCharacter : fallbackPersona),
      content,
      editRevision: record?.editRevision ?? 0,
    }]
  })
}

function blocksText(blocks: readonly unknown[]): string {
  return blocks.flatMap(block => {
    if (typeof block !== 'object' || block === null) return []
    const value = block as Record<string, unknown>
    if ((value.kind === 'text' || value.kind === 'reasoning' || value.type === 'text') && typeof value.text === 'string') return [value.text]
    return []
  }).join('\n')
}

function AvatarFace({ character, className, fallback, accent }: {
  readonly character: CharacterProfile | undefined
  readonly className: string
  readonly fallback: string
  readonly accent?: string | undefined
}): ReactNode {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [character?.avatar?.id])
  const avatar = character?.avatar
  return <span className={className} style={{ '--rpp-accent': accent ?? character?.accent ?? '#f47f6b' } as CSSProperties}>
    {avatar === undefined || failed
      ? fallback
      : <img src={`${API}/asset/${encodeURIComponent(avatar.id)}`} alt="" onError={() => setFailed(true)} />}
  </span>
}

function Field({ label, note, accent, children }: { readonly label: string; readonly note: string; readonly accent: string; readonly children: ReactNode }): ReactNode {
  return <label className="rpp-field" style={{ '--rpp-accent': accent } as CSSProperties}><span className="rpp-field-copy"><b>{label}</b><small>{note}</small></span>{children}</label>
}

function Select({ value, onChange, items, empty, allowEmpty = false }: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly items: readonly { readonly id: string; readonly name: string }[]
  readonly empty: string
  readonly allowEmpty?: boolean
}): ReactNode {
  return <select value={value} onChange={event => onChange(event.target.value)}>{allowEmpty || value === '' ? <option value="">{empty}</option> : null}
    {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
}

function LoadingState(): ReactNode { return <div className="rpp-loading"><span className="rpp-loading-orb" /><b>正在读取 RP 工作区</b><small>从本地 Harness 加载预设、角色卡、Persona 与世界书</small></div> }
function useProductState(): ProductClientState { return useSyncExternalStore(subscribe, () => snapshot, () => snapshot) }

function useAgentPreset(sessionId: string): string {
  const sessions = context?.sessions.list
  const applied = useSyncExternalStore(
    listener => sessions?.subscribe(listener) ?? (() => undefined),
    () => agentPresetForSession(sessionId),
    () => '',
  )
  const selected = useAgentPresetSeat().current
  return selected || applied
}

function useAgentPresetSeat(): AgentPresetSeatState {
  return useSyncExternalStore(subscribeAgentPreset, () => agentPresetSnapshot, () => agentPresetSnapshot)
}

function useLoadSession(sessionId: string): void {
  useEffect(() => {
    if (sessionId !== '' && (snapshot.sessionId !== sessionId || snapshot.response === undefined)) {
      update({ sessionId }); void loadProduct(sessionId)
    }
  }, [sessionId])
}

function subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }
function update(patch: Partial<ProductClientState>): void { snapshot = Object.freeze({ ...snapshot, ...patch }); for (const listener of listeners) listener() }
function subscribeAgentPreset(listener: () => void): () => void { agentPresetListeners.add(listener); return () => agentPresetListeners.delete(listener) }
function updateAgentPreset(patch: Partial<AgentPresetSeatState>): void {
  agentPresetSnapshot = Object.freeze({ ...agentPresetSnapshot, ...patch })
  for (const listener of agentPresetListeners) listener()
}

async function loadAgentPresetOptions(): Promise<void> {
  const ctx = context
  if (ctx === undefined) return
  try {
    const receipt = await ctx.connection.api.agentPresets.list({})
    if (!receipt.result.ok) throw new Error(receipt.result.error.message)
    const options = receipt.result.value.presets.filter(preset => preset.broken === undefined).map(preset => ({
      id: preset.id,
      name: preset.name?.trim() || preset.id,
      description: preset.description?.trim() || '',
      isDefault: preset.isDefault,
    }))
    fallbackAgentPreset = options.find(option => option.isDefault)?.id ?? options[0]?.id ?? ''
    const sessionPreset = agentPresetForSession(currentSessionId(ctx))
    const retained = stagedAgentPreset ?? (sessionPreset || fallbackAgentPreset)
    updateAgentPreset({ options, current: options.some(option => option.id === retained) ? retained : fallbackAgentPreset, error: '' })
  } catch (error: unknown) {
    updateAgentPreset({ error: publicError(error) })
  }
}

async function selectAgentPreset(id: string): Promise<void> {
  if (agentPresetSnapshot.busy || !agentPresetSnapshot.options.some(option => option.id === id)) return
  stagedAgentPreset = id
  updateAgentPreset({ current: id, error: '' })
  await applyStagedAgentPreset()
}

function applyStagedAgentPreset(): Promise<void> {
  if (applyingAgentPreset !== undefined) return applyingAgentPreset
  const ctx = context
  const sessionId = ctx === undefined ? '' : currentSessionId(ctx)
  const staged = stagedAgentPreset
  if (ctx === undefined || sessionId === '' || staged === undefined) return Promise.resolve()
  const row = ctx.sessions.list.getSnapshot().byId[sessionId]
  if (typeof row !== 'object' || row === null) return Promise.resolve()
  const summary = row as { readonly blank?: unknown; readonly agentPreset?: unknown }
  if (summary.blank !== true || summary.agentPreset === staged) {
    stagedAgentPreset = undefined
    return Promise.resolve()
  }
  updateAgentPreset({ busy: true, error: '' })
  applyingAgentPreset = (async () => {
    try {
      const receipt = await ctx.connection.api.agentPresets.select({ sessionId, agentPreset: staged })
      if (!receipt.result.ok) throw new Error(receipt.result.error.message)
      stagedAgentPreset = undefined
      ctx.sessions.noteAgentPreset(sessionId, receipt.result.value.agentPreset)
      updateAgentPreset({ current: receipt.result.value.agentPreset, busy: false, error: '' })
    } catch (error: unknown) {
      stagedAgentPreset = undefined
      updateAgentPreset({ current: fallbackAgentPreset, busy: false, error: publicError(error) })
    } finally {
      applyingAgentPreset = undefined
    }
  })()
  return applyingAgentPreset
}

async function ensureCurrentSession(): Promise<string> {
  const ctx = context
  if (ctx === undefined) throw new Error('DSH 客户端尚未加载')
  const current = currentSessionId(ctx)
  if (current !== '') return current
  ctx.workspaces.startSession()
  return await new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (sessionId: string): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      dispose()
      resolve(sessionId)
    }
    const dispose = ctx.sessions.list.subscribe(() => {
      const sessionId = currentSessionId(ctx)
      if (sessionId !== '') finish(sessionId)
    })
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      dispose()
      reject(new Error('未能建立空白 Session；请先选择一个工作区'))
    }, 10_000)
    const immediate = currentSessionId(ctx)
    if (immediate !== '') finish(immediate)
  })
}

async function loadProduct(sessionId = snapshot.sessionId): Promise<void> {
  update({ loading: true, error: '' })
  try { update({ loading: false, response: await request(`state${sessionId === '' ? '' : `?sessionId=${encodeURIComponent(sessionId)}`}`), sessionId, error: '' }) }
  catch (error: unknown) { update({ loading: false, error: publicError(error) }) }
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
  update({ saving: true, error: '', notice: '' })
  try {
    const sessionId = response.sessionId || await ensureCurrentSession()
    await applyStagedAgentPreset()
    const target = response.sessionId === sessionId ? response : await request(`state?sessionId=${encodeURIComponent(sessionId)}`)
    const receipt = await sendCommand(sessionId, 'rp-studio-bind', { sessionId, baseRevision: target.state.revision, ...draft })
    update({ saving: false, notice: receipt, preferredPresetId: '' })
    await loadProduct(sessionId)
  } catch (error: unknown) { update({ saving: false, error: publicError(error) }) }
}

async function addOpening(sessionId: string, greetingIndex: number): Promise<void> {
  update({ saving: true, error: '', notice: '' })
  try {
    const receipt = await sendCommand(sessionId, 'rp-studio-opening', { sessionId, greetingIndex })
    update({ saving: false, notice: receipt })
    await loadProduct(sessionId)
  } catch (error: unknown) { update({ saving: false, error: publicError(error) }) }
}

async function editMessage(sessionId: string, message: StoryMessage, content: string): Promise<void> {
  update({ saving: true, error: '', notice: '' })
  try {
    const receipt = await sendCommand(sessionId, 'rp-studio-edit', {
      sessionId, sourceSeq: message.sourceSeq, editRevision: message.editRevision, content,
    })
    update({ saving: false, notice: receipt })
    await loadProduct(sessionId)
  } catch (error: unknown) { update({ saving: false, error: publicError(error) }); throw error }
}

async function sendCommand(sessionId: string, name: string, payload: object): Promise<string> {
  const ctx = context
  if (ctx === undefined || sessionId === '') throw new Error('当前 DSH 会话不可用')
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) throw new Error('当前 DSH 会话尚未建立客户端绑定')
  const receipt = await binding.session.command(`/${name} ${base64Url(JSON.stringify(payload))}`)
  if (!receipt.ok || receipt.value?.matched !== true || receipt.value.result?.kind === 'error') {
    throw new Error(receipt.value?.result?.text ?? receipt.error?.message ?? `DSH 拒绝了 /${name}`)
  }
  return receipt.value.result?.text ?? '操作已完成'
}

async function chooseRuntimeOption(sessionId: string, choiceId: string, prompt: string): Promise<void> {
  const ctx = context
  const binding = ctx?.sessions.binding(sessionId)
  if (binding === undefined) { update({ error: '当前 DSH 会话不可用' }); return }
  update({ saving: true, error: '', notice: '' })
  try {
    const next = await request('choice/select', {
      method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ sessionId, choiceId }),
    })
    update({ response: next })
    const receipt = await binding.session.prompt([{ type: 'text', text: prompt }], 'queue')
    if (!receipt.ok) throw new Error(receipt.error?.message ?? '选项消息发送失败')
    update({ saving: false, notice: '选项已进入当前 Agent RP 会话。' })
  } catch (error: unknown) { update({ saving: false, error: publicError(error) }) }
}

async function importFiles(files: readonly File[], response: ProductResponse): Promise<void> {
  update({ saving: true, error: '', notice: '' })
  try {
    const encoded = await Promise.all(files.map(async file => ({ name: file.name, data: bytesBase64(new Uint8Array(await file.arrayBuffer())) })))
    const next = await request('import', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
      files: encoded, baseRevision: response.state.revision, sessionId: response.sessionId,
    }) })
    const succeeded = next.importReports?.filter(report => report.kind !== 'error').length ?? 0
    const failed = next.importReports?.filter(report => report.kind === 'error').length ?? 0
    update({ saving: false, response: next, notice: `导入完成：${String(succeeded)} 个成功${failed === 0 ? '' : `，${String(failed)} 个失败`}` })
  } catch (error: unknown) { update({ saving: false, error: publicError(error) }) }
}

function chooseImportedPreset(presetId: string): void {
  update({ section: 'compose', preferredPresetId: presetId, error: '', notice: '已选择导入的 ST 兼容 Preset；源文件保持不变。' })
}

async function adaptImportedPreset(presetId: string, response: ProductResponse): Promise<void> {
  update({ saving: true, error: '', notice: '' })
  try {
    const next = await request('preset/adapt', {
      method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
        presetId, baseRevision: response.state.revision, sessionId: response.sessionId,
      }),
    })
    if (next.adaptedPresetId === undefined) throw new Error('Harness 适配响应没有返回新 Preset 标识')
    update({
      saving: false,
      response: next,
      section: 'compose',
      preferredPresetId: next.adaptedPresetId,
      notice: '已保留 ST 源 Preset，并生成可独立选择的 Harness 适配副本。',
    })
  } catch (error: unknown) { update({ saving: false, error: publicError(error) }) }
}

async function saveEntity(kind: EditableKind, selectedId: string, draft: Record<string, string>, selected: Exclude<ProductEntity, PromptPreset> | undefined, response: ProductResponse): Promise<void> {
  update({ saving: true, error: '', notice: '' })
  try {
    const id = selectedId || slug(draft.name || entityLabel(kind))
    const next = await request('entity', { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({
      kind, baseRevision: response.state.revision, sessionId: response.sessionId,
      entity: entityPayload(kind, id, draft, selected),
    }) })
    update({ saving: false, response: next, notice: `已保存${entityLabel(kind)}“${draft.name}”` })
  } catch (error: unknown) { update({ saving: false, error: publicError(error) }) }
}

async function savePreset(selected: PromptPreset, draft: PresetDraft, response: ProductResponse): Promise<void> {
  update({ saving: true, error: '', notice: '' })
  try {
    const generation = {
      ...(draft.temperature === '' ? {} : { temperature: Number(draft.temperature) }),
      ...(draft.maxTokens === '' ? {} : { maxTokens: Number(draft.maxTokens) }),
      ...(draft.reasoningEffort.trim() === '' ? {} : { reasoningEffort: draft.reasoningEffort.trim() }),
      retained: selected.generation.retained,
    }
    const next = await request('entity', { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({
      kind: 'presets', baseRevision: response.state.revision, sessionId: response.sessionId,
      entity: { ...selected, ...draft, generation, updatedAt: Date.now() },
    }) })
    update({ saving: false, response: next, notice: `已保存预设“${draft.name}”` })
  } catch (error: unknown) { update({ saving: false, error: publicError(error) }) }
}

async function deleteEntity(kind: EditableKind, id: string, response: ProductResponse): Promise<void> {
  update({ saving: true, error: '', notice: '' })
  try {
    const next = await request('entity', { method: 'DELETE', headers: jsonHeaders(), body: JSON.stringify({ kind, id, baseRevision: response.state.revision, sessionId: response.sessionId }) })
    update({ saving: false, response: next, notice: `已删除${entityLabel(kind)}` })
  } catch (error: unknown) { update({ saving: false, error: publicError(error) }) }
}

function compositionDraft(response: ProductResponse): CompositionDraft {
  const preferred = snapshot.preferredPresetId !== '' && response.state.presets.some(preset => preset.id === snapshot.preferredPresetId)
    ? snapshot.preferredPresetId
    : undefined
  return Object.freeze({
    mode: response.binding?.mode ?? (agentPresetSnapshot.current === 'rp-agent' ? 'agent' : 'tavern'),
    experienceId: response.binding?.experienceId ?? 'rp-adaptive',
    presetId: preferred ?? response.binding?.presetId ?? response.state.presets[0]?.id ?? '',
    systemId: response.binding?.systemId ?? response.state.systems[0]?.id ?? '',
    characterIds: response.binding?.characterIds ?? [], primaryCharacterId: response.binding?.primaryCharacterId ?? '',
    personaId: response.binding?.personaId ?? '', worldId: response.binding?.worldId ?? '', scene: response.binding?.scene ?? '',
  })
}

function previewLayers(response: ProductResponse, draft: CompositionDraft): readonly PromptLayer[] {
  if (response.sessionId === '') return []
  const synthetic: ProductState = {
    ...response.state,
    bindings: { ...response.state.bindings, [response.sessionId]: { sessionId: response.sessionId, ...draft, updatedAt: 0 } },
  }
  return resolvePromptLayers(synthetic, response.sessionId)
}

function presetDraft(preset: PromptPreset | undefined): PresetDraft {
  if (preset === undefined) return { name: '', promptDefinitions: [], promptOrders: [], selectedPromptOrderId: '', temperature: '', maxTokens: '', reasoningEffort: '' }
  return {
    name: preset.name,
    promptDefinitions: preset.promptDefinitions.map(item => ({ ...item })),
    promptOrders: preset.promptOrders.map(order => ({ ...order, entries: order.entries.map(entry => ({ ...entry })) })),
    selectedPromptOrderId: preset.selectedPromptOrderId,
    temperature: preset.generation.temperature === undefined ? '' : String(preset.generation.temperature),
    maxTokens: preset.generation.maxTokens === undefined ? '' : String(preset.generation.maxTokens),
    reasoningEffort: preset.generation.reasoningEffort ?? '',
  }
}

function updatePrompt(draft: PresetDraft, id: string, prompt: PresetPromptDraft): PresetDraft {
  return { ...draft, promptDefinitions: draft.promptDefinitions.map(item => item.id === id ? prompt : item) }
}

function updateOrderEntry(draft: PresetDraft, orderId: string, index: number, entry: { readonly identifier: string; readonly enabled: boolean }): PresetDraft {
  return { ...draft, promptOrders: draft.promptOrders.map(order => order.id !== orderId ? order : {
    ...order, entries: order.entries.map((item, itemIndex) => itemIndex === index ? entry : item),
  }) }
}

function moveOrderEntry(draft: PresetDraft, orderId: string, index: number, delta: number): PresetDraft {
  const target = index + delta
  const order = draft.promptOrders.find(item => item.id === orderId)
  if (order === undefined || target < 0 || target >= order.entries.length) return draft
  const entries = [...order.entries]
  const current = entries[index]
  const other = entries[target]
  if (current === undefined || other === undefined) return draft
  entries[index] = other
  entries[target] = current
  return { ...draft, promptOrders: draft.promptOrders.map(item => item.id === orderId ? { ...item, entries } : item) }
}

function addOrderEntry(draft: PresetDraft, orderId: string, identifier: string): PresetDraft {
  return { ...draft, promptOrders: draft.promptOrders.map(order => {
    if (order.id !== orderId || order.entries.some(entry => entry.identifier === identifier)
      || order.entries.length >= PRODUCT_PROMPT_SEAT_COUNT) return order
    return { ...order, entries: [...order.entries, { identifier, enabled: false }] }
  }) }
}

function entityPayload(kind: EditableKind, id: string, draft: Record<string, string>, selected: Exclude<ProductEntity, PromptPreset> | undefined): object {
  const source = sourceOf(selected)
  const avatar = selected !== undefined && 'avatar' in selected ? selected.avatar : undefined
  const { _entries, ...fields } = draft
  const common = {
    ...fields, id, updatedAt: Date.now(),
    ...source === undefined ? {} : { source },
    ...avatar === undefined ? {} : { avatar },
  }
  return kind === 'characters' ? {
    ...common,
    alternateGreetings: lines(draft.alternateGreetings ?? ''),
    examples: blocks(draft.examples ?? ''),
    tags: draft.tags?.split(/[,，\n]/u).map(value => value.trim()).filter(Boolean) ?? [],
  } : kind === 'worlds' ? { ...common, entries: parseWorldEntries(_entries ?? '[]') } : common
}

function entityDraft(entity: Exclude<ProductEntity, PromptPreset>): Record<string, string> {
  if ('directive' in entity) return { name: entity.name, directive: entity.directive, tone: entity.tone, boundaries: entity.boundaries }
  if ('summary' in entity) return {
    name: entity.name, summary: entity.summary, personality: entity.personality, speechStyle: entity.speechStyle,
    appearance: entity.appearance, goals: entity.goals, scenario: entity.scenario, openingMessage: entity.openingMessage,
    alternateGreetings: entity.alternateGreetings.join('\n'), examples: entity.examples.join('\n\n---\n\n'), tags: entity.tags.join('，'), accent: entity.accent,
  }
  if ('traits' in entity) return { name: entity.name, description: entity.description, traits: entity.traits, relationship: entity.relationship, addressAs: entity.addressAs }
  return {
    name: entity.name, overview: entity.overview, rules: entity.rules, locations: entity.locations,
    lore: entity.lore, accent: entity.accent, _entries: JSON.stringify(entity.entries),
  }
}

function emptyDraft(kind: EditableKind): Record<string, string> {
  if (kind === 'systems') return { name: '', directive: '', tone: '', boundaries: '' }
  if (kind === 'characters') return { name: '', summary: '', personality: '', speechStyle: '', appearance: '', goals: '', scenario: '', openingMessage: '', alternateGreetings: '', examples: '', tags: '', accent: '#f47f6b' }
  if (kind === 'personas') return { name: '', description: '', traits: '', relationship: '', addressAs: '' }
  return { name: '', overview: '', rules: '', locations: '', lore: '', accent: '#42b883', _entries: '[]' }
}

function entityFields(kind: EditableKind): readonly { readonly key: string; readonly label: string; readonly note: string; readonly rows: number }[] {
  if (kind === 'systems') return [
    { key: 'name', label: '名称', note: '工作区显示名', rows: 1 }, { key: 'directive', label: '核心指令', note: '模型的叙事职责', rows: 5 },
    { key: 'tone', label: '叙事语调', note: '风格与节奏', rows: 3 }, { key: 'boundaries', label: '边界', note: '角色与用户不可混淆', rows: 4 },
  ]
  if (kind === 'characters') return [
    { key: 'name', label: '角色名', note: '用于回复署名', rows: 1 }, { key: 'accent', label: '角色色', note: '对话视觉标识', rows: 1 },
    { key: 'summary', label: '角色描述', note: '身份与核心背景', rows: 4 }, { key: 'personality', label: '性格', note: '稳定行为倾向', rows: 4 },
    { key: 'speechStyle', label: '说话方式', note: '措辞、节奏与口癖', rows: 3 }, { key: 'appearance', label: '外观', note: '可观察特征', rows: 3 },
    { key: 'goals', label: '目标', note: '角色主动性来源', rows: 3 }, { key: 'scenario', label: '角色场景', note: '角色卡自带 scenario', rows: 4 },
    { key: 'openingMessage', label: '首条开场白', note: 'Character Card first_mes', rows: 5 },
    { key: 'alternateGreetings', label: '备选开场白', note: '每行一条', rows: 5 }, { key: 'examples', label: '对话示例', note: '使用 --- 分隔多段', rows: 6 },
    { key: 'tags', label: '标签', note: '逗号分隔', rows: 1 },
  ]
  if (kind === 'personas') return [
    { key: 'name', label: 'Persona 名称', note: '对话页显示名', rows: 1 }, { key: 'addressAs', label: '角色如何称呼你', note: '称谓', rows: 1 },
    { key: 'description', label: '身份描述', note: '用户是谁', rows: 5 }, { key: 'traits', label: '特征', note: '用户稳定特征', rows: 3 },
    { key: 'relationship', label: '关系背景', note: '与角色的既有关系', rows: 4 },
  ]
  return [
    { key: 'name', label: '世界名称', note: '世界书显示名', rows: 1 }, { key: 'accent', label: '世界色', note: '上下文视觉标识', rows: 1 },
    { key: 'overview', label: '概览', note: '世界是什么', rows: 4 }, { key: 'rules', label: '世界规则', note: '客观规律与限制', rows: 5 },
    { key: 'locations', label: '重要地点', note: '可反复出现的空间', rows: 4 }, { key: 'lore', label: '世界书正文', note: '历史、组织与知识条目', rows: 10 },
  ]
}

function entityAccent(entity: Exclude<ProductEntity, PromptPreset>, kind: EditableKind): string { return 'accent' in entity ? entity.accent : kindAccent(kind) }
function sourceOf(entity: Exclude<ProductEntity, PromptPreset> | undefined): CharacterProfile['source'] | undefined {
  return entity !== undefined && 'source' in entity ? entity.source : undefined
}
function entitySummary(entity: Exclude<ProductEntity, PromptPreset>, kind: EditableKind): string {
  return kind === 'systems' ? (entity as SystemProfile).directive : kind === 'characters' ? (entity as CharacterProfile).summary
    : kind === 'personas' ? (entity as PersonaProfile).description : (entity as WorldProfile).overview
}
function kindAccent(kind: EditableKind): string { return kind === 'systems' ? '#8b7cf6' : kind === 'characters' ? '#f47f6b' : kind === 'personas' ? '#36b8d4' : '#42b883' }
function entityLabel(kind: EditableKind): string { return kind === 'systems' ? '系统规则' : kind === 'characters' ? '角色卡' : kind === 'personas' ? '用户人设' : '世界书' }
function entityEditorHint(kind: EditableKind): string { return kind === 'systems' ? '定义叙事职责和不可越过的边界。' : kind === 'characters' ? '定义模型要扮演的人物、开场白与示例对话。' : kind === 'personas' ? '定义故事中的用户身份，与角色设定分开维护。' : '维护环境、历史和客观规律，不替角色决定行动。' }

function sectionTitle(section: ProductSection): string {
  return section === 'compose' ? '会话编排' : section === 'presets' ? '酒馆预设' : section === 'import' ? '批量导入' : entityLabel(section)
}
function sectionDescription(section: ProductSection): string {
  return section === 'compose' ? '选择酒馆预设，再组合系统、世界、角色、Persona 与场景。'
    : section === 'presets' ? '编辑 Prompt 定义、Marker、启停顺序和生成参数。'
      : section === 'import' ? '批量接收 SillyTavern 角色卡、世界书、Persona 与预设；所有扩展行为保持惰性。' : entityEditorHint(section)
}

function currentSessionId(ctx: ClientContext): string { return ctx.sessions.list.getSnapshot().current ?? '' }
function agentPresetForSession(sessionId: string): string {
  const row = context?.sessions.list.getSnapshot().byId[sessionId]
  if (typeof row !== 'object' || row === null || !('agentPreset' in row)) return ''
  const value = (row as { readonly agentPreset?: unknown }).agentPreset
  return typeof value === 'string' ? value : ''
}
function sessionIdFromProps(props: Record<string, unknown>): string {
  if (typeof props.sessionId === 'string') return props.sessionId
  if (typeof props.session === 'object' && props.session !== null && 'id' in props.session && typeof (props.session as { id?: unknown }).id === 'string') return (props.session as { id: string }).id
  return context === undefined ? '' : currentSessionId(context)
}
function openProduct(section: ProductSection, sessionId = context === undefined ? '' : currentSessionId(context)): void { update({ open: true, embedded: false, section, sessionId, error: '', notice: '' }); void loadProduct(sessionId) }
function closeProduct(): void { update({ open: false }) }
function jsonHeaders(): HeadersInit { return { 'content-type': 'application/json' } }

function base64Url(value: string): string { return bytesBase64(new TextEncoder().encode(value)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '') }
function bytesBase64(bytes: Uint8Array): string {
  let result = ''
  const stride = 0x8000
  for (let index = 0; index < bytes.length; index += stride) result += String.fromCharCode(...bytes.subarray(index, index + stride))
  return btoa(result)
}
function slug(value: string): string {
  const normalized = value.normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return (normalized || `item-${crypto.randomUUID()}`).slice(0, 96)
}
function lines(value: string): string[] { return value.split('\n').map(item => item.trim()).filter(item => item !== '') }
function blocks(value: string): string[] { return value.split(/\n\s*---\s*\n/gu).map(item => item.trim()).filter(item => item !== '') }
function publicError(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function shortId(value: string): string { return value.length <= 14 ? value : `${value.slice(0, 7)}…${value.slice(-5)}` }
function truncate(value: string, max: number): string { return value.length <= max ? value : `${value.slice(0, max - 1)}…` }
function formatBytes(value: number): string { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB` }
function kindLabel(kind: Exclude<ImportReport['kind'], 'error'>): string { return kind === 'character' ? '角色卡' : kind === 'persona' ? 'Persona' : kind === 'world' ? '世界书' : '预设' }
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style'); style.id = STYLE_ID; style.textContent = PRODUCT_CSS; document.head.appendChild(style)
}
function removeStyles(): void { document.getElementById(STYLE_ID)?.remove() }

const PRODUCT_CSS = String.raw`
:root{--rpp-bg:#0b0e15;--rpp-panel:#141925;--rpp-panel2:#1b2130;--rpp-line:rgba(255,255,255,.095);--rpp-muted:#8f98aa;--rpp-text:#edf0f7;--rpp-purple:#8b7cf6}
.rpp-avatar,.rpp-entity-avatar,.rpp-editor-orb,.rpp-story-avatar,.rpp-message-avatar{overflow:hidden}.rpp-avatar img,.rpp-entity-avatar img,.rpp-editor-orb img,.rpp-story-avatar img,.rpp-message-avatar img{display:block;width:100%;height:100%;object-fit:cover}
.rpp-overlay{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;padding:26px;background:rgba(4,6,11,.74);backdrop-filter:blur(18px);pointer-events:auto;animation:rpp-fade .18s ease-out}.rpp-modal{width:min(1240px,calc(100vw - 42px));height:min(830px,calc(100vh - 48px));overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:var(--rpp-bg);box-shadow:0 34px 110px rgba(0,0,0,.6),0 0 0 1px rgba(139,124,246,.08)}
.rpp-shell{display:grid;grid-template-columns:236px minmax(0,1fr);width:100%;height:100%;min-height:0;color:var(--rpp-text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:radial-gradient(circle at 85% -10%,rgba(139,124,246,.13),transparent 31%),var(--rpp-bg)}.rpp-shell-embedded{min-height:700px;height:calc(100vh - 150px);max-height:830px;border:1px solid var(--rpp-line);border-radius:18px;overflow:hidden}
.rpp-nav{display:flex;flex-direction:column;min-width:0;padding:20px 13px 13px;border-right:1px solid var(--rpp-line);background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012))}.rpp-brand{display:flex;align-items:center;gap:12px;padding:2px 9px 18px}.rpp-brand-mark,.rpp-mark{display:grid;place-items:center;color:white;background:linear-gradient(145deg,#8b7cf6,#5d52bf);box-shadow:0 8px 24px rgba(95,82,191,.3)}.rpp-brand-mark{width:40px;height:40px;border-radius:14px;font-family:serif;font-size:19px}.rpp-brand>span:last-child{display:flex;flex-direction:column}.rpp-brand strong{font-size:15px}.rpp-brand small{margin-top:2px;color:var(--rpp-muted);font-size:9px;letter-spacing:.08em}.rpp-nav nav{display:flex;flex-direction:column;gap:3px}.rpp-nav nav button{display:grid;grid-template-columns:31px minmax(0,1fr);align-items:center;gap:8px;width:100%;min-height:48px;padding:6px 9px;border:1px solid transparent;border-radius:12px;color:var(--rpp-muted);background:transparent;text-align:left;cursor:pointer}.rpp-nav nav button:hover{color:var(--rpp-text);background:rgba(255,255,255,.045)}.rpp-nav nav button.rpp-nav-active{color:var(--rpp-text);border-color:rgba(139,124,246,.25);background:linear-gradient(90deg,rgba(139,124,246,.17),rgba(139,124,246,.045));box-shadow:inset 3px 0 #8b7cf6}.rpp-nav-icon{display:grid;place-items:center;width:29px;height:29px;border-radius:9px;background:rgba(255,255,255,.055);font-size:13px}.rpp-nav nav button>span:last-child{display:flex;flex-direction:column;gap:1px;min-width:0}.rpp-nav nav b{font-size:12px}.rpp-nav nav small{overflow:hidden;font-size:8px;text-overflow:ellipsis;white-space:nowrap;opacity:.7}.rpp-nav-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding:10px 9px 3px;color:var(--rpp-muted);font-size:9px}.rpp-status-dot{width:7px;height:7px;border-radius:50%;background:#55d89a;box-shadow:0 0 10px rgba(85,216,154,.75)}
.rpp-main{display:flex;flex-direction:column;min-width:0;min-height:0}.rpp-main-header{display:flex;justify-content:space-between;gap:20px;padding:24px 28px 18px;border-bottom:1px solid var(--rpp-line);background:rgba(13,16,24,.5)}.rpp-main-header h2{margin:3px 0 4px;font-family:Georgia,'Noto Serif SC',serif;font-size:25px;font-weight:500}.rpp-main-header p{margin:0;color:var(--rpp-muted);font-size:11px}.rpp-eyebrow{color:#9c90ff;font-size:8px;font-weight:700;letter-spacing:.16em}.rpp-close{width:34px;height:34px;border:1px solid var(--rpp-line);border-radius:11px;color:var(--rpp-muted);background:rgba(255,255,255,.035);font-size:23px;cursor:pointer}.rpp-content{min-height:0;flex:1;overflow:auto;padding:22px 28px 28px}.rpp-banner{margin-bottom:14px;padding:10px 13px;border-radius:10px;font-size:11px}.rpp-banner-error{color:#ffc1c1;border:1px solid rgba(255,104,104,.25);background:rgba(255,84,84,.09)}.rpp-banner-success{color:#bdf4d7;border:1px solid rgba(85,216,154,.25);background:rgba(85,216,154,.09)}
.rpp-compose-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(310px,.92fr);gap:22px}.rpp-section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}.rpp-section-heading>span:first-child{display:flex;flex-direction:column;gap:3px}.rpp-section-heading b{font-size:13px}.rpp-section-heading small{color:var(--rpp-muted);font-size:9px}.rpp-revision{padding:4px 7px;border:1px solid var(--rpp-line);border-radius:6px;color:var(--rpp-muted);font-family:monospace;font-size:8px}.rpp-field{display:grid;grid-template-columns:142px minmax(0,1fr);align-items:start;gap:13px;margin-bottom:9px;padding:12px;border:1px solid var(--rpp-line);border-radius:13px;background:rgba(255,255,255,.026);box-shadow:inset 3px 0 var(--rpp-accent)}.rpp-field-copy{display:flex;flex-direction:column;gap:3px}.rpp-field-copy b{font-size:11px}.rpp-field-copy small{color:var(--rpp-muted);font-size:8px;line-height:1.45}.rpp-field select,.rpp-field textarea,.rpp-editor input,.rpp-editor textarea,.rpp-preset-main input,.rpp-preset-main select,.rpp-preset-main textarea{box-sizing:border-box;width:100%;border:1px solid var(--rpp-line);border-radius:9px;outline:none;color:var(--rpp-text);background:#10141e;font:inherit;font-size:10px}.rpp-field select,.rpp-editor input,.rpp-preset-main input,.rpp-preset-main select{height:34px;padding:0 9px}.rpp-field textarea,.rpp-editor textarea,.rpp-preset-main textarea{padding:9px;resize:vertical;line-height:1.55}.rpp-field :focus,.rpp-editor :focus,.rpp-preset-main :focus{border-color:rgba(139,124,246,.65);box-shadow:0 0 0 3px rgba(139,124,246,.12)}
.rpp-choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.rpp-choice-card{overflow:hidden;border:1px solid var(--rpp-line);border-radius:10px;background:#10141e}.rpp-choice-selected{border-color:color-mix(in srgb,var(--rpp-accent) 55%,transparent);background:color-mix(in srgb,var(--rpp-accent) 8%,#10141e)}.rpp-choice-main{display:grid;grid-template-columns:29px minmax(0,1fr) 18px;align-items:center;gap:7px;width:100%;padding:7px;border:0;color:inherit;background:transparent;text-align:left;cursor:pointer}.rpp-avatar,.rpp-entity-avatar{display:grid;place-items:center;color:white;background:linear-gradient(145deg,var(--rpp-accent),color-mix(in srgb,var(--rpp-accent) 55%,black));font-family:Georgia,serif}.rpp-avatar{width:29px;height:29px;border-radius:9px}.rpp-choice-main>span:nth-child(2){display:flex;flex-direction:column;min-width:0}.rpp-choice-main b{font-size:10px}.rpp-choice-main small{overflow:hidden;color:var(--rpp-muted);font-size:7px;text-overflow:ellipsis;white-space:nowrap}.rpp-choice-main i{font-style:normal;color:var(--rpp-accent)}.rpp-primary{width:100%;padding:5px;border:0;border-top:1px solid var(--rpp-line);color:var(--rpp-muted);background:rgba(255,255,255,.02);font-size:7px;cursor:pointer}.rpp-primary-active{color:var(--rpp-accent);font-weight:700}.rpp-compose-actions,.rpp-preset-actions{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:15px}.rpp-compose-actions>span,.rpp-preset-actions>span{color:var(--rpp-muted);font-size:9px}.rpp-compose-buttons{display:flex;justify-content:flex-end;gap:7px}.rpp-primary-action,.rpp-danger-action,.rpp-secondary-action{min-height:35px;padding:0 14px;border-radius:10px;font:inherit;font-size:10px;font-weight:650;cursor:pointer}.rpp-primary-action{border:1px solid rgba(255,255,255,.11);color:white;background:linear-gradient(135deg,#8b7cf6,#6657d2);box-shadow:0 9px 24px rgba(98,82,210,.25)}.rpp-primary-action:disabled{cursor:not-allowed;filter:grayscale(.7);opacity:.45}.rpp-secondary-action{border:1px solid var(--rpp-line);color:#d9d5ff;background:rgba(139,124,246,.1)}.rpp-danger-action{border:1px solid rgba(255,105,105,.22);color:#ffb9b9;background:rgba(255,80,80,.07)}
.rpp-preview{position:sticky;top:0;align-self:start;padding:16px;border:1px solid var(--rpp-line);border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.038),rgba(255,255,255,.018))}.rpp-preview-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.rpp-preview-heading span{font-size:11px;font-weight:650}.rpp-preview-heading small{color:var(--rpp-muted);font-size:8px}.rpp-layer-stack{display:flex;flex-direction:column;gap:7px}.rpp-layer-card{position:relative;display:grid;grid-template-columns:25px minmax(0,1fr);gap:8px;padding:10px;border:1px solid color-mix(in srgb,var(--rpp-accent) 25%,var(--rpp-line));border-radius:11px;background:linear-gradient(100deg,color-mix(in srgb,var(--rpp-accent) 9%,transparent),rgba(255,255,255,.016));overflow:hidden}.rpp-layer-card:before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:var(--rpp-accent)}.rpp-layer-index{color:var(--rpp-accent);font-family:monospace;font-size:8px}.rpp-layer-kind{color:var(--rpp-accent);font-size:7px;font-weight:700;letter-spacing:.11em}.rpp-layer-card h3{display:flex;gap:7px;align-items:baseline;margin:2px 0 3px;font-size:11px}.rpp-layer-card h3 small{color:var(--rpp-muted);font-size:7px;font-weight:400}.rpp-layer-card p{display:-webkit-box;overflow:hidden;margin:0;color:var(--rpp-muted);font-size:8px;line-height:1.45;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:pre-line}.rpp-layer-empty{filter:saturate(.25);opacity:.58}.rpp-preview-note{display:flex;flex-direction:column;gap:4px;margin-top:12px;padding:11px;border-radius:10px;color:var(--rpp-muted);background:rgba(139,124,246,.065);font-size:8px;line-height:1.5}.rpp-preview-note b{color:#b9b0ff;font-size:9px}
.rpp-manager,.rpp-preset-layout{display:grid;grid-template-columns:270px minmax(0,1fr);min-height:560px;border:1px solid var(--rpp-line);border-radius:17px;overflow:hidden;background:rgba(255,255,255,.018)}.rpp-entity-list{display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--rpp-line);background:rgba(255,255,255,.018)}.rpp-list-heading{display:flex;align-items:center;justify-content:space-between;padding:13px;border-bottom:1px solid var(--rpp-line)}.rpp-list-heading span{font-size:10px;font-weight:650}.rpp-list-heading button{border:0;color:#aaa1ff;background:transparent;font-size:8px;cursor:pointer}.rpp-list-scroll{overflow:auto;padding:7px}.rpp-list-scroll>button{display:grid;grid-template-columns:35px minmax(0,1fr);align-items:center;gap:8px;width:100%;margin-bottom:4px;padding:7px;border:1px solid transparent;border-radius:10px;color:var(--rpp-muted);background:transparent;text-align:left;cursor:pointer}.rpp-list-scroll>button.rpp-entity-active{color:var(--rpp-text);border-color:var(--rpp-line);background:rgba(139,124,246,.09)}.rpp-entity-avatar{width:35px;height:35px;border-radius:10px}.rpp-list-scroll>button>span:last-child{display:flex;flex-direction:column;min-width:0;gap:2px}.rpp-list-scroll b{font-size:10px}.rpp-list-scroll small{overflow:hidden;font-size:7px;text-overflow:ellipsis;white-space:nowrap;opacity:.7}.rpp-editor{display:flex;flex-direction:column;min-width:0;padding:21px}.rpp-editor-hero{display:flex;align-items:center;gap:13px;margin-bottom:20px}.rpp-editor-orb{display:grid;place-items:center;width:53px;height:53px;border-radius:17px;color:white;background:radial-gradient(circle at 30% 20%,color-mix(in srgb,var(--rpp-accent) 75%,white),var(--rpp-accent));box-shadow:0 12px 34px color-mix(in srgb,var(--rpp-accent) 25%,transparent);font-family:Georgia,serif;font-size:22px}.rpp-editor-hero>span:last-child{display:flex;flex-direction:column}.rpp-editor-hero h3{margin:3px 0 2px;font-family:Georgia,'Noto Serif SC',serif;font-size:20px;font-weight:500}.rpp-editor-hero p{margin:0;color:var(--rpp-muted);font-size:9px}.rpp-import-badge{margin-top:5px;color:#9c90ff;font-size:7px}.rpp-editor-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.rpp-editor-field{display:flex;flex-direction:column;gap:5px}.rpp-editor-field-wide{grid-column:1/-1}.rpp-editor-field>span{display:flex;justify-content:space-between;font-size:9px}.rpp-editor-field small{color:var(--rpp-muted);font-size:7px}.rpp-editor input[type=color]{padding:4px}.rpp-editor-actions{display:flex;justify-content:space-between;gap:10px;margin-top:auto;padding-top:20px}
.rpp-worldbook{grid-column:1/-1;margin-top:16px;border:1px solid var(--rpp-line);border-radius:13px;overflow:hidden;background:rgba(0,0,0,.12)}.rpp-worldbook>header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--rpp-line)}.rpp-worldbook>header>span{display:flex;flex-direction:column}.rpp-worldbook>header b{font-size:10px}.rpp-worldbook>header small{color:var(--rpp-muted);font-size:7px}.rpp-worldbook>header button{border:0;color:#9f95ff;background:transparent;font-size:8px;cursor:pointer}.rpp-worldbook-grid{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:300px}.rpp-worldbook-grid>aside{padding:8px;border-right:1px solid var(--rpp-line)}.rpp-worldbook-grid>aside>input{box-sizing:border-box;width:100%;height:31px;margin-bottom:7px;padding:0 8px;border:1px solid var(--rpp-line);border-radius:8px;color:var(--rpp-text);background:#10141e;font-size:8px}.rpp-worldbook-grid>aside>div{max-height:310px;overflow:auto}.rpp-worldbook-grid>aside>div>div{display:grid;grid-template-columns:20px minmax(0,1fr);align-items:center;border:1px solid transparent;border-radius:8px}.rpp-worldbook-grid>aside>div>div.rpp-world-entry-active{border-color:rgba(66,184,131,.25);background:rgba(66,184,131,.08)}.rpp-worldbook-grid>aside button{display:flex;min-width:0;flex-direction:column;padding:7px;border:0;color:var(--rpp-muted);background:transparent;text-align:left;cursor:pointer}.rpp-worldbook-grid>aside button b{overflow:hidden;color:var(--rpp-text);font-size:8px;text-overflow:ellipsis;white-space:nowrap}.rpp-worldbook-grid>aside button small{overflow:hidden;font-size:7px;text-overflow:ellipsis;white-space:nowrap}.rpp-world-entry-editor{padding:12px}.rpp-world-entry-editor input,.rpp-world-entry-editor textarea{box-sizing:border-box;width:100%;border:1px solid var(--rpp-line);border-radius:8px;color:var(--rpp-text);background:#10141e;font:inherit;font-size:9px}.rpp-world-entry-editor input{height:32px;padding:0 8px}.rpp-world-entry-editor textarea{padding:9px;line-height:1.5;resize:vertical}.rpp-world-entry-actions{display:flex;align-items:center;justify-content:space-between;margin-top:8px}.rpp-world-entry-actions small{color:var(--rpp-muted);font-family:monospace;font-size:7px}
.rpp-preset-main{display:flex;flex-direction:column;min-width:0;padding:19px}.rpp-preset-header{display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:18px;align-items:end;padding-bottom:16px;border-bottom:1px solid var(--rpp-line)}.rpp-preset-header>div:first-child input{height:39px;margin-top:5px;font-family:Georgia,serif;font-size:19px}.rpp-generation{display:grid;grid-template-columns:110px 110px 110px;gap:8px}.rpp-generation label,.rpp-editor-row label{display:flex;flex-direction:column;gap:4px;color:var(--rpp-muted);font-size:7px}.rpp-prompt-workbench{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(300px,1.2fr);gap:15px;min-height:0;flex:1;padding-top:15px}.rpp-prompt-order,.rpp-prompt-editor{min-width:0;border:1px solid var(--rpp-line);border-radius:13px;background:rgba(0,0,0,.11);overflow:hidden}.rpp-subheading{display:flex;align-items:center;justify-content:space-between;padding:10px;border-bottom:1px solid var(--rpp-line);font-size:9px}.rpp-subheading select{width:125px;height:27px}.rpp-order-list{max-height:430px;overflow:auto;padding:6px}.rpp-order-list>button{display:grid;grid-template-columns:17px 55px minmax(0,1fr) 34px;align-items:center;gap:6px;width:100%;padding:7px;border:1px solid transparent;border-radius:9px;color:var(--rpp-muted);background:transparent;text-align:left;cursor:pointer}.rpp-order-list>button:hover,.rpp-order-list>button.rpp-order-active{color:var(--rpp-text);border-color:var(--rpp-line);background:rgba(139,124,246,.08)}.rpp-order-list input{width:13px;height:13px}.rpp-order-list button>span:nth-child(3){display:flex;flex-direction:column;min-width:0}.rpp-order-list b{font-size:9px}.rpp-order-list small{overflow:hidden;font-size:7px;text-overflow:ellipsis}.rpp-role{padding:3px 4px;border-radius:5px;text-align:center;font-size:6px;text-transform:uppercase}.rpp-role-system{color:#beb6ff;background:rgba(139,124,246,.13)}.rpp-role-user{color:#8be3f3;background:rgba(54,184,212,.13)}.rpp-role-assistant{color:#ffb6a9;background:rgba(244,127,107,.13)}.rpp-order-arrows{display:flex;gap:2px}.rpp-order-arrows i{padding:3px;font-style:normal}.rpp-prompt-editor{padding:14px}.rpp-editor-row{display:grid;grid-template-columns:1fr 110px;gap:10px;margin-bottom:11px}.rpp-marker-switch{display:flex;align-items:center;gap:6px;margin-bottom:10px;color:var(--rpp-muted);font-size:8px}.rpp-marker-switch input{width:14px;height:14px}.rpp-source-note{display:flex;align-items:center;gap:7px;margin-top:10px;padding:8px;border-radius:8px;color:var(--rpp-muted);background:rgba(192,132,252,.07);font-size:7px}.rpp-source-note b{color:#d7b2ff}.rpp-source-note span{overflow:hidden;flex:1;text-overflow:ellipsis;white-space:nowrap}
.rpp-prompt-filters{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px;padding:7px;border-bottom:1px solid var(--rpp-line)}.rpp-prompt-filters input{height:29px}.rpp-prompt-filters label{display:flex;align-items:center;gap:4px;color:var(--rpp-muted);font-size:7px;white-space:nowrap}.rpp-prompt-filters label input{width:13px;height:13px}.rpp-unassigned{margin-top:7px;border-top:1px solid var(--rpp-line);padding-top:6px}.rpp-unassigned summary{padding:7px;color:#d8b4fe;font-size:8px;cursor:pointer}.rpp-unassigned>button{display:grid;grid-template-columns:18px minmax(0,1fr);gap:6px;width:100%;padding:6px 7px;border:0;border-radius:8px;color:var(--rpp-muted);background:transparent;text-align:left;cursor:pointer}.rpp-unassigned>button:hover{background:rgba(192,132,252,.08)}.rpp-unassigned>button>span:last-child{display:flex;flex-direction:column;min-width:0}.rpp-unassigned b{font-size:8px}.rpp-unassigned small{overflow:hidden;font-size:7px;text-overflow:ellipsis;white-space:nowrap}.rpp-prompt-meta{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px}.rpp-prompt-meta span{padding:4px 6px;border:1px solid var(--rpp-line);border-radius:6px;color:var(--rpp-muted);background:rgba(255,255,255,.025);font-size:7px}
.rpp-import-page{max-width:900px;margin:0 auto}.rpp-dropzone{display:flex;min-height:280px;flex-direction:column;align-items:center;justify-content:center;padding:30px;border:1px dashed rgba(192,132,252,.42);border-radius:20px;background:radial-gradient(circle at 50% 20%,rgba(192,132,252,.12),transparent 46%),rgba(255,255,255,.018);text-align:center;transition:.18s}.rpp-dropzone-active{border-color:#c084fc;background:rgba(192,132,252,.1);transform:scale(.995)}.rpp-import-glyph{display:grid;place-items:center;width:58px;height:58px;border:1px solid rgba(192,132,252,.32);border-radius:19px;color:#d8b4fe;background:rgba(192,132,252,.11);font-size:28px}.rpp-dropzone h3{margin:15px 0 7px;font-family:Georgia,'Noto Serif SC',serif;font-size:22px;font-weight:500}.rpp-dropzone p{max-width:610px;margin:0 0 18px;color:var(--rpp-muted);font-size:10px;line-height:1.7}.rpp-import-queue,.rpp-import-results{margin-top:18px;padding:16px;border:1px solid var(--rpp-line);border-radius:16px;background:rgba(255,255,255,.018)}.rpp-file-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.rpp-file-grid article{display:grid;grid-template-columns:42px minmax(0,1fr);align-items:center;gap:9px;padding:9px;border:1px solid var(--rpp-line);border-radius:10px}.rpp-file-grid article>span{display:grid;place-items:center;height:34px;border-radius:8px;color:#d8b4fe;background:rgba(192,132,252,.1);font-size:7px}.rpp-file-grid article div{display:flex;flex-direction:column;min-width:0}.rpp-file-grid b{overflow:hidden;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.rpp-file-grid small{color:var(--rpp-muted);font-size:7px}.rpp-import-results article{display:grid;grid-template-columns:24px 1fr;gap:9px;padding:9px;border-top:1px solid var(--rpp-line);color:#79dca9}.rpp-import-results article>span{font-size:15px}.rpp-import-results article div{display:flex;flex-direction:column}.rpp-import-results b{color:var(--rpp-text);font-size:9px}.rpp-import-results p{margin:2px 0;color:var(--rpp-muted);font-size:8px}.rpp-import-results small{color:#d1a7ff;font-size:7px}.rpp-import-results .rpp-import-error{color:#ff909c}.rpp-empty{text-align:center;color:var(--rpp-muted)}
.rpp-import-preset-actions{display:flex;flex-direction:row!important;align-items:center;gap:7px;margin-top:9px;padding:9px;border:1px solid rgba(192,132,252,.2);border-radius:9px;background:rgba(192,132,252,.055)}.rpp-import-preset-actions>span{min-width:0;flex:1;color:var(--rpp-muted);font-size:8px}.rpp-import-preset-actions button{min-height:30px;padding:0 9px;border:1px solid var(--rpp-line);border-radius:8px;color:var(--rpp-text);background:rgba(255,255,255,.035);font:inherit;font-size:8px;white-space:nowrap;cursor:pointer}.rpp-import-preset-actions .rpp-primary-action{border-color:rgba(192,132,252,.28);background:linear-gradient(135deg,#8b7cf6,#6657d2)}
.rpp-agent-seat{position:relative}.rpp-agent-seat-button{display:inline-flex;overflow:hidden;max-width:min(100%,240px);min-height:28px;align-items:center;gap:5px;padding:0 8px;border:0;border-radius:16px;color:var(--dsw-alias-label-primary,#222733);background:transparent;font:inherit;font-size:13px;font-weight:500;line-height:20px;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}.rpp-agent-seat-button:hover,.rpp-agent-seat-button[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}.rpp-agent-seat-button:disabled{cursor:default;opacity:.55}.rpp-agent-seat-icon{display:grid;place-items:center;width:16px;height:16px;border:1.5px solid currentColor;border-radius:50%;font-size:0}.rpp-agent-seat-icon:after{width:5px;height:5px;border-radius:50%;background:currentColor;content:''}.rpp-agent-seat-chevron{color:var(--dsw-alias-label-caption,#8f98aa);font-size:14px}.rpp-agent-seat-menu{position:absolute;z-index:80;top:34px;left:0;display:flex;width:min(340px,calc(100vw - 32px));max-height:min(460px,70vh);flex-direction:column;gap:3px;overflow:auto;padding:6px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:14px;background:var(--dsw-alias-bg-raised,#fff);box-shadow:0 18px 48px rgba(22,22,36,.2)}.rpp-agent-seat-menu>button{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;padding:9px 10px;border:0;border-radius:9px;color:var(--dsw-alias-label-primary,#222733);background:transparent;text-align:left;cursor:pointer}.rpp-agent-seat-menu>button:hover,.rpp-agent-seat-selected{background:color-mix(in srgb,#8b7cf6 10%,transparent)!important}.rpp-agent-seat-menu>button>span{display:flex;min-width:0;flex-direction:column;gap:1px}.rpp-agent-seat-menu b{font-size:12px}.rpp-agent-seat-menu small{color:var(--dsw-alias-label-caption,#8f98aa);font-size:10px;line-height:1.45;white-space:normal}.rpp-agent-seat-menu i{color:#786adc;font-style:normal}
.rpp-quick-setup{box-sizing:border-box;width:100%;padding:14px;border:1px solid color-mix(in srgb,#8b7cf6 32%,var(--dsw-alias-border-l2,rgba(127,127,127,.18)));border-radius:16px;color:var(--dsw-alias-label-primary,#222733);background:linear-gradient(145deg,color-mix(in srgb,var(--dsw-alias-bg-raised,#fff) 94%,#8b7cf6 6%),var(--dsw-alias-bg-raised,#fff));box-shadow:0 12px 32px rgba(44,37,100,.08)}.rpp-quick-setup>header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;margin-bottom:12px}.rpp-quick-mode{padding:5px 7px;border-radius:7px;color:#7567dd;background:rgba(139,124,246,.11);font-size:8px;font-weight:800;letter-spacing:.1em}.rpp-quick-setup h3{margin:0;font-size:13px}.rpp-quick-setup p{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#8f98aa);font-size:8px}.rpp-quick-setup>header button{border:0;color:#776ad9;background:transparent;font:inherit;font-size:8px;cursor:pointer}.rpp-quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.rpp-quick-grid label{display:flex;min-width:0;flex-direction:column;gap:4px;color:var(--dsw-alias-label-tertiary,#8f98aa);font-size:7px}.rpp-quick-grid select,.rpp-quick-grid input{box-sizing:border-box;width:100%;height:33px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:8px;outline:none;color:var(--dsw-alias-label-primary,#222733);background:var(--dsw-alias-bg-base,#fff);font:inherit;font-size:9px}.rpp-quick-grid select:focus,.rpp-quick-grid input:focus{border-color:rgba(139,124,246,.55);box-shadow:0 0 0 3px rgba(139,124,246,.09)}.rpp-quick-scene{grid-column:span 2}.rpp-quick-setup>footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:11px}.rpp-quick-setup>footer>span{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-tertiary,#8f98aa);font-size:8px}.rpp-quick-avatar{display:grid;place-items:center;width:25px;height:25px;border-radius:8px;color:white;background:var(--rpp-accent);font-size:9px}.rpp-quick-setup .rpp-loading-orb{display:inline-block;width:18px;height:18px;margin:0 8px 0 0;vertical-align:middle}
.rpp-header-context,.rpp-context-dock,.rpp-sidebar-action{font:inherit}.rpp-header-context{display:flex;align-items:center;gap:7px;height:27px;padding:0 9px;border:1px solid rgba(139,124,246,.2);border-radius:8px;color:#c9c4ff;background:rgba(139,124,246,.08);font-size:9px;cursor:pointer}.rpp-header-context-empty{color:var(--dsw-alias-label-tertiary,#9299a8);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.18));background:transparent}.rpp-stack-icon{position:relative;display:block;width:13px;height:13px}.rpp-stack-icon i{position:absolute;left:1px;width:10px;height:5px;border:1px solid currentColor;border-radius:2px}.rpp-stack-icon i:nth-child(1){top:1px}.rpp-stack-icon i:nth-child(2){top:4px}.rpp-stack-icon i:nth-child(3){top:7px}.rpp-context-dock{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:11px;color:var(--dsw-alias-label-primary,#e8eaf0);background:color-mix(in srgb,var(--dsw-alias-bg-raised,#171a22) 88%,#8b7cf6 12%);text-align:left;cursor:pointer}.rpp-context-dock-label{flex:none;color:var(--dsw-alias-label-tertiary,#9299a8);font-size:8px;text-transform:uppercase}.rpp-context-dock-layers{display:flex;align-items:center;gap:4px;min-width:0;flex:1;overflow:hidden}.rpp-mini-layer{display:flex;align-items:center;gap:3px;min-width:0;padding:3px 5px;border-left:2px solid var(--rpp-accent);border-radius:5px;background:color-mix(in srgb,var(--rpp-accent) 8%,transparent);font-size:7px}.rpp-mini-layer b{color:var(--rpp-accent)}.rpp-mini-layer span{overflow:hidden;max-width:66px;color:var(--dsw-alias-label-secondary,#babfca);text-overflow:ellipsis;white-space:nowrap}.rpp-mini-layer-empty{opacity:.45}.rpp-context-edit{flex:none;color:#aaa1ff;font-size:8px}.rpp-sidebar-action{box-sizing:border-box;display:flex;align-items:center;border:0;color:var(--dsw-alias-label-primary,#e8eaf0);background:transparent;cursor:pointer}.rpp-sidebar-action-wide{width:calc(100% + 8px);height:34px;gap:8px;margin:4px -4px;padding:5px 4px 5px 9px;border-radius:12px;font-size:13px}.rpp-sidebar-action-wide:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}.rpp-sidebar-action-rail{width:36px;height:36px;justify-content:center;margin:6px 0;border-radius:50%}.rpp-mark{width:22px;height:22px;border-radius:8px;font-family:serif;font-size:11px}
.rpp-story{box-sizing:border-box;display:flex;min-height:100%;flex-direction:column;color:var(--dsw-alias-label-primary,#edf0f7);background:radial-gradient(circle at 85% 0,rgba(139,124,246,.085),transparent 28%)}.rpp-story-header{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:17px max(22px,calc((100% - 920px)/2));border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14));background:color-mix(in srgb,var(--dsw-alias-bg-base,#10131a) 88%,transparent);backdrop-filter:blur(16px)}.rpp-story-identity{display:flex;align-items:center;gap:12px}.rpp-story-avatar{display:grid;place-items:center;width:46px;height:46px;border-radius:15px;color:white;background:radial-gradient(circle at 30% 20%,color-mix(in srgb,var(--rpp-accent) 72%,white),var(--rpp-accent));box-shadow:0 10px 28px color-mix(in srgb,var(--rpp-accent) 22%,transparent);font-family:Georgia,serif;font-size:19px}.rpp-story-identity h2{margin:2px 0;font-family:Georgia,'Noto Serif SC',serif;font-size:20px;font-weight:500}.rpp-story-identity p{margin:0;color:var(--dsw-alias-label-tertiary,#8f98aa);font-size:9px}.rpp-story-actions{display:flex;gap:7px}.rpp-story-actions button,.rpp-story-foot button{height:31px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:9px;color:inherit;background:rgba(255,255,255,.035);font:inherit;font-size:8px;cursor:pointer}.rpp-story-thread{display:flex;width:min(920px,calc(100% - 34px));flex:1;flex-direction:column;gap:18px;margin:0 auto;padding:28px 0 120px}.rpp-message{width:min(76%,720px)}.rpp-message-assistant{align-self:flex-start}.rpp-message-user{align-self:flex-end}.rpp-message-head{display:flex;align-items:center;gap:8px;margin-bottom:7px}.rpp-message-avatar{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;color:white;background:var(--rpp-accent);font-family:Georgia,serif;font-size:11px}.rpp-message-head>span:nth-child(2){display:flex;flex:1;flex-direction:column}.rpp-message-head b{font-size:10px}.rpp-message-head small{color:var(--dsw-alias-label-tertiary,#8f98aa);font-size:7px}.rpp-message-head button{border:0;color:var(--dsw-alias-label-tertiary,#8f98aa);background:transparent;font:inherit;font-size:7px;cursor:pointer;opacity:0}.rpp-message:hover .rpp-message-head button,.rpp-message:focus-within .rpp-message-head button{opacity:1}.rpp-message-body{padding:14px 16px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14));border-radius:4px 16px 16px 16px;background:rgba(255,255,255,.032);font-family:Georgia,'Noto Serif SC',serif;font-size:13px;line-height:1.8;white-space:pre-wrap;box-shadow:0 8px 26px rgba(0,0,0,.08)}.rpp-message-user .rpp-message-head{flex-direction:row-reverse}.rpp-message-user .rpp-message-head>span:nth-child(2){text-align:right}.rpp-message-user .rpp-message-body{border-radius:16px 4px 16px 16px;background:rgba(54,184,212,.065)}.rpp-message-editor{padding:10px;border:1px solid rgba(139,124,246,.28);border-radius:13px;background:rgba(139,124,246,.06)}.rpp-message-editor textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:9px;outline:none;color:inherit;background:rgba(0,0,0,.2);font:inherit;font-size:11px;line-height:1.6;resize:vertical}.rpp-message-editor>div{display:flex;justify-content:flex-end;gap:7px;margin-top:7px}.rpp-message-editor button{height:31px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:8px;color:inherit;background:transparent;font:inherit;font-size:8px;cursor:pointer}.rpp-message-streaming{opacity:.8}.rpp-caret{display:inline-block;width:2px;height:1em;margin-left:3px;background:#9c90ff;vertical-align:-2px;animation:rpp-blink .75s steps(2) infinite}.rpp-story-foot{display:flex;justify-content:space-between;gap:12px;width:min(920px,calc(100% - 34px));margin:auto;padding:12px 0 26px;color:var(--dsw-alias-label-tertiary,#8f98aa);font-size:8px}.rpp-story-empty{display:flex;min-height:420px;flex-direction:column;align-items:center;justify-content:center;padding:30px;text-align:center}.rpp-story-empty>span{font-size:32px;color:#9c90ff}.rpp-story-empty h3{margin:10px 0 5px;font-family:Georgia,'Noto Serif SC',serif;font-size:20px;font-weight:500}.rpp-story-empty p{max-width:500px;margin:0 0 15px;color:var(--dsw-alias-label-tertiary,#8f98aa);font-size:10px}.rpp-story-empty-compact{min-height:300px}.rpp-loading{display:flex;min-height:380px;flex-direction:column;align-items:center;justify-content:center;color:var(--rpp-muted);gap:6px}.rpp-loading-orb{width:34px;height:34px;margin-bottom:8px;border:2px solid rgba(139,124,246,.2);border-top-color:#8b7cf6;border-radius:50%;animation:rpp-spin .8s linear infinite}.rpp-loading b{color:var(--rpp-text);font-size:11px}.rpp-loading small{font-size:8px}
.rpp-runtime-projection{display:flex;flex-direction:column;gap:9px;width:min(84%,760px);align-self:center}.rpp-effect-card{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;padding:11px 13px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));border-left:3px solid var(--effect,#8b7cf6);border-radius:12px;background:rgba(255,255,255,.025)}.rpp-effect-world{--effect:#42b883}.rpp-effect-time{--effect:#e7a84f}.rpp-effect-scene{--effect:#36b8d4}.rpp-effect-character{--effect:#f47f6b}.rpp-effect-persona{--effect:#8b7cf6}.rpp-effect-relationship{--effect:#ec6fb1}.rpp-effect-memory{--effect:#7ca7f6}.rpp-effect-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;color:white;background:var(--effect);font-family:Georgia,serif;font-size:11px}.rpp-effect-card>div>span{color:var(--effect);font-size:7px;font-weight:700;letter-spacing:.12em}.rpp-effect-card h3{margin:2px 0;font-size:11px}.rpp-effect-card p{margin:0;color:var(--dsw-alias-label-secondary,#aeb6c5);font-size:9px;line-height:1.5}.rpp-effect-card details{margin-top:6px;color:var(--dsw-alias-label-tertiary,#8f98aa);font-size:7px}.rpp-effect-card pre{overflow:auto;max-height:160px;padding:7px;border-radius:7px;background:rgba(0,0,0,.15);font-size:7px}.rpp-choices{padding:13px;border:1px solid rgba(139,124,246,.2);border-radius:13px;background:rgba(139,124,246,.055)}.rpp-choices h3{margin:0 0 9px;font-family:Georgia,'Noto Serif SC',serif;font-size:12px;font-weight:500}.rpp-choices>div{display:flex;flex-wrap:wrap;gap:7px}.rpp-choices button{min-height:34px;padding:0 11px;border:1px solid rgba(139,124,246,.28);border-radius:9px;color:inherit;background:rgba(139,124,246,.09);font:inherit;font-size:9px;cursor:pointer}.rpp-choices button:hover{background:rgba(139,124,246,.17)}.rpp-choices button:disabled{cursor:not-allowed;opacity:.5}.rpp-choices button.rpp-choice-picked{border-color:#55d89a;color:#9de7bf}
@keyframes rpp-spin{to{transform:rotate(360deg)}}@keyframes rpp-fade{from{opacity:0}to{opacity:1}}@keyframes rpp-blink{50%{opacity:0}}
@media(max-width:900px){.rpp-shell{grid-template-columns:72px minmax(0,1fr)}.rpp-brand{justify-content:center;padding-inline:0}.rpp-brand>span:last-child,.rpp-nav nav button>span:last-child,.rpp-nav-foot span:last-child{display:none}.rpp-nav nav button{display:flex;justify-content:center;padding:5px}.rpp-compose-grid{grid-template-columns:1fr}.rpp-preview{position:static}.rpp-field{grid-template-columns:1fr}.rpp-manager,.rpp-preset-layout{grid-template-columns:1fr}.rpp-entity-list{max-height:210px;border-right:0;border-bottom:1px solid var(--rpp-line)}.rpp-prompt-workbench{grid-template-columns:1fr}.rpp-preset-header{grid-template-columns:1fr}.rpp-editor-fields{grid-template-columns:1fr}.rpp-editor-field-wide{grid-column:auto}.rpp-generation{grid-template-columns:repeat(3,1fr)}}
@media(max-width:600px){.rpp-overlay{padding:8px}.rpp-modal{width:calc(100vw - 16px);height:calc(100vh - 16px);border-radius:15px}.rpp-shell{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.rpp-nav{padding:8px;border-right:0;border-bottom:1px solid var(--rpp-line)}.rpp-brand{display:none}.rpp-nav nav{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}.rpp-nav nav button{min-height:38px}.rpp-nav-foot{display:none}.rpp-main-header{padding:15px}.rpp-main-header p{display:none}.rpp-content{padding:12px}.rpp-choice-grid,.rpp-file-grid{grid-template-columns:1fr}.rpp-story-header{padding:12px 15px}.rpp-story-actions button:first-child{display:none}.rpp-message{width:92%}.rpp-story-thread{width:calc(100% - 24px)}.rpp-story-foot{width:calc(100% - 24px)}.rpp-generation{grid-template-columns:1fr}.rpp-preset-main{padding:12px}}
@media(max-width:720px){.rpp-quick-setup>header{grid-template-columns:auto minmax(0,1fr)}.rpp-quick-setup>header button{grid-column:1/-1;text-align:right}.rpp-quick-grid{grid-template-columns:1fr 1fr}.rpp-quick-scene{grid-column:1/-1}.rpp-quick-setup>footer{align-items:stretch;flex-direction:column}.rpp-quick-setup>footer button{width:100%}}
`
