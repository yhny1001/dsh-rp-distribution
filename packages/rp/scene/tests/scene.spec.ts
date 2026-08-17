import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { RpScopeRef } from '@dsh-rp/contracts'
import RpSceneRuntime, { RpSceneConflictError } from '../src/index.ts'

const scope: RpScopeRef = { kind: 'conversation', id: 'scene-test' }

describe('RP scene runtime', () => {
  it('commits complete scenes with optimistic revisions and detached input', async () => {
    const ctx = new Context(); await ctx.plugin(RpSceneRuntime)
    const participants = ['mira']
    const first = ctx.rpScene.replace(scope, {
      schemaVersion: 1, id: 'arrival', title: 'Arrival', participants, location: 'Station',
    })
    participants.push('late-mutation')
    expect(first).toMatchObject({ revision: 1, scene: { participants: ['mira'] } })
    expect(() => ctx.rpScene.replace(scope, first.scene, 0)).toThrow(RpSceneConflictError)
    expect(ctx.rpScene.clear(scope, 1)).toBe(true)
    expect(ctx.rpScene.read(scope)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
