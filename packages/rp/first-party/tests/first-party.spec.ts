import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import RpAgentRuntime from '@dsh-rp/agent-runtime'
import RpComponentRegistry from '@dsh-rp/component-runtime'
import RpExperienceRegistry from '@dsh-rp/experience-registry'
import RpPipelineRuntime from '@dsh-rp/pipeline-runtime'
import RpStateRuntime from '@dsh-rp/state'
import RpMemoryBasic from '@dsh-rp/memory-basic'
import RpCharacterRuntime from '@dsh-rp/character'
import RpPersonaRuntime from '@dsh-rp/persona'
import RpLoreRuntime from '@dsh-rp/lore'
import RpPromptRuntime from '@dsh-rp/prompt'
import RpBranchRuntime from '@dsh-rp/branches'
import RpRegistry from '@dsh-rp/registry'
import RpWorkflowRouter from '@dsh-rp/workflow-router'
import RpOutbox from '@dsh-rp/outbox'
import RpSceneRuntime from '@dsh-rp/scene'
import RpRelationshipRuntime from '@dsh-rp/relationship'
import RpRulesRuntime from '@dsh-rp/rules'
import RpMediaRuntime from '@dsh-rp/media'
import RpJournal from '@dsh-rp/journal'
import RpProjectionService from '@dsh-rp/projection'
import RpTurnRuntime from '@dsh-rp/turn-runtime'
import type { RpPresetSnapshot } from '@dsh-rp/preset'
import type { RpLibrarySnapshot } from '@dsh-rp/library'
import * as FirstParty from '../src/index.ts'

describe('@dsh-rp/first-party', () => {
  it('installs complete profiles and removes every contribution with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRegistry)
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpAgentRuntime)
    await ctx.plugin(RpPipelineRuntime)
    await ctx.plugin(RpExperienceRegistry)
    await ctx.plugin(RpStateRuntime)
    await ctx.plugin(RpMemoryBasic)
    await ctx.plugin(RpCharacterRuntime)
    await ctx.plugin(RpPersonaRuntime)
    await ctx.plugin(RpLoreRuntime)
    await ctx.plugin(RpPromptRuntime)
    await ctx.plugin(RpBranchRuntime)
    await ctx.plugin(RpRegistry)
    await ctx.plugin(RpWorkflowRouter)
    await ctx.plugin(RpOutbox)
    await ctx.plugin(RpSceneRuntime)
    await ctx.plugin(RpRelationshipRuntime)
    await ctx.plugin(RpRulesRuntime)
    await ctx.plugin(RpMediaRuntime)
    let activeAgents = 0
    let peakAgents = 0
    let agentCalls = 0
    const actorInputs: unknown[] = []
    let presetEnabled = false
    const presetSnapshot: RpPresetSnapshot = {
      schemaVersion: 1,
      id: 'preset:test',
      name: 'Turn preset',
      promptDefinitions: [
        { schemaVersion: 1, id: 'custom', name: 'Custom', role: 'system', content: 'PRESET-CANARY: Write as {{char}} for {{user}}.', marker: false },
        { schemaVersion: 1, id: 'charDescription', name: 'Character', role: 'system', content: '', marker: true },
        { schemaVersion: 1, id: 'worldInfoBefore', name: 'Lore', role: 'system', content: '', marker: true },
        { schemaVersion: 1, id: 'chatHistory', name: 'History', role: 'system', content: '', marker: true },
        { schemaVersion: 1, id: 'disabled', name: 'Disabled', role: 'system', content: 'MUST-NOT-APPEAR', marker: false },
      ],
      promptOrders: [
        { id: '100000', entries: [{ identifier: 'disabled', enabled: true }] },
        { id: '100001', entries: [
          { identifier: 'custom', enabled: true },
          { identifier: 'charDescription', enabled: true },
          { identifier: 'worldInfoBefore', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: 'disabled', enabled: false },
        ] },
      ],
      selectedPromptOrderId: '100001',
      prompts: [
        { schemaVersion: 1, id: 'custom', role: 'system', content: 'PRESET-CANARY: Write as {{char}} for {{user}}.', priority: 0 },
        { schemaVersion: 1, id: 'charDescription', role: 'system', content: '', priority: 1 },
        { schemaVersion: 1, id: 'worldInfoBefore', role: 'system', content: '', priority: 2 },
        { schemaVersion: 1, id: 'chatHistory', role: 'system', content: '', priority: 3 },
      ],
      generation: { temperature: 0.8 },
      savedAt: 1,
      snapshotHash: 'a'.repeat(64),
      bindingScope: { kind: 'conversation', id: 'c' },
    }
    const librarySnapshot: RpLibrarySnapshot = {
      schemaVersion: 1,
      characters: [{
        schemaVersion: 1, id: 'snapshot-hero', name: 'Snapshot Hero', description: 'Frozen character description.',
        firstMessages: ['Not model context.'], extensions: { secret: 'library-secret' },
      }],
      personas: [{
        schemaVersion: 1, id: 'snapshot-user', name: 'Snapshot Visitor', description: 'Frozen persona description.',
      }],
      lorebooks: [{
        schemaVersion: 1, id: 'snapshot-lore', name: 'Frozen lore',
        entries: [{ id: 'constant', content: 'Frozen library lore.', keys: [], constant: true, enabled: true, priority: 5 }],
      }],
      bindingScopes: {
        character: { kind: 'conversation', id: 'c' }, persona: { kind: 'conversation', id: 'c' },
        lore: { kind: 'conversation', id: 'c' },
      },
      snapshotHash: 'c'.repeat(64),
    }
    ctx.rpAgents.registerProvider({
      id: 'test-agents',
      supports: () => true,
      async run(request) {
        agentCalls += 1
        activeAgents += 1
        if (request.role.id === 'actor') actorInputs.push(request.invocation.input)
        peakAgents = Math.max(peakAgents, activeAgents)
        await new Promise(resolve => setTimeout(resolve, 2))
        activeAgents -= 1
        return {
          value: request.role.id === 'actor'
            ? { assistantMessage: 'The observatory answers in a low mechanical hum.', role: request.role.id, input: request.invocation.input }
            : { role: request.role.id, input: request.invocation.input },
        }
      },
    })
    const fiber = await ctx.plugin(FirstParty)
    expect(ctx.rpExperiences.list().map(experience => experience.id)).toContain('rp-adaptive')
    expect(ctx.rpExperiences.list()).toHaveLength(9)
    expect(ctx.rpPipelines.list()).toHaveLength(8)
    expect(ctx.rpCapabilities.list({ kind: 'agent' }).length).toBeGreaterThan(10)
    expect(ctx.rpCapabilities.isExecutable('rp.agent.actor' as never)).toBe(true)
    expect(ctx.rpCapabilities.get('rp.lore.match' as never)).toBeDefined()
    expect(ctx.rpCapabilities.get('rp.character.context' as never)).toBeDefined()
    expect(ctx.rpCapabilities.get('rp.persona.context' as never)).toBeDefined()
    expect(ctx.rpCapabilities.get('rp.media.generate' as never)?.permissions).toEqual(['media.generate'])
    expect(ctx.rpCapabilities.get('rp.memory.append' as never)?.permissions).toEqual(['memory.write'])
    const adaptive = ctx.rpExperiences.select().experience
    const composition = ctx.rpComponents.resolve({
      scope: { kind: 'conversation', id: 'c' },
      components: adaptive.components,
      grantedCapabilities: [],
    })
    expect(composition.components.some(component => component.id === 'rp.actor')).toBe(true)
    ctx.rpCharacters.register({ kind: 'conversation', id: 'c' }, {
      schemaVersion: 1, id: 'hero', name: 'Hero', description: 'Looks for the truth.',
      firstMessages: ['This greeting stays outside the system prompt.'],
      extensions: { secret: 'not-for-model' },
    })
    ctx.rpPersonas.register({ kind: 'conversation', id: 'c' }, {
      schemaVersion: 1, id: 'user', name: 'Visitor', description: 'An invited astronomer.',
      extensions: { endpoint: 'https://not-for-model.invalid' },
    })
    const run = await ctx.rpPipelines.run(adaptive.pipelines.turn!, {
      scope: { kind: 'conversation', id: 'c' }, input: { text: 'hello' },
    })
    expect(run.frame.values['turn.commitReady']).toBe(true)
    const adaptiveEffects = run.frame.values['turn.effects']
    if (typeof adaptiveEffects !== 'object' || adaptiveEffects === null || Array.isArray(adaptiveEffects)) {
      throw new Error('adaptive turn effects missing')
    }
    expect(adaptiveEffects.assistantMessage).toContain('observatory')
    expect(run.frame.values['context.scene']).toBeNull()
    expect(run.frame.values['context.characters']).toEqual([{
      id: 'hero', name: 'Hero', description: 'Looks for the truth.',
    }])
    expect(run.frame.values['context.personas']).toEqual([{
      id: 'user', name: 'Visitor', description: 'An invited astronomer.',
    }])
    expect(run.frame.values['prompt.text']).toContain('Looks for the truth.')
    expect(run.frame.values['prompt.text']).toContain('An invited astronomer.')
    expect(run.frame.values['prompt.text']).not.toContain('not-for-model')
    expect(run.frame.values['prompt.text']).not.toContain('This greeting stays')
    await expect(ctx.rpCapabilities.invoke('rp.character.context' as never, {
      scope: { kind: 'conversation', id: 'c' }, grantedPermissions: [], input: {},
    })).resolves.toEqual([{ id: 'hero', name: 'Hero', description: 'Looks for the truth.' }])
    await expect(ctx.rpCapabilities.invoke('rp.persona.context' as never, {
      scope: { kind: 'conversation', id: 'c' }, grantedPermissions: [], input: {},
    })).resolves.toEqual([{ id: 'user', name: 'Visitor', description: 'An invited astronomer.' }])
    const fast = await ctx.rpPipelines.run('rp.turn.fast' as never, {
      scope: { kind: 'conversation', id: 'c' }, input: { text: 'hello quickly' },
    })
    expect(fast.frame.values['prompt.text']).toContain('Looks for the truth.')
    expect(fast.frame.values['prompt.text']).not.toContain('not-for-model')
    const fastEffects = fast.frame.values['turn.effects']
    if (typeof fastEffects !== 'object' || fastEffects === null || Array.isArray(fastEffects)) {
      throw new Error('fast turn effects missing')
    }
    expect(fastEffects.assistantMessage).toContain('observatory')
    ctx.rpScene.replace({ kind: 'conversation', id: 'c' }, {
      schemaVersion: 1, id: 'observatory', title: 'Observatory', participants: ['hero'],
    })
    ctx.rpRelationships.replace({ kind: 'conversation', id: 'c' }, {
      from: 'hero', to: 'guide', dimensions: { trust: 42 },
    })
    const contextualRun = await ctx.rpPipelines.run(adaptive.pipelines.turn!, {
      scope: { kind: 'conversation', id: 'c' }, input: { text: 'continue' },
      metadata: {
        turnContext: {
          schemaVersion: 1,
          supplied: {},
          session: {
            schemaVersion: 1,
            scope: { kind: 'conversation', id: 'c' },
            throughEventSeq: 12,
            states: [],
            memories: [],
            relationships: [{
              schemaVersion: 1, from: 'hero', to: 'guide', revision: 2, dimensions: { trust: 84 },
            }],
            scene: { schemaVersion: 1, id: 'journal-scene', title: 'Journal scene', participants: ['hero'] },
            branches: [],
            history: [],
          },
        },
      },
    })
    expect(contextualRun.frame.values['context.scene']).toMatchObject({ id: 'journal-scene' })
    expect(contextualRun.frame.values['context.relationships']).toMatchObject([{ dimensions: { trust: 84 } }])
    const rulesResult = await ctx.rpCapabilities.invoke('rp.rules.evaluate' as never, {
      scope: { kind: 'conversation', id: 'c' }, grantedPermissions: [],
      input: { system: 'seeded-dice', payload: { notation: '1d20', seed: 'test' } },
    })
    expect(rulesResult).toMatchObject({ system: 'seeded-dice' })
    expect(typeof rulesResult === 'object' && rulesResult !== null && !Array.isArray(rulesResult)
      && Array.isArray(rulesResult.rolls)).toBe(true)
    await expect(ctx.rpCapabilities.invoke('rp.media.generate' as never, {
      scope: { kind: 'conversation', id: 'c' }, grantedPermissions: [],
      input: { kind: 'image', prompt: 'scene' },
    })).rejects.toMatchObject({ code: 'PERMISSION' })
    await expect(ctx.rpCapabilities.invoke('rp.media.generate' as never, {
      scope: { kind: 'conversation', id: 'c' }, grantedPermissions: ['media.generate'],
      input: { kind: 'image', prompt: 'scene' },
    })).resolves.toMatchObject({ kind: 'image', mimeType: 'image/svg+xml' })
    await expect(ctx.rpCapabilities.invoke('rp.memory.append' as never, {
      scope: { kind: 'conversation', id: 'c' }, grantedPermissions: [],
      input: { id: 'fact', owner: 'hero', content: 'remember', salience: 1, createdAt: 1 },
    })).rejects.toMatchObject({ code: 'PERMISSION' })
    const trpg = await ctx.rpPipelines.run('rp.workflow.trpg' as never, {
      scope: { kind: 'conversation', id: 'c' },
      input: { rules: { system: 'seeded-dice', payload: { notation: '2d6+1', seed: 'encounter' } } },
      grantedPermissions: ['rp.pipeline.execute', 'agent:spawn'],
      grantedTrust: 'L2',
    })
    expect(trpg.frame.values['rules.result']).toMatchObject({ system: 'seeded-dice', notation: '2d6+1' })
    expect(trpg.frame.values['stage.game-master.result']).toMatchObject({ role: 'narrator' })
    const multi = await ctx.rpPipelines.run('rp.workflow.multi-character' as never, {
      scope: { kind: 'conversation', id: 'c' }, input: { text: 'the party enters' },
      grantedPermissions: ['rp.pipeline.execute', 'agent:spawn'], grantedTrust: 'L2',
    })
    expect(multi.frame.values['stage.character-join.joined']).toMatchObject({
      'stage.character-primary.result': { role: 'character' },
      'stage.character-secondary.result': { role: 'character' },
    })
    expect(peakAgents).toBeGreaterThanOrEqual(2)

    await ctx.plugin(RpJournal)
    await ctx.plugin(RpProjectionService)
    ctx.provide('rpPresets', {
      capture: () => presetEnabled ? presetSnapshot : undefined,
    } as unknown as Context['rpPresets'])
    ctx.provide('rpLibrary', {
      capture: () => presetEnabled ? librarySnapshot : undefined,
    } as unknown as Context['rpLibrary'])
    await ctx.plugin(RpTurnRuntime)
    const turnSession = Session.create(SessionId('first-party-turn'))
    const fastExperience = ctx.rpExperiences.get('rp-fast')!
    const callsBeforeTurn = agentCalls
    const committed = await ctx.rpTurn.run({
      session: turnSession,
      experience: fastExperience,
      scope: { kind: 'conversation', id: 'c' },
      input: { text: 'What wakes beneath the dome?' },
      grantedCapabilities: [],
      authority: {
        grantedPermissions: ['rp.pipeline.execute', 'agent:spawn'],
        grantedTrust: 'L2',
        budget: { maxAgents: 1, timeoutMs: 60_000 },
      },
    })
    expect(agentCalls - callsBeforeTurn).toBe(1)
    expect(committed.record.assistantMessage).toContain('observatory')
    expect(committed.record.agentTrace).toBeUndefined()
    expect(committed.record.pipelineTrace?.map(stage => stage.stageId)).toEqual([
      'admission', 'context', 'history', 'identity', 'prompt', 'actor-input', 'actor', 'output', 'commit',
    ])
    const projection = ctx.rpProjection.project(turnSession)
    expect(projection.turns).toHaveLength(1)
    expect(projection.contexts[0]).toMatchObject({
      schemaVersion: 1,
      input: { text: 'What wakes beneath the dome?' },
    })
    expect(projection.turns[0]?.assistantMessage).toContain('observatory')
    const callsBeforeSecondTurn = agentCalls
    await ctx.rpTurn.run({
      session: turnSession,
      experience: fastExperience,
      scope: { kind: 'conversation', id: 'c' },
      input: { text: 'And after that?' },
      grantedCapabilities: [],
      authority: {
        grantedPermissions: ['rp.pipeline.execute', 'agent:spawn'],
        grantedTrust: 'L2',
        budget: { maxAgents: 1, timeoutMs: 60_000 },
      },
    })
    expect(agentCalls - callsBeforeSecondTurn).toBe(1)
    expect(actorInputs.at(-1)).toMatchObject({
      context: {
        history: [{
          input: { text: 'What wakes beneath the dome?' },
          assistantMessage: 'The observatory answers in a low mechanical hum.',
        }],
      },
    })
    presetEnabled = true
    const callsBeforePresetTurn = agentCalls
    await ctx.rpTurn.run({
      session: turnSession,
      experience: fastExperience,
      scope: { kind: 'conversation', id: 'c' },
      input: { text: 'Use the active preset.' },
      grantedCapabilities: [],
      authority: {
        grantedPermissions: ['rp.pipeline.execute', 'agent:spawn'],
        grantedTrust: 'L2',
        budget: { maxAgents: 1, timeoutMs: 60_000 },
      },
    })
    expect(agentCalls - callsBeforePresetTurn).toBe(1)
    const presetAgentInput = actorInputs.at(-1) as {
      readonly prompt: { readonly text: string; readonly sections: readonly { readonly id: string }[] }
      readonly context: { readonly preset: RpPresetSnapshot; readonly library: RpLibrarySnapshot }
    }
    expect(presetAgentInput.prompt.text).toContain('PRESET-CANARY: Write as Snapshot Hero for Snapshot Visitor.')
    expect(presetAgentInput.prompt.text).toContain('Frozen character description.')
    expect(presetAgentInput.prompt.text).toContain('Frozen library lore.')
    expect(presetAgentInput.prompt.text).not.toContain('library-secret')
    expect(presetAgentInput.prompt.text).not.toContain('MUST-NOT-APPEAR')
    expect(presetAgentInput.prompt.sections.map(section => section.id)).toEqual([
      'custom', 'charDescription', 'worldInfoBefore', 'chatHistory',
    ])
    expect(presetAgentInput.context.preset).toMatchObject({
      id: 'preset:test', selectedPromptOrderId: '100001', snapshotHash: 'a'.repeat(64),
    })
    expect(presetAgentInput.context.library).toMatchObject({
      characters: [{ id: 'snapshot-hero' }], personas: [{ id: 'snapshot-user' }],
      lorebooks: [{ id: 'snapshot-lore' }], snapshotHash: 'c'.repeat(64),
    })
    expect(turnSession.events.filter(event => event.type === 'rp/context-activated').at(-1)?.data).toMatchObject({
      input: { text: 'Use the active preset.' },
      context: {
        preset: {
          id: 'preset:test',
          selectedPromptOrderId: '100001',
          snapshotHash: 'a'.repeat(64),
          prompts: [{ id: 'custom' }, { id: 'charDescription' }, { id: 'worldInfoBefore' }, { id: 'chatHistory' }],
        },
        library: { characters: [{ id: 'snapshot-hero' }], snapshotHash: 'c'.repeat(64) },
      },
    })
    await expect(ctx.rpCapabilities.invoke('rp.workflow.route' as never, {
      scope: { kind: 'conversation', id: 'c' }, grantedPermissions: [],
      input: { kind: 'workflow', payload: { input: { value: 3 }, expression: { op: 'get', from: { op: 'input' }, key: 'value' } } },
    })).resolves.toBe(3)
    await fiber.dispose()
    expect(ctx.rpExperiences.list()).toHaveLength(0)
    expect(ctx.rpPipelines.list()).toHaveLength(0)
    expect(ctx.rpCapabilities.list()).toHaveLength(0)
    expect(ctx.rpComponents.list()).toHaveLength(0)
  })
})
