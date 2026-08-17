import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import RpComponentRuntime from '@dsh-rp/component-runtime'
import { RpCapabilityId } from '@dsh-rp/contracts'
import { strToU8, zipSync } from 'fflate'
import { apply, importCharacterCard, importCharacterCardCharx, importChat, importPersona, importPreset, importWorldInfo } from '../src/index.ts'

const options = { sourceId: 'fixture', importedAt: 1 }

describe('@dsh-rp/compat-sillytavern', () => {
  it('imports Character Card V3 and keeps extensions inert and lossless', () => {
    const source = JSON.stringify({
      spec: 'chara_card_v3', spec_version: '3.0', data: {
        name: '岚', description: 'desc', personality: 'quiet', scenario: 'rain', first_mes: 'Hello', mes_example: '',
        alternate_greetings: ['Again'], tags: ['test'], extensions: { regex_scripts: [{ findRegex: 'x' }], custom: 7 },
        character_book: { entries: [{ id: 1, keys: ['rain'], content: 'wet street', enabled: true, insertion_order: 5, extensions: {} }] },
      },
    })
    const result = importCharacterCard(source, options)
    expect(result.character).toMatchObject({ schemaVersion: 1, name: '岚', firstMessages: ['Hello', 'Again'] })
    expect(result.lore?.entries[0]).toMatchObject({ id: '1', keys: ['rain'], content: 'wet street' })
    expect(result.character.compatibility?.unknownFields).toMatchObject({ spec: 'chara_card_v3' })
    expect(result.character.compatibility?.warnings).toContain('Regex scripts were preserved but not executed.')
    expect(result.character.compatibility?.lossReport).toMatchObject({
      schemaVersion: 1,
      losslessData: true,
      executableBehaviorDisabled: true,
      items: [{ path: 'extensions.regex_scripts', feature: 'display-regex', disposition: 'disabled' }],
    })
  })

  it('imports standalone lore, preset order, and chat swipes', () => {
    expect(importWorldInfo(JSON.stringify({ name: 'City', entries: { 4: { key: ['gate'], content: 'Open', enabled: true, order: 3, probability: 50 } } }), options))
      .toMatchObject({
        name: 'City', entries: [{ id: '4', keys: ['gate'] }],
        compatibility: { lossReport: { losslessData: true, executableBehaviorDisabled: true } },
      })
    const preset = importPreset(JSON.stringify({
      prompts: [{
        identifier: 'main', role: 'system', content: 'Act', system_prompt: true, forbid_overrides: true,
        injection_position: 0, injection_depth: 4, injection_order: 2, injection_trigger: ['continue'],
      }],
      prompt_order: [{ order: [{ identifier: 'main', enabled: true }] }], temperature: 0.8,
      extensions: { tavern_helper: { scripts: [{ name: 'unsafe' }] } },
    }), options)
    expect(preset).toMatchObject({
      promptDefinitions: [{
        id: 'main', content: 'Act', systemPrompt: true, forbidOverrides: true,
        injectionPosition: 0, injectionDepth: 4, injectionOrder: 2, injectionTrigger: ['continue'],
      }],
      prompts: [{ id: 'main', content: 'Act' }], generation: { temperature: 0.8 },
    })
    expect(importPersona(JSON.stringify({ name: 'Visitor', description: 'An astronomer.', custom: true }), options))
      .toMatchObject({ name: 'Visitor', description: 'An astronomer.', compatibility: { unknownFields: { custom: true } } })
    const chat = importChat([
      JSON.stringify({ user_name: 'User', character_name: 'Char', chat_metadata: { custom: true } }),
      JSON.stringify({ name: 'Char', mes: 'One', is_user: false, swipes: ['One', 'Two'], swipe_id: 1 }),
    ].join('\n'), options)
    expect(chat).toMatchObject({ characterName: 'Char', messages: [{ role: 'assistant', activeSwipe: 1, swipes: ['One', 'Two'] }] })
  })

  it('retains every Prompt Manager definition and order while selecting the global 100001 profile', () => {
    const identifiers = Array.from({ length: 18 }, (_, index) => index === 0 ? 'main' : `prompt-${index}`)
    const preset = importPreset(JSON.stringify({
      prompts: identifiers.map((identifier, index) => ({
        identifier,
        name: `Prompt ${index}`,
        role: 'system',
        content: `content-${index}`,
        marker: index === 1,
      })),
      prompt_order: [
        { character_id: 100000, order: identifiers.slice(0, 4).map(identifier => ({ identifier, enabled: true })) },
        { character_id: 100001, order: identifiers.map((identifier, index) => ({ identifier, enabled: index !== 2 })) },
      ],
    }), options)
    expect(preset.promptDefinitions).toHaveLength(18)
    expect(preset.promptOrders).toHaveLength(2)
    expect(preset.promptOrders.map(order => order.id)).toEqual(['100000', '100001'])
    expect(preset.selectedPromptOrderId).toBe('100001')
    expect(preset.prompts).toHaveLength(17)
    expect(preset.prompts.map(prompt => prompt.id)).not.toContain('prompt-2')
    expect(preset.promptDefinitions.find(prompt => prompt.id === 'prompt-1')).toMatchObject({ marker: true })

    const fallback = importPreset(JSON.stringify({
      prompts: identifiers.slice(0, 2).map(identifier => ({ identifier, content: identifier })),
      prompt_order: [
        { character_id: 7, order: [{ identifier: 'main', enabled: true }] },
        { character_id: 8, order: [{ identifier: 'prompt-1', enabled: true }] },
      ],
    }), options)
    expect(fallback.selectedPromptOrderId).toBe('7')
    expect(fallback.prompts.map(prompt => prompt.id)).toEqual(['main'])
  })

  it('imports bounded CHARX media as inert metadata and rejects archive escapes', () => {
    const card = {
      spec: 'chara_card_v3', spec_version: '3.0', data: {
        name: 'Archive', description: 'desc', personality: '', scenario: '', first_mes: 'Hello', mes_example: '',
        alternate_greetings: [], tags: [], extensions: {},
        assets: [{ type: 'icon', uri: 'embedded://assets/main.png', name: 'main', ext: 'png' }],
      },
    }
    const archive = zipSync({
      'card.json': strToU8(JSON.stringify(card)),
      'assets/main.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    })
    expect(importCharacterCardCharx(archive, options)).toMatchObject({
      transport: 'charx', character: { name: 'Archive' },
      assets: [{ path: 'assets/main.png', mediaType: 'image/png', byteLength: 4 }],
      compatibility: {
        source: { format: 'sillytavern-character-card-charx' },
        lossReport: { losslessData: false, items: [{ feature: 'charx-container' }, { path: 'assets/main.png' }] },
      },
    })
    expect(() => importCharacterCardCharx(zipSync({
      'card.json': strToU8(JSON.stringify(card)), '../escape.png': Uint8Array.of(1),
    }), options)).toThrow(/unsafe archive path/u)
  })

  it('registers executable adapters and fully releases them on unload', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRuntime)
    await ctx.plugin(RpCapabilityCatalog)
    const fiber = await ctx.plugin({ name: 'compat-test', inject: ['rpComponents', 'rpCapabilities'], apply })
    expect(ctx.rpCapabilities.list({ tag: 'sillytavern' })).toHaveLength(7)
    const result = await ctx.rpCapabilities.invoke(RpCapabilityId('rp.import.sillytavern.chat'), {
      scope: { kind: 'conversation', id: 'c' }, grantedPermissions: [],
      input: { source: `${JSON.stringify({ chat_metadata: {} })}\n`, importedAt: 1 },
    })
    expect(result).toMatchObject({ schemaVersion: 1, messages: [] })
    await fiber.dispose()
    expect(ctx.rpCapabilities.list({ tag: 'sillytavern' })).toEqual([])
    expect(ctx.rpComponents.list().filter(item => String(item.id).startsWith('rp.compat.sillytavern'))).toEqual([])
  })
})
