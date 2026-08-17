import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RpRuleSystemId } from '@dsh-rp/contracts'
import RpRulesRuntime from '../src/index.ts'

describe('RP rules runtime', () => {
  it('produces replayable bounded dice outcomes without exposing the seed', async () => {
    const ctx = new Context(); await ctx.plugin(RpRulesRuntime)
    const input = { notation: '2d6+1', seed: 'turn-42', target: 8 }
    const first = await ctx.rpRules.evaluate(RpRuleSystemId('seeded-dice'), input)
    const second = await ctx.rpRules.evaluate(RpRuleSystemId('seeded-dice'), input)
    expect(second).toEqual(first)
    expect(first).toMatchObject({ notation: '2d6+1', modifier: 1, target: 8 })
    expect(JSON.stringify(first)).not.toContain('turn-42')
    await ctx.fiber.dispose()
  })

  it('releases contributed rule systems with their registration effect', async () => {
    const ctx = new Context(); await ctx.plugin(RpRulesRuntime)
    const release = ctx.rpRules.register({
      id: RpRuleSystemId('fixture'), version: '1.0.0', title: 'Fixture',
      evaluate: () => Promise.resolve({ ok: true }),
    })
    expect(ctx.rpRules.list().map(item => item.id)).toContain('fixture')
    release()
    expect(ctx.rpRules.list().map(item => item.id)).not.toContain('fixture')
    await ctx.fiber.dispose()
  })
})
