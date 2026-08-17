import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RpComponentId, RpPipelineId } from '@dsh-rp/contracts'
import RpExperienceRegistry from '../src/index.ts'

function experience(id: string) {
  return {
    schemaVersion: 1 as const,
    id,
    name: id,
    components: [RpComponentId('actor')],
    agents: [],
    pipelines: { turn: RpPipelineId('turn.default') },
  }
}

describe('@dsh-rp/experience-registry', () => {
  it('honors user and agent choices before adaptive hints', async () => {
    const ctx = new Context()
    await ctx.plugin(RpExperienceRegistry)
    for (const id of ['rp-adaptive', 'rp-fast', 'rp-directed', 'rp-multi-character', 'rp-world-sim', 'rp-trpg', 'rp-creator', 'rp-premium']) {
      ctx.rpExperiences.register(experience(id))
    }
    expect(ctx.rpExperiences.select({ requested: 'rp-fast' }).reason).toBe('requested')
    expect(ctx.rpExperiences.select({ agentChoice: 'rp-directed', hints: { quality: 'fast' } }).experience.id)
      .toBe('rp-directed')
    expect(ctx.rpExperiences.select({ hints: { participantCount: 4 } }).experience.id).toBe('rp-multi-character')
    expect(ctx.rpExperiences.select().experience.id).toBe('rp-adaptive')
  })

  it('enforces allowlists and unregisters through disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(RpExperienceRegistry)
    const dispose = ctx.rpExperiences.register(experience('rp-adaptive'))
    expect(() => ctx.rpExperiences.select({ allowed: ['rp-fast'] })).toThrow(/denied/)
    dispose()
    expect(ctx.rpExperiences.list()).toHaveLength(0)
  })
})
