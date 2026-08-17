/**
 * REAL-composition coverage: a test-only cordis.yml mounts the published RP
 * packages through Loader, while only the model/provider boundary is scripted.
 * Assertions observe the HTTP response and the external JSONL durability file.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import RpAgentRuntime from '@dsh-rp/agent-runtime'
import RpBranchRuntime from '@dsh-rp/branches'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import RpCharacterRuntime from '@dsh-rp/character'
import RpComponentRegistry from '@dsh-rp/component-runtime'
import RpExperienceRegistry from '@dsh-rp/experience-registry'
import * as FirstParty from '@dsh-rp/first-party'
import RpJournal from '@dsh-rp/journal'
import RpLoreRuntime from '@dsh-rp/lore'
import RpMediaRuntime from '@dsh-rp/media'
import RpMemoryBasic from '@dsh-rp/memory-basic'
import RpOutbox from '@dsh-rp/outbox'
import RpPersonaRuntime from '@dsh-rp/persona'
import RpPipelineRuntime from '@dsh-rp/pipeline-runtime'
import RpPolicyRuntime from '@dsh-rp/policy'
import RpProjectionService from '@dsh-rp/projection'
import RpPromptRuntime from '@dsh-rp/prompt'
import RpRegistry from '@dsh-rp/registry'
import RpRelationshipRuntime from '@dsh-rp/relationship'
import RpRulesRuntime from '@dsh-rp/rules'
import RpSceneRuntime from '@dsh-rp/scene'
import RpStateRuntime from '@dsh-rp/state'
import RpTurnRuntime from '@dsh-rp/turn-runtime'
import RpUiSlotRegistry from '@dsh-rp/ui-slot-runtime'
import * as RpWeb from '../src/index.ts'
import RpWorkflowRouter from '@dsh-rp/workflow-router'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const FixtureAgent = {
  name: 'rp-turn-api-fixture-agent',
  inject: ['sessions', 'agents', 'rpAgents'],
  apply(ctx: Context): void {
    ctx.rpAgents.registerProvider({
      id: 'loader-scripted-provider',
      supports: () => true,
      run: async () => ({ value: { assistantMessage: 'Loader-composed RP reply' } }),
    })
    const session = ctx.sessions.create(SessionId('loader-rp-session'))
    let maintenance = false
    const agent: Agent = {
      id: session.id,
      options: {},
      session,
      inbox: new Inbox(session, { inserted() {}, discarded() {}, claimed() {} }),
      status: 'idle',
      ctx,
      send() {},
      followup() {},
      steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
      inject() {},
      cancel() {},
      runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
        if (maintenance) throw new Error('fixture agent already has active work')
        maintenance = true
        return task(new AbortController().signal).finally(() => { maintenance = false })
      },
      whenIdle: async () => {},
    }
    ctx.agents.register(agent)
  },
}

async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-rp-turn-loader-'))
  const configPath = join(root, 'cordis.yml')
  const persistenceRoot = join(root, 'sessions')
  const packageNames = [
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-host-webserver',
    '@dsh-rp/component-runtime',
    '@dsh-rp/capability-catalog',
    '@dsh-rp/policy',
    '@dsh-rp/agent-runtime',
    '@dsh-rp/pipeline-runtime',
    '@dsh-rp/experience-registry',
    '@dsh-rp/state',
    '@dsh-rp/memory-basic',
    '@dsh-rp/character',
    '@dsh-rp/persona',
    '@dsh-rp/lore',
    '@dsh-rp/prompt',
    '@dsh-rp/branches',
    '@dsh-rp/registry',
    '@dsh-rp/workflow-router',
    '@dsh-rp/outbox',
    '@dsh-rp/scene',
    '@dsh-rp/relationship',
    '@dsh-rp/rules',
    '@dsh-rp/media',
    '@dsh-rp/journal',
    '@dsh-rp/projection',
    '@dsh-rp/turn-runtime',
    '@dsh-rp/ui-slot-runtime',
  ]
  await writeFile(configPath, [
    ...packageNames.flatMap(name => name === '@deepseek-ai/dsh-host-webserver'
      ? [`- name: '${name}'`, '  config:', "    host: '127.0.0.1'", '    port: 0']
      : [`- name: '${name}'`]),
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    `    root: ${JSON.stringify(persistenceRoot)}`,
    "    compression: 'none'",
    "- name: 'fixture:agent'",
    "- name: '@dsh-rp/first-party'",
    "- name: '@dsh-rp/web'",
    '  config:',
    '    turnApi:',
    "      bearerToken: 'loader-deployment-secret'",
    "      defaultExperience: 'rp-fast'",
    '      allowedExperiences:',
    "        - 'rp-fast'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@dsh-rp/component-runtime', RpComponentRegistry],
    ['@dsh-rp/capability-catalog', RpCapabilityCatalog],
    ['@dsh-rp/policy', RpPolicyRuntime],
    ['@dsh-rp/agent-runtime', RpAgentRuntime],
    ['@dsh-rp/pipeline-runtime', RpPipelineRuntime],
    ['@dsh-rp/experience-registry', RpExperienceRegistry],
    ['@dsh-rp/state', RpStateRuntime],
    ['@dsh-rp/memory-basic', RpMemoryBasic],
    ['@dsh-rp/character', RpCharacterRuntime],
    ['@dsh-rp/persona', RpPersonaRuntime],
    ['@dsh-rp/lore', RpLoreRuntime],
    ['@dsh-rp/prompt', RpPromptRuntime],
    ['@dsh-rp/branches', RpBranchRuntime],
    ['@dsh-rp/registry', RpRegistry],
    ['@dsh-rp/workflow-router', RpWorkflowRouter],
    ['@dsh-rp/outbox', RpOutbox],
    ['@dsh-rp/scene', RpSceneRuntime],
    ['@dsh-rp/relationship', RpRelationshipRuntime],
    ['@dsh-rp/rules', RpRulesRuntime],
    ['@dsh-rp/media', RpMediaRuntime],
    ['@dsh-rp/journal', RpJournal],
    ['@dsh-rp/projection', RpProjectionService],
    ['@dsh-rp/turn-runtime', RpTurnRuntime],
    ['@dsh-rp/ui-slot-runtime', RpUiSlotRegistry],
    ['fixture:agent', FixtureAgent],
    ['@dsh-rp/first-party', FirstParty],
    ['@dsh-rp/web', RpWeb],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('RP Turn API through real Loader composition', () => {
  it('boots cordis.yml, returns the Headless contract, and persists the committed event', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const response = await fetch(`http://127.0.0.1:${String(loaded.httpServer.port)}/api/rp/v1/turn`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer loader-deployment-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        schemaVersion: 1,
        requestId: 'loader-request',
        sessionId: 'loader-rp-session',
        agentId: 'loader-rp-session',
        experienceId: 'rp-fast',
        input: { text: 'Enter the lighthouse' },
      }),
    })
    const body = await response.json() as Record<string, unknown>
    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      schemaVersion: 1,
      requestId: 'loader-request',
      replayed: false,
      assistantMessage: 'Loader-composed RP reply',
      authority: { trust: 'L2', permissions: ['agent:spawn', 'rp.pipeline.execute'] },
      projection: { history: [{ assistantMessage: 'Loader-composed RP reply' }] },
    })

    const files = await readdir(join(root as string, 'sessions'), { recursive: true })
    const log = files.find(file => file.endsWith('.jsonl'))
    expect(log).toBeDefined()
    const persisted = await readFile(join(root as string, 'sessions', log as string), 'utf8')
    expect(persisted).toContain('"rp/turn-committed"')
    expect({
      status: response.status,
      requestId: body.requestId,
      replayed: body.replayed,
      assistantMessage: body.assistantMessage,
      durableCommit: persisted.includes('"rp/turn-committed"'),
    }).toMatchInlineSnapshot(`
      {
        "assistantMessage": "Loader-composed RP reply",
        "durableCommit": true,
        "replayed": false,
        "requestId": "loader-request",
        "status": 200,
      }
    `)
  })
})
