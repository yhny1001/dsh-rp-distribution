import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import RpComponentRuntime from '@dsh-rp/component-runtime'
import { RpCapabilityId } from '@dsh-rp/contracts'
import * as Stscript from '../src/index.ts'

describe('@dsh-rp/compat-stscript', () => {
  it('executes variables, macros, numeric mutation, pipes, and escaped separators', () => {
    expect(Stscript.executeControlledStscript([
      '/setvar key=count value=2',
      '/incvar count',
      '/setvar key=phrase value="hello world"',
      '/pass "chapter|one"',
      '/setglobalvar key=chapter',
      '/echo "{{getvar::count}}/{{getglobalvar::chapter}}/{{pipe}}"',
    ].join(' | '))).toEqual({
      schemaVersion: 1,
      pipe: '3/chapter|one/chapter|one',
      localVariables: { count: 3, phrase: 'hello world' },
      globalVariables: { chapter: 'chapter|one' },
      output: ['3/chapter|one/chapter|one'],
      commandsExecuted: 6,
    })
  })

  it('runs explicitly supplied Quick Replies and rejects cycles and missing labels', () => {
    expect(Stscript.executeControlledQuickReply('Start', {
      Start: '/pass 4 | /run Add',
      Add: '/setvar key=score | /incvar score | /echo {{pipe}}',
    })).toMatchObject({ pipe: '5', localVariables: { score: 5 }, output: ['5'], commandsExecuted: 6 })
    expect(() => Stscript.executeControlledQuickReply('A', { A: '/run B', B: '/run A' }))
      .toThrow(expect.objectContaining({ code: 'QUICK_REPLY_CYCLE' }))
    expect(() => Stscript.executeControlledQuickReply('Absent', {}))
      .toThrow(expect.objectContaining({ code: 'QUICK_REPLY_MISSING' }))
  })

  it('fails closed for unsafe syntax, resource overflow, and cancellation', () => {
    for (const source of ['/gen write', '/fetch https://example.com', '/send hello', '/setvar key=x value={{random}}']) {
      expect(() => Stscript.executeControlledStscript(source)).toThrow(Stscript.ControlledStscriptError)
    }
    expect(() => Stscript.executeControlledStscript('/pass 1 | /pass 2', { maxCommands: 1 }))
      .toThrow(expect.objectContaining({ code: 'BOUND_EXCEEDED' }))
    expect(() => Stscript.executeControlledStscript('/setvar key=__proto__ value=polluted'))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(Object.prototype).not.toHaveProperty('polluted')
    expect(() => Stscript.executeControlledStscript('/setvar key=huge', {
      pipe: 'x'.repeat(1_048_570), localVariables: { safe: true },
    })).toThrow(expect.objectContaining({ code: 'BOUND_EXCEEDED' }))
    const controller = new AbortController()
    controller.abort()
    expect(() => Stscript.executeControlledStscript('/pass no', { signal: controller.signal }))
      .toThrow(expect.objectContaining({ code: 'ABORTED' }))
  })

  it('requires explicit L1 permission and releases every registration on unload', async () => {
    const ctx = new Context()
    await ctx.plugin(RpComponentRuntime)
    await ctx.plugin(RpCapabilityCatalog)
    const fiber = await ctx.plugin(Stscript)
    const id = RpCapabilityId('rp.compat.stscript.execute')
    expect(ctx.rpCapabilities.list({ tag: 'stscript' })).toHaveLength(2)
    await expect(ctx.rpCapabilities.invoke(id, {
      scope: { kind: 'conversation', id: 'c' }, grantedPermissions: [], input: { source: '/echo denied' },
    })).rejects.toEqual(expect.objectContaining({ code: 'PERMISSION' }))
    await expect(ctx.rpCapabilities.invoke(id, {
      scope: { kind: 'conversation', id: 'c' }, grantedPermissions: ['script.execute'],
      grantedTrust: 'L1',
      input: { source: '/pass 2 | /addvar key=count | /echo {{pipe}}', localVariables: { count: 3 } },
    })).resolves.toMatchObject({ pipe: '5', output: ['5'], localVariables: { count: 5 } })
    await fiber.dispose()
    expect(ctx.rpCapabilities.get(id)).toBeUndefined()
    expect(ctx.rpComponents.list().filter(item => String(item.id).includes('sillytavern'))).toEqual([])
  })
})
