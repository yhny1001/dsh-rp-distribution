/** First-party RP composition without privileged runtime behavior. @module @dsh-rp/first-party */

import type { Context } from '@deepseek-ai/cordis'
import '@dsh-rp/experience-registry'
import {
  RpCapabilityId,
  RpComponentId,
  RpMediaProviderId,
  RpPackageId,
  RpPipelineId,
  RpRuleSystemId,
} from '@dsh-rp/contracts'
import type {
  JsonObject,
  JsonValue,
  MediaArtifact,
  MemoryEvent,
  PromptSectionIR,
  RpAgentProfile,
  RpExperienceManifest,
} from '@dsh-rp/contracts'
import type { RpComponentDefinition } from '@dsh-rp/component-runtime'
import type { RpCapabilityContribution } from '@dsh-rp/capability-catalog'
import type { RpAgentRoleDefinition } from '@dsh-rp/agent-runtime'
import type {} from '@dsh-rp/agent-runtime'
import type {
  RpPipelineDefinition,
  RpPipelineStageContext,
  RpPipelineStageDefinition,
  RpPipelineStageOutput,
} from '@dsh-rp/pipeline-runtime'
import type {} from '@dsh-rp/state'
import type {} from '@dsh-rp/memory-basic'
import { projectCharacterContext } from '@dsh-rp/character'
import { projectPersonaContext } from '@dsh-rp/persona'
import { matchLoreBooks } from '@dsh-rp/lore'
import type {} from '@dsh-rp/prompt'
import type { RpPresetSnapshot } from '@dsh-rp/preset'
import type { RpLibrarySnapshot } from '@dsh-rp/library'
import type {} from '@dsh-rp/branches'
import type {} from '@dsh-rp/registry'
import type {} from '@dsh-rp/outbox'
import type {} from '@dsh-rp/scene'
import type {} from '@dsh-rp/relationship'
import type {} from '@dsh-rp/rules'
import type {} from '@dsh-rp/media'
import type { RpWorkflowKind } from '@dsh-rp/workflow-router'
import type {} from '@dsh-rp/workflow-router'

/** Cordis plugin name. */
export const name = 'rp-first-party'
/** RP registries required by the bundle contribution. */
export const inject = [
  'rpComponents', 'rpCapabilities', 'rpAgents', 'rpPipelines', 'rpExperiences',
  'rpState', 'rpMemory', 'rpCharacters', 'rpPersonas', 'rpLore', 'rpPrompt', 'rpBranches',
  'rpRegistry', 'rpWorkflowRouter', 'rpOutbox',
  'rpScene', 'rpRelationships', 'rpRules', 'rpMedia',
]

const PACKAGE = RpPackageId('dsh-rp.first-party')
const TURN_FAST = RpPipelineId('rp.turn.fast')
const TURN_ADAPTIVE = RpPipelineId('rp.turn.adaptive')
const WORKFLOW_DIRECTED = RpPipelineId('rp.workflow.directed')
const WORKFLOW_MULTI = RpPipelineId('rp.workflow.multi-character')
const WORKFLOW_WORLD = RpPipelineId('rp.workflow.world-sim')
const WORKFLOW_TRPG = RpPipelineId('rp.workflow.trpg')
const WORKFLOW_CREATOR = RpPipelineId('rp.workflow.creator')
const SIDECAR_MEMORY = RpPipelineId('rp.sidecar.memory-world')

/** Mount all first-party registrations in one reversible effect. @param ctx - RP-capable Cordis context. */
export function apply(ctx: Context): void {
  ctx.effect(function* () {
    for (const component of components()) yield ctx.rpComponents.register(component)
    for (const capability of domainCapabilities(ctx)) yield ctx.rpCapabilities.register(capability)
    for (const role of roleDefinitions()) yield ctx.rpAgents.registerRole(role)
    for (const pipeline of pipelines(ctx)) yield ctx.rpPipelines.register(pipeline)
    for (const experience of experiences()) yield ctx.rpExperiences.register(experience)
  }, 'rp-first-party registrations')
}

/** First-party metadata components; behavior remains in independently replaceable capability plugins. */
function components(): readonly RpComponentDefinition[] {
  const definition = (
    id: string,
    trust: RpComponentDefinition['trust'],
    dependencies: readonly string[] = [],
  ): RpComponentDefinition => ({
    id: RpComponentId(id),
    packageId: PACKAGE,
    version: '1.0.0',
    trust,
    scopes: ['experience', 'profile', 'conversation', 'scene', 'turn', 'agent'],
    dependencies: dependencies.map(dependency => ({ id: RpComponentId(dependency), version: '1.0.0' })),
    provides: [`component:${id}`],
  })
  return [
    definition('rp.character', 'L0'),
    definition('rp.persona', 'L0'),
    definition('rp.prompt', 'L0', ['rp.character', 'rp.persona']),
    definition('rp.lore', 'L0'),
    definition('rp.memory', 'L1'),
    definition('rp.state', 'L0'),
    definition('rp.scene', 'L0', ['rp.state']),
    definition('rp.relationship', 'L0', ['rp.state']),
    definition('rp.branches', 'L0'),
    definition('rp.actor', 'L2', ['rp.prompt', 'rp.lore']),
    definition('rp.director', 'L2', ['rp.actor']),
    definition('rp.critic', 'L2', ['rp.actor']),
    definition('rp.world', 'L2', ['rp.state', 'rp.lore']),
    definition('rp.rules', 'L1', ['rp.state']),
    definition('rp.media', 'L1'),
    definition('rp.creator', 'L2', ['rp.character', 'rp.lore', 'rp.prompt']),
  ]
}

/** Provider-neutral role templates; `ctx.rpAgents` owns discovery and execution routing. */
function roleDefinitions(): readonly RpAgentRoleDefinition[] {
  const roles = [
    ['actor', 'Perform the active character or shared cast while preserving voice, intent, and scene continuity.'],
    ['director', 'Plan dramatic intent, pacing, focus, and delegation without writing over the Actor result.'],
    ['narrator', 'Run the world and describe consequences with clear spatial and causal continuity.'],
    ['character', 'Perform one assigned character from that character\'s knowledge and goals.'],
    ['group-scheduler', 'Choose which characters act, which may run in parallel, and how their outputs join.'],
    ['continuity-critic', 'Find contradictions in character, lore, scene, relationship, and prior committed facts.'],
    ['state-keeper', 'Propose explicit state changes and reject ambiguous or conflicting patches.'],
    ['memory-curator', 'Select durable facts, remove duplication, and preserve provenance and ownership.'],
    ['lore-researcher', 'Retrieve only relevant lore and distinguish canonical facts from inference.'],
    ['world-simulator', 'Advance off-screen actors, factions, and environment under committed world state.'],
    ['rules', 'Apply the selected rules system deterministically and report inputs, rolls, and outcomes.'],
    ['creator', 'Create compatible role-play assets with explicit schemas and loss-aware source provenance.'],
    ['reviewer', 'Review generated assets or prose against the requested contract and return actionable defects.'],
    ['safety-style', 'Check policy and style constraints while preserving allowed creative intent.'],
  ] as const
  return roles.map(([role, instructions]) => ({
    id: role,
    capabilityId: RpCapabilityId(`rp.agent.${role}`),
    version: '1.0.0',
    title: role,
    description: `First-party ${role} role contract executed by a replaceable RP Agent Provider.`,
    instructions,
    trust: 'L2',
    scopes: ['conversation', 'scene', 'turn', 'agent'],
    permissions: ['agent:spawn'],
    budget: { maxAgents: 1, timeoutMs: 60_000 },
    capabilityKinds: roleCapabilityKinds(role),
    tags: ['first-party'],
  }))
}

function roleCapabilityKinds(role: string): readonly string[] {
  if (role === 'director' || role === 'group-scheduler' || role === 'world-simulator') {
    return ['tool', 'skill', 'subagent', 'pipeline']
  }
  if (role === 'rules' || role === 'state-keeper') return ['tool', 'rules']
  if (role === 'memory-curator') return ['memory', 'tool']
  if (role === 'lore-researcher') return ['lore', 'tool', 'skill']
  return ['tool', 'skill']
}

/** Executable domain capabilities backed by independently replaceable service plugins. */
function domainCapabilities(ctx: Context): readonly RpCapabilityContribution[] {
  const definition = (
    id: string,
    kind: RpCapabilityContribution['descriptor']['kind'],
    description: string,
    invoke: NonNullable<RpCapabilityContribution['invoke']>,
    permissions: readonly string[] = [],
  ): RpCapabilityContribution => ({
    descriptor: {
      id: RpCapabilityId(id), kind, version: '1.0.0', title: id, description, trust: 'L0',
      scopes: ['conversation', 'scene', 'turn', 'agent'], tags: ['rp', 'first-party', 'domain'],
      ...(permissions.length === 0 ? {} : { permissions }),
    },
    invoke,
  })
  return [
    definition('rp.character.context', 'tool', 'Read bounded model-safe character context without extensions or compatibility fields.', (request) => {
      const input = inputObject(request.input, 'rp.character.context')
      return Promise.resolve(ctx.rpCharacters.context(request.scope, {
        ...(input.maxEntries === undefined ? {} : { maxEntries: requiredInputNumber(input, 'maxEntries') }),
        ...(input.maxCharacters === undefined ? {} : { maxCharacters: requiredInputNumber(input, 'maxCharacters') }),
      }) as unknown as JsonValue)
    }),
    definition('rp.persona.context', 'tool', 'Read bounded model-safe persona context without extensions or compatibility fields.', (request) => {
      const input = inputObject(request.input, 'rp.persona.context')
      return Promise.resolve(ctx.rpPersonas.context(request.scope, {
        ...(input.maxEntries === undefined ? {} : { maxEntries: requiredInputNumber(input, 'maxEntries') }),
        ...(input.maxCharacters === undefined ? {} : { maxCharacters: requiredInputNumber(input, 'maxCharacters') }),
      }) as unknown as JsonValue)
    }),
    definition('rp.state.read', 'tool', 'Read one owner-isolated state document.', (request) => {
      const input = inputObject(request.input, 'rp.state.read')
      return Promise.resolve((ctx.rpState.read(request.scope, requiredInputString(input, 'owner')) ?? null) as JsonValue)
    }),
    definition('rp.memory.search', 'memory', 'Retrieve bounded deterministic memories.', async (request) => {
      const input = inputObject(request.input, 'rp.memory.search')
      if (ctx.rpMemory.listStores().length > 0) await ctx.rpMemory.hydrate(request.scope)
      return ctx.rpMemory.search(request.scope, {
        text: requiredInputString(input, 'text'),
        ...(typeof input.owner === 'string' ? { owner: input.owner } : {}),
        ...(typeof input.retriever === 'string' ? { retriever: input.retriever } : {}),
      }) as unknown as JsonValue
    }),
    definition('rp.memory.append', 'memory', 'Persist one idempotent scoped memory fact.', async (request) => {
      const input = inputObject(request.input, 'rp.memory.append')
      if (ctx.rpMemory.listStores().length === 0) throw new Error('No durable RP memory store is registered')
      const tags = input.tags === undefined
        ? undefined
        : Array.isArray(input.tags) && input.tags.every(value => typeof value === 'string')
          ? input.tags
          : invalidInput('rp.memory.append tags must be an array of strings')
      const memory = await ctx.rpMemory.appendDurable(request.scope, {
        schemaVersion: 1,
        id: requiredInputString(input, 'id'),
        owner: requiredInputString(input, 'owner'),
        content: requiredInputString(input, 'content'),
        salience: requiredInputNumber(input, 'salience'),
        createdAt: requiredInputNumber(input, 'createdAt'),
        ...(tags === undefined ? {} : { tags }),
      })
      return memory as unknown as JsonValue
    }, ['memory.write']),
    definition('rp.lore.match', 'lore', 'Activate bounded literal lore for the supplied text.', (request) => {
      const input = inputObject(request.input, 'rp.lore.match')
      return Promise.resolve(ctx.rpLore.match(request.scope, { text: requiredInputString(input, 'text') }) as unknown as JsonValue)
    }),
    definition('rp.prompt.compose', 'tool', 'Compose registered prompt sections without implicit overrides.', (request) => {
      inputObject(request.input, 'rp.prompt.compose')
      return Promise.resolve(ctx.rpPrompt.compose(request.scope) as unknown as JsonValue)
    }),
    definition('rp.branches.inspect', 'tool', 'Inspect the current branch and swipe graph.', (request) => {
      inputObject(request.input, 'rp.branches.inspect')
      return Promise.resolve((ctx.rpBranches.snapshot(request.scope) ?? null) as unknown as JsonValue)
    }),
    definition('rp.scene.inspect', 'tool', 'Inspect the revisioned active scene for this scope.', (request) => {
      inputObject(request.input, 'rp.scene.inspect')
      return Promise.resolve((ctx.rpScene.read(request.scope) ?? null) as unknown as JsonValue)
    }),
    definition('rp.relationship.inspect', 'tool', 'Inspect the directed relationship graph for this scope.', (request) => {
      inputObject(request.input, 'rp.relationship.inspect')
      return Promise.resolve(ctx.rpRelationships.list(request.scope) as unknown as JsonValue)
    }),
    definition('rp.rules.evaluate', 'rules', 'Evaluate bounded input through a registered deterministic rules engine.', async (request) => {
      const input = inputObject(request.input, 'rp.rules.evaluate')
      const system = typeof input.system === 'string' ? input.system : 'seeded-dice'
      const payload = isJsonObject(input.payload) ? input.payload : input
      return await ctx.rpRules.evaluate(RpRuleSystemId(system), payload, request.signal)
    }),
    definition('rp.media.generate', 'media', 'Generate one validated media artifact through an authorized Provider.', async (request) => {
      const input = inputObject(request.input, 'rp.media.generate')
      const kind = mediaKind(input.kind)
      const artifact = await ctx.rpMedia.generate({
        kind,
        prompt: requiredInputString(input, 'prompt'),
        ...(typeof input.provider === 'string' ? { provider: RpMediaProviderId(input.provider) } : {}),
        ...(isJsonObject(input.options) ? { options: input.options } : {}),
      }, request.signal)
      return artifact as unknown as JsonValue
    }, ['media.generate']),
    definition('rp.registry.inspect', 'tool', 'Inspect open RP package releases and deterministic dependency locks.', (request) => {
      const input = inputObject(request.input, 'rp.registry.inspect')
      if (typeof input.id !== 'string') return Promise.resolve(ctx.rpRegistry.list() as unknown as JsonValue)
      return Promise.resolve(ctx.rpRegistry.lock(input.id, typeof input.version === 'string' ? input.version : '*') as unknown as JsonValue)
    }),
    definition('rp.outbox.inspect', 'tool', 'Inspect committed external-effect intents and their retry state.', (request) => {
      const input = inputObject(request.input, 'rp.outbox.inspect')
      const status = typeof input.status === 'string' && ['pending', 'running', 'completed', 'failed'].includes(input.status) ? input.status as 'pending' | 'running' | 'completed' | 'failed' : undefined
      return Promise.resolve(ctx.rpOutbox.list(status) as unknown as JsonValue)
    }),
    definition('rp.workflow.route', 'pipeline', 'Route a bounded payload to a registered workflow backend.', async (request) => {
      const input = inputObject(request.input, 'rp.workflow.route')
      const kind = workflowKind(input.kind)
      const run = ctx.rpWorkflowRouter.start({
        kind,
        payload: input.payload ?? null,
        ...(typeof input.backend === 'string' ? { backend: input.backend } : {}),
        authority: request.effectiveAuthority,
        budget: request.effectiveBudget,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      const outcome = await run.result
      if (outcome.status !== 'completed') throw new Error(`RP workflow ${run.id} ${outcome.status}: ${outcome.error ?? 'no diagnostic'}`)
      return outcome.value ?? null
    }),
  ]
}

/** One Provider-neutral Agent stage routed through the unified Catalog. */
function agentStage(
  id: string,
  role: string,
  after: readonly string[] = [],
  inputKey?: string,
): RpPipelineStageDefinition {
  return {
    id,
    ...(after.length === 0 ? {} : { after }),
    operation: {
      kind: 'invoke-capability',
      capabilityId: `rp.agent.${role}`,
      grantedPermissions: ['agent:spawn'],
      grantedTrust: 'L2',
      ...(inputKey === undefined ? {} : { inputKey }),
    },
  }
}

/** Deterministically combine selected parallel outputs before a downstream Agent. */
function joinStage(
  id: string,
  after: readonly string[],
  valueKeys: readonly string[],
): RpPipelineStageDefinition {
  return {
    id,
    after,
    run(frame) {
      const joined: Record<string, JsonValue> = {}
      for (const key of valueKeys) {
        const value = frame.values[key]
        if (value === undefined) throw new Error(`RP Agent join ${JSON.stringify(id)} is missing ${JSON.stringify(key)}`)
        joined[key] = value
      }
      return { [`stage.${id}.joined`]: joined }
    },
  }
}

/** Build a turn pipeline whose context stages execute real domain providers. */
function turnStages(ctx: Context, adaptive: boolean): readonly RpPipelineStageDefinition[] {
  const runtime = (
    id: string,
    after: readonly string[],
    run: NonNullable<RpPipelineStageDefinition['run']>,
  ): RpPipelineStageDefinition => ({ id, ...(after.length === 0 ? {} : { after }), run })
  const stages: RpPipelineStageDefinition[] = [
    runtime('admission', [], frame => ({
      'turn.admitted': true,
      'turn.inputKind': Array.isArray(frame.input) ? 'array' : frame.input === null ? 'null' : typeof frame.input,
    })),
    runtime('context', ['admission'], (frame, stage) => ({
      'turn.text': textInput(frame.input),
      'context.supplied': suppliedContext(stage),
      'context.preset': turnContext(stage).preset ?? null,
      'context.library': turnContext(stage).library ?? null,
    })),
    runtime('identity', ['context'], (_frame, stage) => {
      const library = activeLibrary(stage)
      return {
        'context.characters': (library === undefined
          ? ctx.rpCharacters.context(stage.scope)
          : projectCharacterContext(library.characters)) as unknown as JsonValue,
        'context.personas': (library === undefined
          ? ctx.rpPersonas.context(stage.scope)
          : projectPersonaContext(library.personas)) as unknown as JsonValue,
      }
    }),
  ]
  if (adaptive) {
    stages.push(
      runtime('history', ['context'], (_frame, stage) => ({
        'context.history': boundedScopeArray(stage, 'history', 32, 64_000),
      })),
      runtime('state', ['context'], (_frame, stage) => ({
        'context.state': boundedScopeArray(stage, 'states', 64, 32_000),
      })),
      runtime('branches', ['context'], (_frame, stage) => ({
        'context.branches': boundedScopeArray(stage, 'branches', 64, 32_000),
        'context.activeBranchId': scopeProjection(stage).activeBranchId ?? null,
      })),
      runtime('lore', ['context'], (frame, stage) => {
        const library = activeLibrary(stage)
        const query = { text: textInput(frame.input) }
        return {
          'context.lore': (library === undefined
            ? ctx.rpLore.match(stage.scope, query)
            : matchLoreBooks(library.lorebooks, query)) as unknown as JsonValue,
        }
      }),
      runtime('memory', ['context'], (frame, stage) => ({
        'context.memory': ctx.rpMemory.searchEvents(
          stage.scope,
          scopeArray(stage, 'memories') as unknown as readonly MemoryEvent[],
          { text: textInput(frame.input) },
        ) as unknown as JsonValue,
      })),
      runtime('scene', ['context'], (_frame, stage) => ({
        'context.scene': scopeProjection(stage).scene ?? null,
      })),
      runtime('relationship', ['context'], (_frame, stage) => ({
        'context.relationships': boundedScopeArray(stage, 'relationships', 128, 32_000),
      })),
      runtime('prompt', ['identity', 'history', 'state', 'branches', 'lore', 'memory', 'scene', 'relationship'], (frame, stage) => {
        const characters = frame.values['context.characters']
        const personas = frame.values['context.personas']
        const history = frame.values['context.history']
        const state = frame.values['context.state']
        const branches = frame.values['context.branches']
        const lore = frame.values['context.lore']
        const memory = frame.values['context.memory']
        const scene = frame.values['context.scene']
        const relationships = frame.values['context.relationships']
        const preset = activePreset(stage)
        const additions = [
          ...(preset === undefined
            ? Array.isArray(characters) && characters.length > 0 ? [{ schemaVersion: 1 as const, id: 'rp.runtime.characters', role: 'system' as const, content: JSON.stringify(characters), priority: 400 }] : []
            : presetSections(preset, { characters, personas, lore, history })),
          ...(preset === undefined && Array.isArray(personas) && personas.length > 0 ? [{ schemaVersion: 1 as const, id: 'rp.runtime.personas', role: 'system' as const, content: JSON.stringify(personas), priority: 450 }] : []),
          ...(preset === undefined && Array.isArray(lore) && lore.length > 0 ? [{ schemaVersion: 1 as const, id: 'rp.runtime.lore', role: 'system' as const, content: JSON.stringify(lore), priority: 500 }] : []),
          ...(preset === undefined && Array.isArray(history) && history.length > 0 ? [{ schemaVersion: 1 as const, id: 'rp.runtime.history', role: 'system' as const, content: JSON.stringify(history), priority: 525 }] : []),
          ...(Array.isArray(memory) && memory.length > 0 ? [{ schemaVersion: 1 as const, id: 'rp.runtime.memory', role: 'system' as const, content: JSON.stringify(memory), priority: 600 }] : []),
          ...(scene === null ? [] : [{ schemaVersion: 1 as const, id: 'rp.runtime.scene', role: 'system' as const, content: JSON.stringify(scene), priority: 550 }]),
          ...(Array.isArray(state) && state.length > 0 ? [{ schemaVersion: 1 as const, id: 'rp.runtime.state', role: 'system' as const, content: JSON.stringify(state), priority: 575 }] : []),
          ...(Array.isArray(branches) && branches.length > 0 ? [{ schemaVersion: 1 as const, id: 'rp.runtime.branches', role: 'system' as const, content: JSON.stringify({ activeBranchId: frame.values['context.activeBranchId'], branches }), priority: 625 }] : []),
          ...(Array.isArray(relationships) && relationships.length > 0 ? [{ schemaVersion: 1 as const, id: 'rp.runtime.relationships', role: 'system' as const, content: JSON.stringify(relationships), priority: 650 }] : []),
        ]
        const prompt = ctx.rpPrompt.compose(stage.scope, additions)
        return { 'prompt.sections': prompt.sections as unknown as JsonValue, 'prompt.text': prompt.text }
      }),
      runtime('capability-plan', ['prompt'], (_frame, stage) => ({
        'agent.availableCapabilities': ctx.rpCapabilities.list({ scope: stage.scope.kind }).map(item => ({ id: item.id, kind: item.kind, title: item.title })) as unknown as JsonValue,
      })),
      runtime('actor-input', ['capability-plan'], turnAgentRequest),
      agentStage('actor', 'actor', ['actor-input'], 'agent.request'),
      runtime('output', ['actor'], frame => ({
        'turn.effects': turnEffectsFromAgent(frame.values['stage.actor.result']),
        'output.validated': true,
      })),
      runtime('commit', ['output'], () => ({ 'turn.commitReady': true })),
      runtime('render', ['commit'], () => ({ 'turn.renderReady': true })),
    )
  } else {
    stages.push(
      runtime('history', ['context'], (_frame, stage) => ({
        'context.history': boundedScopeArray(stage, 'history', 32, 64_000),
      })),
      runtime('prompt', ['identity', 'history'], (frame, stage) => {
        const characters = frame.values['context.characters']
        const personas = frame.values['context.personas']
        const history = frame.values['context.history']
        const preset = activePreset(stage)
        const library = activeLibrary(stage)
        const lore = library === undefined
          ? undefined
          : matchLoreBooks(library.lorebooks, { text: textInput(frame.input) }) as unknown as JsonValue
        const additions = [
          ...(preset === undefined
            ? Array.isArray(characters) && characters.length > 0 ? [{ schemaVersion: 1 as const, id: 'rp.runtime.characters', role: 'system' as const, content: JSON.stringify(characters), priority: 400 }] : []
            : presetSections(preset, { characters, personas, lore, history })),
          ...(preset === undefined && Array.isArray(personas) && personas.length > 0 ? [{ schemaVersion: 1 as const, id: 'rp.runtime.personas', role: 'system' as const, content: JSON.stringify(personas), priority: 450 }] : []),
          ...(preset === undefined && Array.isArray(history) && history.length > 0 ? [{ schemaVersion: 1 as const, id: 'rp.runtime.history', role: 'system' as const, content: JSON.stringify(history), priority: 525 }] : []),
        ]
        const prompt = ctx.rpPrompt.compose(stage.scope, additions)
        return { 'prompt.sections': prompt.sections as unknown as JsonValue, 'prompt.text': prompt.text }
      }),
      runtime('actor-input', ['prompt'], turnAgentRequest),
      agentStage('actor', 'actor', ['actor-input'], 'agent.request'),
      runtime('output', ['actor'], frame => ({
        'turn.effects': turnEffectsFromAgent(frame.values['stage.actor.result']),
        'output.validated': true,
      })),
      runtime('commit', ['output'], () => ({ 'turn.commitReady': true })),
    )
  }
  return stages
}

function textInput(input: JsonValue): string {
  if (typeof input === 'string') return input
  if (isJsonObject(input) && typeof input.text === 'string') return input.text
  return JSON.stringify(input)
}

function turnContext(stage: RpPipelineStageContext): Record<string, JsonValue> {
  const raw = stage.metadata?.turnContext
  if (raw === undefined) return {}
  if (!isJsonObject(raw) || raw.schemaVersion !== 1 || !isJsonObject(raw.session)) {
    throw new Error('RP turn Pipeline received an invalid frozen turn context')
  }
  return raw
}

function suppliedContext(stage: RpPipelineStageContext): JsonObject {
  const supplied = turnContext(stage).supplied
  if (supplied === undefined) return {}
  if (!isJsonObject(supplied)) throw new Error('RP turn supplied context must be an object')
  return supplied
}

function activePreset(stage: RpPipelineStageContext): RpPresetSnapshot | undefined {
  const value = turnContext(stage).preset
  if (value === undefined) return undefined
  if (!isJsonObject(value) || value.schemaVersion !== 1 || typeof value.id !== 'string'
    || typeof value.snapshotHash !== 'string' || !Array.isArray(value.prompts)
    || !Array.isArray(value.promptDefinitions) || !Array.isArray(value.promptOrders)) {
    throw new Error('RP turn preset snapshot is invalid')
  }
  return value as unknown as RpPresetSnapshot
}

function activeLibrary(stage: RpPipelineStageContext): RpLibrarySnapshot | undefined {
  const value = turnContext(stage).library
  if (value === undefined) return undefined
  if (!isJsonObject(value) || value.schemaVersion !== 1 || typeof value.snapshotHash !== 'string'
    || !Array.isArray(value.characters) || !Array.isArray(value.personas) || !Array.isArray(value.lorebooks)
    || !isJsonObject(value.bindingScopes)) {
    throw new Error('RP turn library snapshot is invalid')
  }
  return value as unknown as RpLibrarySnapshot
}

function presetSections(
  preset: RpPresetSnapshot,
  values: {
    readonly characters: JsonValue | undefined
    readonly personas: JsonValue | undefined
    readonly lore: JsonValue | undefined
    readonly history: JsonValue | undefined
  },
): PromptSectionIR[] {
  const markers = new Set(preset.promptDefinitions.filter(item => item.marker).map(item => item.id))
  const characterName = firstText(values.characters, 'name') ?? 'character'
  const personaName = firstText(values.personas, 'name') ?? 'user'
  let lorePlaced = false
  const sections: PromptSectionIR[] = []
  for (const section of preset.prompts) {
    let content = section.content
    if (markers.has(section.id)) {
      if (section.id === 'charDescription') content = collectionField(values.characters, 'description')
      else if (section.id === 'charPersonality') content = collectionField(values.characters, 'personality')
      else if (section.id === 'scenario') content = collectionField(values.characters, 'scenario')
      else if (section.id === 'personaDescription') content = collectionField(values.personas, 'description')
      else if (section.id === 'dialogueExamples') content = collectionExamples(values.characters)
      else if (section.id === 'chatHistory') content = jsonArrayText(values.history)
      else if ((section.id === 'worldInfoBefore' || section.id === 'worldInfoAfter') && !lorePlaced) {
        content = jsonArrayText(values.lore)
        lorePlaced = content !== ''
      } else content = ''
    }
    content = content
      .replace(/\{\{char(?:IfNotGroup)?\}\}/gu, characterName)
      .replace(/\{\{user\}\}/gu, personaName)
    if (content.trim() === '') continue
    sections.push(Object.freeze({ ...section, content }))
  }
  return sections
}

function firstText(value: JsonValue | undefined, field: string): string | undefined {
  if (!Array.isArray(value)) return undefined
  for (const item of value) {
    if (isJsonObject(item) && typeof item[field] === 'string' && item[field].trim() !== '') return item[field]
  }
  return undefined
}

function collectionField(value: JsonValue | undefined, field: string): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((item) => {
    if (!isJsonObject(item) || typeof item[field] !== 'string' || item[field].trim() === '') return []
    const name = typeof item.name === 'string' && item.name.trim() !== '' ? `${item.name}: ` : ''
    return [`${name}${item[field]}`]
  }).join('\n')
}

function collectionExamples(value: JsonValue | undefined): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((item) => {
    if (!isJsonObject(item) || !Array.isArray(item.examples)) return []
    return item.examples.filter((entry): entry is string => typeof entry === 'string')
  }).join('\n')
}

function jsonArrayText(value: JsonValue | undefined): string {
  return Array.isArray(value) && value.length > 0 ? JSON.stringify(value) : ''
}

function scopeProjection(stage: RpPipelineStageContext): Record<string, JsonValue> {
  const session = turnContext(stage).session
  if (session === undefined) return {}
  if (!isJsonObject(session)) throw new Error('RP turn Session projection must be an object')
  return session
}

function scopeArray(stage: RpPipelineStageContext, key: string): readonly JsonValue[] {
  const value = scopeProjection(stage)[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`RP turn context ${JSON.stringify(key)} must be an array`)
  return value
}

function boundedScopeArray(
  stage: RpPipelineStageContext,
  key: string,
  maxItems: number,
  maxCharacters: number,
): JsonValue[] {
  const source = scopeArray(stage, key)
  const newestFirst = key === 'history'
  const candidates = newestFirst ? [...source].reverse() : source
  const selected: JsonValue[] = []
  let characters = 0
  for (const item of candidates) {
    if (selected.length >= maxItems) break
    const size = JSON.stringify(item).length
    if (characters + size > maxCharacters) continue
    selected.push(item)
    characters += size
  }
  if (newestFirst) selected.reverse()
  return selected
}

function turnAgentRequest(
  frame: Parameters<NonNullable<RpPipelineStageDefinition['run']>>[0],
  stage: Parameters<NonNullable<RpPipelineStageDefinition['run']>>[1],
): RpPipelineStageOutput {
  const promptText = frame.values['prompt.text']
  const promptSections = frame.values['prompt.sections']
  if (typeof promptText !== 'string' || !Array.isArray(promptSections)) throw new Error('RP turn prompt output is incomplete')
  const requested = isJsonObject(frame.input) && typeof frame.input.actorCapability === 'string'
    ? frame.input.actorCapability
    : 'rp.agent.actor'
  if (requested !== 'rp.agent.actor') throw new Error(`First-party turn Pipeline cannot route unknown Actor capability ${JSON.stringify(requested)}`)
  const turnId = typeof stage.metadata?.turnId === 'string' && stage.metadata.turnId.length > 0
    ? stage.metadata.turnId
    : `rp-pipeline:${stage.runId}`
  const context: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(frame.values)) {
    if (key.startsWith('context.')) context[key.slice('context.'.length)] = value
  }
  const frozenTurn = turnContext(stage)
  const media = frozenTurn.media ?? []
  const content = frozenTurn.content ?? []
  if (!Array.isArray(media) || !Array.isArray(content)) {
    throw new Error('RP turn media context is invalid')
  }
  return {
    'agent.request': {
      schemaVersion: 1,
      turnId,
      input: frame.input,
      ...(media.length === 0 ? {} : { media }),
      ...(content.length === 0 ? {} : { content }),
      prompt: { text: promptText, sections: promptSections },
      context,
      availableCapabilities: frame.values['agent.availableCapabilities'] ?? [],
      requestedCapability: requested,
    },
  }
}

/** Convert a Provider-neutral Agent result into the public Turn Effects contract. */
function turnEffectsFromAgent(value: JsonValue | undefined): JsonObject {
  if (!isJsonObject(value)) throw new Error('RP Actor Provider must return an object')
  const structured = isJsonObject(value.structured) ? value.structured : undefined
  const proposed = structured !== undefined && isJsonObject(structured.effects)
    ? structured.effects
    : structured ?? value
  const assistantMessage = typeof proposed.assistantMessage === 'string'
    ? proposed.assistantMessage
    : textBlocks(value.output)
  if (assistantMessage === undefined || assistantMessage.trim() === '') {
    throw new Error('RP Actor Provider returned no assistant message')
  }
  const effects: Record<string, JsonValue> = { assistantMessage }
  for (const key of ['state', 'statePatch', 'memories', 'relationships', 'scene', 'branch', 'usage', 'metadata']) {
    const candidate = proposed[key]
    if (candidate !== undefined) effects[key] = candidate
  }
  return effects
}

function textBlocks(value: JsonValue | undefined): string | undefined {
  if (!Array.isArray(value)) return undefined
  const text = value.flatMap((block) => {
    if (!isJsonObject(block) || block.type !== 'text' || typeof block.text !== 'string') return []
    return [block.text]
  }).join('')
  return text === '' ? undefined : text
}

function inputObject(input: JsonValue, capability: string): Record<string, JsonValue> {
  if (!isJsonObject(input)) throw new Error(`${capability} input must be an object`)
  return input
}

function requiredInputString(input: Record<string, JsonValue>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`RP capability input.${key} must be a non-empty string`)
  return value
}

function requiredInputNumber(input: Record<string, JsonValue>, key: string): number {
  const value = input[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`RP capability input ${JSON.stringify(key)} must be a finite number`)
  }
  return value
}

function invalidInput(message: string): never { throw new Error(message) }

function workflowKind(value: JsonValue | undefined): RpWorkflowKind {
  if (value === 'turn' || value === 'workflow' || value === 'sidecar') return value
  throw new Error('rp.workflow.route input.kind must be turn, workflow, or sidecar')
}

function mediaKind(value: JsonValue | undefined): MediaArtifact['kind'] {
  if (value === 'image' || value === 'audio' || value === 'video' || value === 'document') return value
  throw new Error('rp.media.generate input.kind must be image, audio, video, or document')
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** First-party structural pipelines. Agent and domain plugins can select alternate named graphs. */
function pipelines(ctx: Context): readonly RpPipelineDefinition[] {
  const trpgRules: RpPipelineStageDefinition = {
    id: 'rules',
    async run(frame, stage) {
      const input = isJsonObject(frame.input) ? frame.input : undefined
      const request = input !== undefined && isJsonObject(input.rules) ? input.rules : undefined
      if (request === undefined) return { 'rules.skipped': true }
      const system = typeof request.system === 'string' ? request.system : 'seeded-dice'
      const payload = isJsonObject(request.payload) ? request.payload : request
      return { 'rules.result': await ctx.rpRules.evaluate(RpRuleSystemId(system), payload, stage.signal) }
    },
  }
  return [
    {
      id: TURN_FAST, kind: 'turn', version: '1.0.0', description: 'Single-actor low-overhead turn',
      trust: 'L2', permissions: ['rp.pipeline.execute', 'agent:spawn'],
      stages: turnStages(ctx, false),
    },
    {
      id: TURN_ADAPTIVE, kind: 'turn', version: '1.0.0', description: 'Agent-directed context and orchestration turn',
      trust: 'L2', permissions: ['rp.pipeline.execute', 'agent:spawn'],
      stages: turnStages(ctx, true),
    },
    {
      id: WORKFLOW_DIRECTED, kind: 'workflow', version: '1.0.0', description: 'Director, actor, critic, and repair workflow',
      trust: 'L2', permissions: ['rp.pipeline.execute', 'agent:spawn'],
      stages: [
        agentStage('director', 'director'),
        agentStage('actor', 'actor', ['director'], 'stage.director.result'),
        agentStage('critic', 'continuity-critic', ['actor'], 'stage.actor.result'),
        agentStage('repair', 'actor', ['critic'], 'stage.critic.result'),
      ],
    },
    {
      id: WORKFLOW_MULTI, kind: 'workflow', version: '1.0.0', description: 'Scheduler and parallel character-agent workflow',
      trust: 'L2', permissions: ['rp.pipeline.execute', 'agent:spawn'],
      stages: [
        agentStage('scheduler', 'group-scheduler'),
        agentStage('character-primary', 'character', ['scheduler'], 'stage.scheduler.result'),
        agentStage('character-secondary', 'character', ['scheduler'], 'stage.scheduler.result'),
        joinStage('character-join', ['character-primary', 'character-secondary'], [
          'stage.character-primary.result', 'stage.character-secondary.result',
        ]),
      ],
    },
    {
      id: WORKFLOW_WORLD, kind: 'workflow', version: '1.0.0', description: 'Parallel NPC, faction, and environment simulation',
      trust: 'L2', permissions: ['rp.pipeline.execute', 'agent:spawn'],
      stages: [
        agentStage('world-plan', 'world-simulator'),
        agentStage('npcs', 'character', ['world-plan'], 'stage.world-plan.result'),
        agentStage('factions', 'world-simulator', ['world-plan'], 'stage.world-plan.result'),
        agentStage('environment', 'narrator', ['world-plan'], 'stage.world-plan.result'),
        joinStage('world-join', ['npcs', 'factions', 'environment'], [
          'stage.npcs.result', 'stage.factions.result', 'stage.environment.result',
        ]),
      ],
    },
    {
      id: WORKFLOW_TRPG, kind: 'workflow', version: '1.0.0', description: 'Rules, party, world, and game-master workflow',
      trust: 'L2', permissions: ['rp.pipeline.execute', 'agent:spawn'],
      stages: [
        trpgRules,
        agentStage('party', 'character', ['rules'], 'rules.result'),
        agentStage('world', 'world-simulator', ['rules'], 'rules.result'),
        joinStage('trpg-join', ['party', 'world'], ['stage.party.result', 'stage.world.result']),
        agentStage('game-master', 'narrator', ['trpg-join'], 'stage.trpg-join.joined'),
      ],
    },
    {
      id: WORKFLOW_CREATOR, kind: 'workflow', version: '1.0.0', description: 'Creator, reviewer, and preview workflow',
      trust: 'L2', permissions: ['rp.pipeline.execute', 'agent:spawn'],
      stages: [
        agentStage('creator', 'creator'),
        agentStage('reviewer', 'reviewer', ['creator'], 'stage.creator.result'),
        agentStage('preview', 'actor', ['reviewer'], 'stage.reviewer.result'),
      ],
    },
    {
      id: SIDECAR_MEMORY, kind: 'sidecar', version: '1.0.0', description: 'Parallel memory, relationship, and world maintenance',
      trust: 'L2', permissions: ['rp.pipeline.execute', 'agent:spawn'],
      stages: [
        agentStage('memory-index', 'memory-curator'),
        agentStage('relationship', 'state-keeper'),
        agentStage('world-state', 'world-simulator'),
        joinStage('checkpoint', ['memory-index', 'relationship', 'world-state'], [
          'stage.memory-index.result', 'stage.relationship.result', 'stage.world-state.result',
        ]),
      ],
    },
  ]
}

/** Create one agent profile without fixing its provider implementation. */
function agent(id: string, role: string, capabilities: readonly string[]): RpAgentProfile {
  return { id, role, capabilities }
}

/** All first-party Experiences are compositions over registered parts, never feature flags. */
function experiences(): readonly RpExperienceManifest[] {
  const componentIds = (...ids: readonly string[]) => ids.map(RpComponentId)
  const make = (
    id: string,
    name: string,
    componentsValue: readonly ReturnType<typeof RpComponentId>[],
    agents: readonly RpAgentProfile[],
    turn: ReturnType<typeof RpPipelineId>,
    workflow?: ReturnType<typeof RpPipelineId>,
    sidecar?: ReturnType<typeof RpPipelineId>,
  ): RpExperienceManifest => ({
    schemaVersion: 1,
    id,
    name,
    components: componentsValue,
    agents,
    pipelines: { turn, ...(workflow === undefined ? {} : { workflow }), ...(sidecar === undefined ? {} : { sidecar }) },
    uiSlots: ['rp.library', 'rp.chat', 'rp.inspector'],
  })
  const base = componentIds('rp.character', 'rp.persona', 'rp.prompt', 'rp.lore', 'rp.state', 'rp.scene', 'rp.relationship', 'rp.branches', 'rp.actor')
  return [
    make('rp-adaptive', 'Adaptive RP', [...base, RpComponentId('rp.memory')], [agent('actor', 'actor', ['tool', 'skill', 'subagent', 'pipeline'])], TURN_ADAPTIVE, WORKFLOW_DIRECTED, SIDECAR_MEMORY),
    make('rp-fast', 'Fast RP', base, [agent('actor', 'actor', ['tool', 'skill'])], TURN_FAST),
    make('rp-directed', 'Directed RP', [...base, RpComponentId('rp.director')], [agent('director', 'director', ['subagent', 'pipeline']), agent('actor', 'actor', ['tool', 'skill'])], TURN_ADAPTIVE, WORKFLOW_DIRECTED),
    make('rp-multi-character', 'Multi-character RP', base, [agent('scheduler', 'group-scheduler', ['subagent', 'pipeline']), agent('characters', 'character', ['tool', 'skill'])], TURN_ADAPTIVE, WORKFLOW_MULTI),
    make('rp-world-sim', 'World Simulation', [...base, RpComponentId('rp.world'), RpComponentId('rp.memory')], [agent('world', 'world-simulator', ['subagent', 'pipeline']), agent('actor', 'actor', ['tool', 'skill'])], TURN_ADAPTIVE, WORKFLOW_WORLD, SIDECAR_MEMORY),
    make('rp-trpg', 'TRPG', [...base, RpComponentId('rp.world'), RpComponentId('rp.rules')], [agent('gm', 'narrator', ['tool', 'skill', 'subagent']), agent('rules', 'rules', ['tool'])], TURN_ADAPTIVE, WORKFLOW_TRPG),
    make('rp-companion', 'Companion', [...base, RpComponentId('rp.memory')], [agent('companion', 'actor', ['tool', 'skill', 'sidecar'])], TURN_ADAPTIVE, undefined, SIDECAR_MEMORY),
    make('rp-creator', 'Creator Studio', componentIds('rp.creator', 'rp.character', 'rp.lore', 'rp.prompt', 'rp.media'), [agent('creator', 'creator', ['tool', 'skill', 'subagent']), agent('reviewer', 'reviewer', ['tool'])], TURN_FAST, WORKFLOW_CREATOR),
    make('rp-premium', 'Premium RP', [...base, RpComponentId('rp.director'), RpComponentId('rp.critic'), RpComponentId('rp.memory'), RpComponentId('rp.media')], [agent('director', 'director', ['subagent', 'pipeline']), agent('actor', 'actor', ['tool', 'skill']), agent('critic', 'continuity-critic', ['tool'])], TURN_ADAPTIVE, WORKFLOW_DIRECTED, SIDECAR_MEMORY),
  ]
}

/** Export immutable first-party ids for UI and CLI discovery tests. */
export const FIRST_PARTY_PIPELINES: readonly string[] = Object.freeze([
  TURN_FAST, TURN_ADAPTIVE, WORKFLOW_DIRECTED, WORKFLOW_MULTI, WORKFLOW_WORLD,
  WORKFLOW_TRPG, WORKFLOW_CREATOR, SIDECAR_MEMORY,
] satisfies readonly JsonValue[])
