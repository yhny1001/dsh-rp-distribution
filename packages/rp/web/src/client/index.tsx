/** DSH Web RP Studio browser plugin. */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RpWebCatalog,
  RpWebImportKind,
  RpWebImportRequest,
  RpWebImportResponse,
  RpWebLibraryCatalogResponse,
  RpWebLibraryMutationRequest,
  RpWebLibraryMutationResponse,
  RpWebPresetCatalogResponse,
  RpWebPresetMutationRequest,
  RpWebPresetMutationResponse,
  RpWebRegistryMutationRequest,
  RpWebRegistryMutationResponse,
  RpWebTimelineResponse,
} from '../types.ts'
import { en, experienceLabel, zh, type RpStudioLocaleKey } from './locales.ts'
import { RpWebCatalogController } from './catalog-controller.ts'
import {
  RpConversationSidebar, RpMessageAfter, type RpCatalogInjected,
} from './conversation-ui-slots.tsx'
import {
  RpConversationView,
  RpModeControl,
  RpTurnStatus,
  type RpConversationInjected,
} from './rp-conversation.tsx'
import { RpWebTurnController, type RpWebLatestTurnState } from './turn-controller.ts'
import { RpWebResourceController } from './resource-controller.ts'
import { RpSessionInspector } from './session-resources.tsx'
import { UiSlotFrames } from './ui-slots.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'rp.studio': RpStudioLocaleKey }
}

export const inject = ['slots', 'locale', 'conversation', 'sessions']
const NS = 'rp.studio'
const API = '/api/rp/v1'
interface RpStudioInjected extends RpCatalogInjected {
  hooks: RpCatalogInjected['hooks'] & { rpTurnLatest: HostObservable<RpWebLatestTurnState> }
}
type StudioProps = PropsRuntime<'settings.plugins.tab'> & InjectFace<RpStudioInjected> & PropsLocale<'rp.studio'>
type Page = 'overview' | 'pipelines' | 'capabilities' | 'registry' | 'creator' | 'timeline'

/** Mount RP Studio as a first-class Plugins settings tab. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rp-web: dictionaries')
  const t = ctx.locale.bind(NS)
  const catalog = new RpWebCatalogController(API)
  const turns = new RpWebTurnController(
    API,
    () => crypto.randomUUID(),
    async (imageIds, signal) => await ctx.conversation.encodeDraftImages(imageIds, signal),
  )
  const resources = new RpWebResourceController(API)
  const loadCatalog = (refresh = false): Promise<void> => catalog.load(refresh)
  const catalogInjected = (): RpCatalogInjected => ({
    hooks: { rpCatalog: catalog.store },
    loadCatalog,
  })
  const studioInjected = (): RpStudioInjected => ({
    hooks: { rpCatalog: catalog.store, rpTurnLatest: turns.latest },
    loadCatalog,
  })
  const conversationInjected = (sessionId: SessionId): RpConversationInjected => ({
    hooks: {
      rpCatalog: catalog.store,
      rpTurn: turns.storeFor(sessionId),
      rpResources: resources.storeFor(sessionId),
    },
    loadCatalog,
    loadResources: async (refresh = false) => { await resources.load(sessionId, refresh) },
    importResource: async (kind, file) => { await resources.importFile(sessionId, kind, file) },
    setResourceActive: async (kind, id, active) => {
      await resources.setAssetActive(sessionId, kind, id, active)
    },
    setPresetActive: async (presetId) => { await resources.setPresetActive(sessionId, presetId) },
    openResourceEditor: async (target) => { await resources.openEditor(sessionId, target) },
    saveResourceEditor: async (document) => { await resources.saveEditor(sessionId, document) },
    closeResourceEditor: () => { resources.closeEditor(sessionId) },
    setMode: (mode) => { turns.setMode(sessionId, mode) },
    setExperience: (experienceId) => { turns.setExperience(sessionId, experienceId) },
    cancelTurn: () => { turns.cancel(sessionId) },
    loadTimeline: async () => { await turns.loadTimeline(sessionId) },
    resolveImage: async attachment => await ctx.conversation.resolveImage(sessionId, attachment),
  })
  ctx.conversation.registerSubmissionHandler(turns.submissionHandler)
  ctx.effect(() => {
    const prune = (): void => {
      const live = new Set(Object.keys(ctx.sessions.list.getSnapshot().byId) as SessionId[])
      turns.prune(live)
      resources.prune(live)
    }
    prune()
    return ctx.sessions.list.subscribe(prune)
  }, 'rp-web: prune removed Session turn projections')
  ctx.effect(() => () => { catalog.dispose() }, 'rp-web: catalog projection')
  ctx.effect(() => () => { turns.dispose() }, 'rp-web: turn projections and transports')
  ctx.effect(() => () => { resources.dispose() }, 'rp-web: resource projections and transports')
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'rp-studio',
    order: -10,
    label: () => t('tab'),
    locale: NS,
    inject: studioInjected,
  }, RpStudio))
  ctx.slots.inject('sidebar.conversation', () => ctx.slots.register({
    name: 'sidebar.conversation',
    id: 'rp-packages',
    order: 10,
    locale: NS,
    inject: conversationInjected,
  }, RpConversationSidebar))
  ctx.slots.inject('conversation.chat.message.after', () => ctx.slots.register({
    name: 'conversation.chat.message.after',
    id: 'rp-packages',
    order: 10,
    locale: NS,
    inject: catalogInjected,
  }, RpMessageAfter))
  ctx.slots.inject('conversation.hero.mode', () => ctx.slots.register({
    name: 'conversation.hero.mode',
    id: 'rp-mode',
    order: 10,
    locale: NS,
    inject: conversationInjected,
  }, RpModeControl))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'rp-mode',
    order: -5,
    locale: NS,
    inject: conversationInjected,
  }, RpModeControl))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'rp-turn-status',
    order: -80,
    locale: NS,
    inject: conversationInjected,
  }, RpTurnStatus))
  ctx.slots.inject('conversation.rail.right', () => ctx.slots.register({
    name: 'conversation.rail.right',
    id: 'rp-inspector',
    order: -10,
    locale: NS,
    inject: conversationInjected,
  }, RpSessionInspector))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'rp',
    order: 5,
    label: () => t('rpMode'),
    locale: NS,
    inject: conversationInjected,
  }, RpConversationView))
}

/** Full catalog, pipeline inspector, and import preview surface. */
export function RpStudio({ t, useRpCatalog, useRpTurnLatest, useSessions, loadCatalog }: StudioProps): ReactNode {
  const [page, setPage] = useState<Page>('overview')
  const state = useRpCatalog(value => value)
  const latest = useRpTurnLatest(value => value)
  const currentSessionId = useSessions(value => value.current)

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  return <section style={styles.shell} data-rp-studio>
    <header style={styles.header}>
      <div>
        <h2 style={styles.h2}>RP Studio</h2>
        <p style={styles.muted}>Everything is Plugin · deterministic snapshots · scoped authority</p>
      </div>
      <button
        style={styles.button}
        type="button"
        onClick={() => { void loadCatalog(true) }}
      >
        {t('refresh')}
      </button>
    </header>
    <nav style={styles.nav}>
      {(['overview', 'pipelines', 'capabilities', 'registry', 'creator', 'timeline'] as const).map(id => <button
        key={id}
        type="button"
        style={{ ...styles.navButton, ...(page === id ? styles.navActive : {}) }}
        onClick={() => {
          setPage(id)
        }}
      >
        {t(id)}
      </button>)}
    </nav>
    {state.status === 'loading' ? <p style={styles.status}>{t('loading')}</p> : null}
    {state.status === 'error' ? <p role="alert" style={styles.status}>{t('error')}</p> : null}
    {state.status === 'ready' && page === 'overview' ? <Overview catalog={state.catalog} t={t} /> : null}
    {state.status === 'ready' && page === 'pipelines' ? <Pipelines catalog={state.catalog} t={t} /> : null}
    {state.status === 'ready' && page === 'capabilities'
      ? <Capabilities catalog={state.catalog} t={t} />
      : null}
    {state.status === 'ready' && page === 'registry'
      ? <Registry catalog={state.catalog} t={t} onChanged={() => {
        void loadCatalog(true)
      }} />
      : null}
    {state.status === 'ready' && page === 'creator' ? <div style={styles.stack}>
      <Creator t={t} sessionId={currentSessionId} />
      <UiSlotFrames catalog={state.catalog} placement="studio.creator" t={t} />
    </div> : null}
    {page === 'timeline' ? <Timeline t={t} latest={latest} /> : null}
  </section>
}

function Registry({
  catalog,
  t,
  onChanged,
}: {
  catalog: RpWebCatalog
  t: StudioProps['t']
  onChanged: () => void
}): ReactNode {
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RpWebRegistryMutationResponse>()
  const [error, setError] = useState<string>()

  const mutate = async (request: RpWebRegistryMutationRequest): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const response = await fetch(`${API}/registry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(request),
      })
      const value = await response.json() as RpWebRegistryMutationResponse & { error?: string }
      if (!response.ok) throw new Error(value.error ?? `registry ${response.status}`)
      setResult(value)
      onChanged()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return <div style={styles.stack}>
    <article style={styles.card}>
      <div style={styles.cardTitle}>
        <strong>{t('packageLifecycle')}</strong>
        <span style={styles.kind}>{catalog.registryInstallations.length} {t('installed')}</span>
      </div>
      <p style={styles.muted}>{t('registryMutationHint')}</p>
      <label style={styles.label}>
        {t('packageSource')}
        <input
          style={styles.input}
          value={source}
          placeholder="npm:@scope/package@1.2.3 | git+https://github.com/owner/repo.git#commit | registry:https://... | ./local"
          onChange={(event) => { setSource(event.currentTarget.value) }}
        />
      </label>
      <div style={styles.actions}>
        <button
          style={styles.primary}
          type="button"
          disabled={busy || source.trim() === ''}
          onClick={() => { void mutate({ action: 'install', source }) }}
        >
          {t('install')}
        </button>
        <button
          style={styles.button}
          type="button"
          disabled={busy || source.trim() === ''}
          onClick={() => { void mutate({ action: 'update', source }) }}
        >
          {t('update')}
        </button>
      </div>
      {busy ? <p style={styles.muted}>{t('registryWorking')}</p> : null}
      {error === undefined ? null : <p role="alert" style={styles.error}>{error}</p>}
      {result === undefined ? null : <p style={styles.good}>
        {result.action}: {result.rootId} 路 {result.graphHash.slice(0, 12)}
      </p>}
    </article>

    <div style={styles.metrics}>
      <Metric label={t('sourceProviders')} value={catalog.registrySourceProviders.length} />
      <Metric label={t('lifecycleAdapters')} value={catalog.registryLifecycleAdapters.length} />
      <Metric label={t('securityPolicies')} value={catalog.registrySecurityPolicies.length} />
      <Metric label={t('publishedReleases')} value={catalog.registryReleases.length} />
    </div>

    <p style={catalog.registryInstallationStore === undefined ? styles.warning : styles.good}>
      {t('durableRegistry')}: {catalog.registryInstallationStore?.id ?? t('processLocal')}
    </p>
    <p style={catalog.registryArtifactStore === undefined ? styles.warning : styles.good}>
      {t('artifactCache')}: {catalog.registryArtifactStore?.id ?? t('sourceOnly')}
    </p>

    <article style={styles.card}>
      <h3 style={styles.h3}>{t('registryAuthority')}</h3>
      <div style={styles.tags}>
        {catalog.registrySourceProviders.map(kind => <span key={kind} style={styles.tag}>{kind}</span>)}
        {catalog.registryLifecycleAdapters.map(adapter => <span key={adapter.id} style={styles.tag}>
          {adapter.id} 路 priority {adapter.priority}
        </span>)}
      </div>
      {catalog.registrySecurityPolicies.length === 0
        ? <p style={styles.warning}>{t('noRegistryPolicy')}</p>
        : catalog.registrySecurityPolicies.map(policy => <div key={policy.id} style={styles.capability}>
          <code>{policy.id}</code>
          <small>{policy.appliesTo.join(', ')} 路 SHA-256 {String(policy.requirePayloadIntegrity)} 路 signature {String(policy.requireSignature)} 路 SBOM {String(policy.requireSbom)}</small>
        </div>)}
    </article>

    <h3 style={styles.h3}>{t('installedPackages')}</h3>
    {catalog.registryInstallations.length === 0 ? <p style={styles.muted}>{t('noInstalledPackages')}</p> : null}
    {catalog.registryInstallations.map(installation => <article key={installation.rootId} style={styles.card}>
      <div style={styles.cardTitle}>
        <div>
          <strong>{installation.rootId}@{installation.rootVersion}</strong>
          <p style={styles.muted}>{installation.sourceKind}: {installation.sourceLocator}{installation.sourceRef === undefined ? '' : `#${installation.sourceRef}`}</p>
        </div>
        <button
          style={styles.danger}
          type="button"
          disabled={busy}
          onClick={() => {
            if (globalThis.confirm(`${t('confirmUninstall')} ${installation.rootId}?`)) {
              void mutate({ action: 'uninstall', rootId: installation.rootId })
            }
          }}
        >
          {t('uninstall')}
        </button>
      </div>
      <p style={styles.hash}>lock {installation.graphHash}</p>
      {installation.packages.map(pkg => <div key={`${pkg.id}@${pkg.version}`} style={styles.packageRow}>
        <div style={styles.cardTitle}>
          <code>{pkg.id}@{pkg.version}</code>
          <span style={pkg.revoked || pkg.signingKeyRevoked ? styles.error : pkg.evidenceVerified ? styles.good : styles.warning}>
            {pkg.revoked || pkg.signingKeyRevoked
              ? t('revoked')
              : pkg.evidenceVerified ? t('evidenceVerified') : t('evidenceUnverified')}
          </span>
        </div>
        <div style={styles.tags}>
          <span style={styles.tag}>{pkg.trust}</span>
          <span style={pkg.runtimeActive ? styles.good : styles.muted}>
            {pkg.runtimeActive ? `${t('runtimeActive')}: ${pkg.lifecycleAdapterId ?? 'adapter'}` : t('dataOnly')}
          </span>
          {pkg.permissions.map(permission => <span key={permission} style={styles.tag}>{permission}</span>)}
          {pkg.networkDomains.map(domain => <span key={domain} style={styles.tag}>net:{domain}</span>)}
          {pkg.fileRoots.map(root => <span key={root} style={styles.tag}>fs:{root}</span>)}
        </div>
        <p style={styles.hash}>manifest {pkg.manifestHash} 路 owners {pkg.owners.join(', ')}</p>
      </div>)}
    </article>)}
  </div>
}

function Overview({ catalog, t }: { catalog: RpWebCatalog; t: StudioProps['t'] }): ReactNode {
  return <div style={styles.stack}>
    <div style={styles.metrics}>
      <Metric label={t('experiences')} value={catalog.experiences.length} />
      <Metric label={t('components')} value={catalog.components.length} />
      <Metric label={t('capabilityCount')} value={catalog.capabilities.length} />
      <Metric label={t('pipelineCount')} value={catalog.pipelines.length} />
      <Metric label={t('workflowBackends')} value={catalog.workflowBackends.length} />
      <Metric label={t('rulesEngines')} value={catalog.ruleSystems.length} />
      <Metric label={t('mediaProviders')} value={catalog.mediaProviders.length} />
      <Metric label={t('mediaInputAdapters')} value={catalog.mediaInputAdapters.length} />
      <Metric label={t('memoryRetrievers')} value={catalog.memoryRetrievers.length} />
      <Metric label={t('durableStores')} value={catalog.memoryStores.length} />
      <Metric label={t('registryReleases')} value={catalog.registryReleases.length} />
      <Metric label={t('outboxPending')} value={catalog.outbox.pending} />
    </div>
    <h3 style={styles.h3}>{t('defaultExperience')}</h3>
    {catalog.experiences.map(experience => <article key={experience.id} style={styles.card}>
      <div style={styles.cardTitle}>
        <strong>{experienceLabel(experience.id, experience.name, t)}</strong>
        <code>{experience.id}</code>
      </div>
      <div style={styles.tags}>
        {experience.agents.map(agent => <span key={agent.id} style={styles.tag}>{agent.role}</span>)}
        {Object.entries(experience.pipelines).map(([kind, id]) => <span key={kind} style={styles.tag}>
          {kind}: {id}
        </span>)}
      </div>
    </article>)}
    <h3 style={styles.h3}>{t('registryProvenance')}</h3>
    {catalog.registryReleases.length === 0 ? <p style={styles.muted}>{t('noRegistryReleases')}</p> : null}
    {catalog.registryReleases.map(release => <article key={`${release.id}@${release.version}`} style={styles.card}>
      <div style={styles.cardTitle}>
        <strong>{release.id}@{release.version}</strong>
        <span style={styles.kind}>{release.trust}</span>
      </div>
      <div style={styles.tags}>
        <span style={release.evidenceVerified ? styles.good : styles.warning}>
          {release.evidenceVerified ? t('evidenceVerified') : t('evidenceUnverified')}
        </span>
        <span style={release.signed && !release.signingKeyRevoked ? styles.good : styles.muted}>
          {release.signingKeyRevoked ? t('signingKeyRevoked') : release.signed ? t('signed') : t('unsigned')}
        </span>
        <span style={release.sbomSha256 === undefined ? styles.muted : styles.good}>
          SBOM: {release.sbomSha256 === undefined ? t('absent') : t('present')}
        </span>
      </div>
      <p style={styles.hash}>{release.manifestHash}</p>
    </article>)}
    <UiSlotFrames catalog={catalog} placement="studio.overview" t={t} />
  </div>
}

function Metric({ label, value }: { label: string; value: number }): ReactNode {
  return <div style={styles.metric}>
    <strong style={styles.metricValue}>{value}</strong>
    <span style={styles.muted}>{label}</span>
  </div>
}

function Pipelines({ catalog, t }: { catalog: RpWebCatalog; t: StudioProps['t'] }): ReactNode {
  return <div style={styles.stack}>
    <h3 style={styles.h3}>{t('executionProviders')}</h3>
    {catalog.workflowBackends.map(backend => <article key={backend.id} style={styles.card}>
      <div style={styles.cardTitle}>
        <div>
          <strong>{backend.id}</strong>
          <p style={styles.muted}>{backend.kinds.join(' · ')}</p>
        </div>
        <span style={backend.trust === 'L0' ? styles.good : styles.warning}>
          {backend.trust === 'L0' ? t('defaultL0') : t('explicitL1')}
        </span>
      </div>
      <div style={styles.tags}>
        <span style={styles.tag}>{backend.kind}</span>
        <span style={styles.tag}>priority {backend.priority}</span>
      </div>
    </article>)}
    <h3 style={styles.h3}>{t('memoryProviders')}</h3>
    {catalog.memoryStores.length === 0 ? <p style={styles.muted}>{t('noDurableStore')}</p> : null}
    {catalog.memoryStores.map(store => <article key={store.id} style={styles.card}>
      <div style={styles.cardTitle}>
        <strong>{store.title}</strong>
        <code>{store.id}@{store.version}</code>
      </div>
      <p style={styles.muted}>priority {store.priority}</p>
    </article>)}
    {catalog.pipelines.map(pipeline => <article key={pipeline.id} style={styles.card}>
      <div style={styles.cardTitle}>
        <div>
          <strong>{pipeline.id}</strong>
          <p style={styles.muted}>{pipeline.description}</p>
        </div>
        <span style={styles.kind}>{pipeline.kind} · {pipeline.trust}</span>
      </div>
      <div style={styles.tags}>
        {pipeline.permissions.map(permission => <span key={permission} style={styles.tag}>{permission}</span>)}
      </div>
      <p style={styles.hash}>{pipeline.hash}</p>
      <div aria-label={t('stages')} style={styles.graph}>
        {pipeline.levels.map((level, index) => <div key={index} style={styles.level}>
          <span style={styles.levelIndex}>{index + 1}</span>
          {level.map(stage => <span key={stage} style={styles.stage}>{stage}</span>)}
        </div>)}
      </div>
    </article>)}
    <UiSlotFrames catalog={catalog} placement="studio.inspector" t={t} />
  </div>
}

function Capabilities({ catalog, t }: { catalog: RpWebCatalog; t: StudioProps['t'] }): ReactNode {
  const groups = useMemo(() => Map.groupBy(catalog.capabilities, item => item.kind), [catalog])
  return <div style={styles.stack}>
    <article style={styles.card}>
      <div style={styles.cardTitle}>
        <strong>{t('authorizationChain')}</strong>
        <span style={styles.kind}>{catalog.capabilityAuthorizers.length}</span>
      </div>
      <div style={styles.capGrid}>
        {catalog.capabilityAuthorizers.map(authorizer => <div key={authorizer.id} style={styles.capability}>
          <code>{authorizer.id}</code>
          <small>priority {authorizer.priority}</small>
        </div>)}
      </div>
      <h3 style={styles.h3}>{t('policyLayers')}</h3>
      {catalog.policyLayers.length === 0 ? <p style={styles.muted}>{t('noPolicyLayers')}</p> : null}
      <div style={styles.capGrid}>
        {catalog.policyLayers.map(layer => <div key={layer.name} style={styles.capability}>
          <code>{layer.name}</code>
          <small>{layer.maxTrust ?? 'L2'} · {(layer.permissions ?? []).join(', ') || 'no permission ceiling'}</small>
        </div>)}
      </div>
    </article>
    {[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([kind, items]) => <article
      key={kind}
      style={styles.card}
    >
      <div style={styles.cardTitle}>
        <strong>{kind}</strong>
        <span style={styles.kind}>{items.length}</span>
      </div>
      <div style={styles.capGrid}>
        {items.map(item => <div key={item.id} style={styles.capability}>
          <code>{item.id}</code>
          <span style={item.executable ? styles.good : styles.muted}>
            {item.executable ? t('executable') : t('discoveryOnly')}
          </span>
          {item.permissions.length > 0
            ? <small>{t('permissions')}: {item.permissions.join(', ')}</small>
            : null}
        </div>)}
      </div>
    </article>)}
  </div>
}

function Creator({ t, sessionId }: { t: StudioProps['t']; sessionId: SessionId | undefined }): ReactNode {
  const [kind, setKind] = useState<RpWebImportKind>('character-card-json')
  const [source, setSource] = useState('')
  const [sourceId, setSourceId] = useState('rp-studio')
  const [base64, setBase64] = useState<string>()
  const [result, setResult] = useState<RpWebImportResponse>()
  const [presets, setPresets] = useState<RpWebPresetCatalogResponse>()
  const [library, setLibrary] = useState<RpWebLibraryCatalogResponse>()
  const [savedPresetId, setSavedPresetId] = useState<string>()
  const [presetBusy, setPresetBusy] = useState(false)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [error, setError] = useState<string>()
  const binary = kind === 'character-card-png' || kind === 'character-card-charx'
  const preset = kind === 'preset'
  const libraryImport = kind !== 'preset' && kind !== 'chat'

  const loadPresets = useCallback(async (): Promise<void> => {
    const query = sessionId === undefined ? '' : `?sessionId=${encodeURIComponent(sessionId)}`
    const response = await fetch(`${API}/presets${query}`, { headers: { accept: 'application/json' } })
    const value = await response.json() as RpWebPresetCatalogResponse & { error?: string }
    if (!response.ok) throw new Error(value.error ?? `presets ${response.status}`)
    setPresets(value)
  }, [sessionId])

  const loadLibrary = useCallback(async (): Promise<void> => {
    const query = sessionId === undefined ? '' : `?sessionId=${encodeURIComponent(sessionId)}`
    const response = await fetch(`${API}/library${query}`, { headers: { accept: 'application/json' } })
    const value = await response.json() as RpWebLibraryCatalogResponse & { error?: string }
    if (!response.ok) throw new Error(value.error ?? `library ${response.status}`)
    setLibrary(value)
  }, [sessionId])

  useEffect(() => {
    void Promise.all([loadPresets(), loadLibrary()]).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [loadLibrary, loadPresets])

  const submit = async (): Promise<void> => {
    setError(undefined)
    setResult(undefined)
    const body: RpWebImportRequest = binary
      ? { kind, base64: base64 ?? '', sourceId }
      : { kind, source, sourceId }
    try {
      const response = await fetch(`${API}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      })
      const value = await response.json() as RpWebImportResponse & { error?: string }
      if (!response.ok) throw new Error(value.error ?? `import ${response.status}`)
      setResult(value)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const mutatePreset = async (request: RpWebPresetMutationRequest): Promise<RpWebPresetMutationResponse> => {
    setPresetBusy(true)
    setError(undefined)
    try {
      const response = await fetch(`${API}/presets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(request),
      })
      const value = await response.json() as RpWebPresetMutationResponse & { error?: string }
      if (!response.ok) throw new Error(value.error ?? `preset ${response.status}`)
      setPresets(value)
      if (value.presetId !== undefined) setSavedPresetId(value.presetId)
      return value
    } finally {
      setPresetBusy(false)
    }
  }

  const savePreset = async (): Promise<void> => {
    try {
      await mutatePreset({ action: 'save', source, sourceId })
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const activatePreset = async (): Promise<void> => {
    if (sessionId === undefined || savedPresetId === undefined) return
    try {
      await mutatePreset({ action: 'activate', sessionId, presetId: savedPresetId })
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const mutateLibrary = async (request: RpWebLibraryMutationRequest): Promise<RpWebLibraryMutationResponse> => {
    setLibraryBusy(true)
    setError(undefined)
    try {
      const response = await fetch(`${API}/library`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(request),
      })
      const value = await response.json() as RpWebLibraryMutationResponse & { error?: string }
      if (!response.ok) throw new Error(value.error ?? `library ${response.status}`)
      setLibrary(value)
      return value
    } finally {
      setLibraryBusy(false)
    }
  }

  const saveLibraryAsset = async (): Promise<void> => {
    if (!libraryImport) return
    try {
      await mutateLibrary({
        action: 'save',
        kind,
        ...(binary ? { base64: base64 ?? '' } : { source }),
        sourceId,
      })
      await loadLibrary()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const mutateLibraryAsset = async (
    action: 'activate' | 'deactivate' | 'remove',
    assetKind: 'character' | 'persona' | 'lore',
    assetId: string,
  ): Promise<void> => {
    try {
      if (action === 'remove') {
        await mutateLibrary({ action, assetKind, assetId })
      } else {
        if (sessionId === undefined) return
        await mutateLibrary({ action, assetKind, assetId, sessionId })
      }
      if (action === 'remove') await loadLibrary()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const libraryItems = [
    ...library?.characters.map(item => ({
      kind: 'character' as const, id: item.id, name: item.name, detail: item.description ?? '',
      active: library.active?.characterIds.includes(item.id) === true,
    })) ?? [],
    ...library?.personas.map(item => ({
      kind: 'persona' as const, id: item.id, name: item.name, detail: item.description,
      active: library.active?.personaIds.includes(item.id) === true,
    })) ?? [],
    ...library?.lorebooks.map(item => ({
      kind: 'lore' as const, id: item.id, name: item.name, detail: `${item.entryCount} ${t('entries')}`,
      active: library.active?.lorebookIds.includes(item.id) === true,
    })) ?? [],
  ]

  return <div style={styles.creator}>
    <div style={styles.form}>
      <label style={styles.label}>
        {t('format')}
        <select
          style={styles.input}
          value={kind}
          onChange={(event) => {
            setKind(event.currentTarget.value as RpWebImportKind)
            setBase64(undefined)
            setResult(undefined)
            setSavedPresetId(undefined)
          }}
        >
          <option value="character-card-json">Character Card JSON</option>
          <option value="character-card-png">Character Card PNG</option>
          <option value="character-card-charx">Character Card CHARX</option>
          <option value="persona">SillyTavern Persona</option>
          <option value="world-info">World Info / Lorebook</option>
          <option value="preset">SillyTavern Preset</option>
          <option value="chat">SillyTavern Chat JSONL</option>
        </select>
      </label>
      {binary
        ? <label style={styles.file}>
          {t('chooseFile')}
          <input
            type="file"
            accept={kind === 'character-card-png' ? '.png,image/png' : '.charx,application/zip'}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file !== undefined) {
                setSourceId(file.name)
                void fileToBase64(file).then(setBase64)
              }
            }}
          />
          <span>
            {base64 === undefined
              ? '—'
              : `${t('binaryReady')} · ${Math.floor(base64.length * 0.75).toLocaleString()} B`}
          </span>
        </label>
        : <>
          <label style={styles.file}>
            {t('chooseFile')}
            <input
              type="file"
              accept={kind === 'chat' ? '.jsonl,.txt,application/x-ndjson,text/plain' : '.json,application/json'}
              data-rp-preset-file={preset || undefined}
              data-rp-library-file={libraryImport || undefined}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file !== undefined) {
                  setSourceId(file.name)
                  void file.text().then(setSource).catch((reason: unknown) => {
                    setError(reason instanceof Error ? reason.message : String(reason))
                  })
                }
              }}
            />
            <span>{sourceId === 'rp-studio' ? '—' : sourceId}</span>
          </label>
          <label style={styles.label}>
            {t('source')}
            <textarea
              style={styles.textarea}
              value={source}
              placeholder={t('sourcePlaceholder')}
              onChange={(event) => {
                setSource(event.currentTarget.value)
              }}
            />
          </label>
        </>}
      <button
        style={styles.primary}
        disabled={binary ? base64 === undefined : source.length === 0}
        type="button"
        onClick={() => {
          void submit()
        }}
        data-rp-import-preview
      >
        {t('importPreview')}
      </button>
      {preset && result !== undefined ? <button
        style={styles.button}
        disabled={presetBusy}
        type="button"
        data-rp-preset-save
        onClick={() => { void savePreset() }}
      >
        {t('savePreset')}
      </button> : null}
      {libraryImport && result !== undefined ? <button
        style={styles.button}
        disabled={libraryBusy}
        type="button"
        data-rp-library-save
        onClick={() => { void saveLibraryAsset() }}
      >
        {t('saveAsset')}
      </button> : null}
      {preset && savedPresetId !== undefined ? <button
        style={styles.primary}
        disabled={presetBusy || sessionId === undefined}
        type="button"
        data-rp-preset-activate
        onClick={() => { void activatePreset() }}
      >
        {t('activatePreset')}
      </button> : null}
      {preset ? <div style={styles.lossSummary} data-rp-preset-status>
        <strong>{t('presetBinding')}</strong>
        <span>{sessionId === undefined ? t('noCurrentSession') : `Session ${sessionId}`}</span>
        <span>{presets?.active === undefined
          ? t('noActivePreset')
          : `${t('activePreset')}: ${presets.active.presetId}`}</span>
        {presets?.active === undefined ? null : <code>{presets.active.snapshotHash}</code>}
      </div> : null}
      {libraryImport ? <div style={styles.lossSummary} data-rp-library-status>
        <strong>{t('assetLibrary')}</strong>
        <span>{sessionId === undefined ? t('noCurrentSession') : `Session ${sessionId}`}</span>
        <span>{library?.active === undefined ? t('noActiveAssets') : t('activeAssets')}</span>
        {library?.active === undefined ? null : <code>{library.active.snapshotHash}</code>}
      </div> : null}
      {error === undefined ? null : <p role="alert" style={styles.error}>{error}</p>}
    </div>
    <div>
      <h3 style={styles.h3}>{t('preview')}</h3>
      {result === undefined ? null : <div style={styles.lossSummary}>
        <strong>{t('compatibilityReport')}</strong>
        <span>{result.lossReports.every(item => item.report.losslessData)
          ? t('sourceDataPreserved')
          : t('sourceDataLoss')}</span>
        <span>{result.lossReports.reduce((sum, item) => sum + item.report.items.length, 0)} {t('compatibilityChanges')}</span>
      </div>}
      <pre style={styles.preview}>
        {result === undefined ? t('emptyPreview') : JSON.stringify(result, null, 2)}
      </pre>
      {preset && presets !== undefined ? <div style={styles.stack} data-rp-saved-presets>
        {presets.presets.map(item => <div key={item.id} style={styles.card}>
          <strong>{item.name}</strong>
          <code>{item.id}</code>
          <small>{item.promptDefinitionCount} prompts · {item.promptOrderCount} orders · selected {item.selectedPromptOrderId}</small>
          <small>{item.enabledPromptIds.join(' → ')}</small>
        </div>)}
      </div> : null}
      {libraryImport ? <div style={styles.stack} data-rp-asset-library>
        <h3 style={styles.h3}>{t('assetLibrary')}</h3>
        {libraryItems.length === 0 ? <p style={styles.muted}>{t('emptyLibrary')}</p> : null}
        {libraryItems.map(item => <div key={`${item.kind}:${item.id}`} style={styles.card} data-rp-library-asset={item.id}>
          <div style={styles.cardTitle}>
            <strong>{item.name}</strong>
            <span style={item.active ? styles.good : styles.kind}>{item.kind}</span>
          </div>
          <code>{item.id}</code>
          {item.detail === '' ? null : <small>{item.detail}</small>}
          <div style={styles.actions}>
            <button
              style={item.active ? styles.button : styles.primary}
              disabled={libraryBusy || sessionId === undefined}
              type="button"
              data-rp-library-toggle={item.kind}
              onClick={() => { void mutateLibraryAsset(item.active ? 'deactivate' : 'activate', item.kind, item.id) }}
            >
              {item.active ? t('deactivateAsset') : t('activateAsset')}
            </button>
            <button
              style={styles.danger}
              disabled={libraryBusy}
              type="button"
              data-rp-library-remove={item.kind}
              onClick={() => { void mutateLibraryAsset('remove', item.kind, item.id) }}
            >
              {t('removeAsset')}
            </button>
          </div>
        </div>)}
      </div> : null}
    </div>
  </div>
}

function Timeline({ t, latest }: { t: StudioProps['t']; latest: RpWebLatestTurnState }): ReactNode {
  const [sessionId, setSessionId] = useState(latest.sessionId ?? '')
  const [result, setResult] = useState<RpWebTimelineResponse>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (sessionId === '' && latest.sessionId !== undefined) setSessionId(latest.sessionId)
    if (latest.state?.timeline !== undefined && latest.sessionId === (sessionId || latest.sessionId)) {
      setResult(latest.state.timeline)
    }
  }, [latest, sessionId])
  const inspect = async (): Promise<void> => {
    setError(undefined)
    try {
      const response = await fetch(`${API}/timeline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const value = await response.json() as RpWebTimelineResponse & { error?: string }
      if (!response.ok) throw new Error(value.error ?? `timeline ${response.status}`)
      setResult(value)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  return <div style={styles.creator}>
    <div style={styles.form}>
      {latest.state?.response === undefined ? null : <div style={styles.card} data-rp-studio-latest-turn>
        <strong>{t('lastTurn')}</strong>
        <p style={styles.muted}>{latest.state.response.turnId} · {latest.state.response.experienceId}</p>
        <p style={styles.muted}>Session {latest.sessionId} · event #{latest.state.response.eventSeq}</p>
      </div>}
      <label style={styles.label}>
        {t('sessionId')}
        <input
          style={styles.input}
          value={sessionId}
          placeholder={t('timelinePlaceholder')}
          onChange={(event) => {
            setSessionId(event.currentTarget.value)
          }}
        />
      </label>
      <button
        style={styles.primary}
        disabled={sessionId.trim() === ''}
        type="button"
        onClick={() => {
          void inspect()
        }}
      >
        {t('inspectTimeline')}
      </button>
      {error === undefined ? null : <p role="alert" style={styles.error}>{error}</p>}
    </div>
    <div>
      <h3 style={styles.h3}>{t('timeline')}</h3>
      <pre style={styles.preview}>
        {result === undefined ? t('timelinePlaceholder') : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  </div>
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

const styles: Record<string, CSSProperties> = {
  shell: { padding: '8px 4px 32px', color: 'var(--dsw-alias-label-primary,#e8edf6)' },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 18 },
  h2: { fontSize: 24, margin: '0 0 5px' },
  h3: { fontSize: 15, margin: '18px 0 10px' },
  muted: { color: 'var(--dsw-alias-label-tertiary,#9099ab)', margin: '4px 0', fontSize: 12 },
  button: {
    border: '1px solid rgba(130,145,180,.28)',
    background: 'rgba(255,255,255,.04)',
    color: 'inherit',
    padding: '8px 12px',
    borderRadius: 9,
    cursor: 'pointer',
  },
  nav: {
    display: 'flex',
    gap: 5,
    padding: 4,
    borderRadius: 12,
    background: 'rgba(100,115,150,.09)',
    marginBottom: 18,
    overflowX: 'auto',
  },
  navButton: {
    border: 0,
    background: 'transparent',
    color: 'var(--dsw-alias-label-secondary,#b8c0d0)',
    padding: '9px 13px',
    borderRadius: 9,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  navActive: { background: 'rgba(111,120,232,.22)', color: '#dfe2ff' },
  status: { padding: 32, textAlign: 'center' },
  stack: { display: 'grid', gap: 10 },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 },
  metric: {
    display: 'flex',
    flexDirection: 'column',
    padding: 16,
    border: '1px solid rgba(130,145,180,.15)',
    borderRadius: 12,
    background: 'rgba(255,255,255,.025)',
  },
  metricValue: { fontSize: 27 },
  card: {
    border: '1px solid rgba(130,145,180,.15)',
    borderRadius: 12,
    padding: 14,
    background: 'rgba(255,255,255,.025)',
  },
  cardTitle: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  tag: {
    fontSize: 11,
    padding: '4px 7px',
    borderRadius: 999,
    background: 'rgba(111,120,232,.13)',
    color: '#bcc2ff',
  },
  kind: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: '#9fa8ff' },
  hash: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#747e91',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  graph: { display: 'grid', gap: 7 },
  level: { display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' },
  levelIndex: {
    width: 22,
    height: 22,
    borderRadius: 999,
    display: 'grid',
    placeItems: 'center',
    fontSize: 10,
    background: 'rgba(111,120,232,.25)',
  },
  stage: { padding: '6px 9px', border: '1px solid rgba(130,145,180,.18)', borderRadius: 7, fontSize: 11 },
  capGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))',
    gap: 8,
    marginTop: 10,
  },
  capability: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 10,
    borderRadius: 8,
    background: 'rgba(0,0,0,.12)',
    fontSize: 11,
  },
  good: { color: '#79d6a5' },
  warning: { color: '#f0bc71' },
  creator: { display: 'grid', gridTemplateColumns: 'minmax(260px,1fr) minmax(300px,1fr)', gap: 16 },
  lossSummary: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 },
  form: { display: 'grid', gap: 12, alignContent: 'start' },
  label: { display: 'grid', gap: 6, fontSize: 12 },
  input: {
    width: '100%',
    padding: 9,
    borderRadius: 8,
    border: '1px solid rgba(130,145,180,.25)',
    background: '#171a22',
    color: 'inherit',
  },
  textarea: {
    minHeight: 320,
    resize: 'vertical',
    padding: 11,
    borderRadius: 9,
    border: '1px solid rgba(130,145,180,.25)',
    background: '#11131a',
    color: 'inherit',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  file: {
    display: 'grid',
    gap: 12,
    padding: 24,
    border: '1px dashed rgba(130,145,180,.4)',
    borderRadius: 10,
    fontSize: 12,
  },
  primary: {
    border: 0,
    borderRadius: 9,
    padding: '10px 14px',
    background: '#6f78e8',
    color: 'white',
    cursor: 'pointer',
  },
  danger: {
    border: '1px solid rgba(255,105,120,.35)',
    borderRadius: 9,
    padding: '8px 12px',
    background: 'rgba(255,82,105,.1)',
    color: '#ff9aa8',
    cursor: 'pointer',
  },
  packageRow: {
    marginTop: 10,
    padding: 10,
    borderRadius: 9,
    background: 'rgba(0,0,0,.13)',
    border: '1px solid rgba(130,145,180,.1)',
  },
  preview: {
    minHeight: 420,
    maxHeight: 620,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    padding: 14,
    borderRadius: 10,
    background: '#101219',
    border: '1px solid rgba(130,145,180,.15)',
    fontSize: 11,
  },
  error: { color: '#ff9292', fontSize: 12 },
}
