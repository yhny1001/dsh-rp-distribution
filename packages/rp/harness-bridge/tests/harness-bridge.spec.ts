import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import RpCapabilityCatalog from '@dsh-rp/capability-catalog'
import { RpPipelineId } from '@dsh-rp/contracts'
import RpPipelineRuntime from '@dsh-rp/pipeline-runtime'
import RpWorkflowRouter from '@dsh-rp/workflow-router'
import * as HarnessBridge from '../src/index.ts'

describe('@dsh-rp/harness-bridge', () => {
  it('mirrors live registries and withdraws every mirrored capability on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(RpCapabilityCatalog)
    await ctx.plugin(RpPipelineRuntime)
    await ctx.plugin(RpWorkflowRouter)
    ctx.tools.register(defineTool({
      name: 'echo', description: 'Echo text', parameters: { text: { type: 'string' } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) { return args.text ?? '' },
    }))
    ctx.skills.register({ name: 'story-style', description: 'Apply story style', content: 'Write vivid prose.', source: 'runtime' })
    ctx.rpPipelines.register({
      id: RpPipelineId('rp.turn.test'), kind: 'turn', version: '1', description: 'Test pipeline',
      trust: 'L2', permissions: ['rp.pipeline.execute'],
      stages: [{ id: 'stage', run: async () => ({ ok: true }) }],
    })
    ctx.rpWorkflowRouter.register({
      id: 'l1-test', kind: 'quickjs', trust: 'L1', kinds: ['workflow'],
      execute: request => Promise.resolve({ trust: request.authority?.trust ?? 'missing' }),
    })
    const fiber = await ctx.plugin(HarnessBridge)
    expect(ctx.rpCapabilities.get('tool:echo' as never)?.kind).toBe('tool')
    expect(ctx.rpCapabilities.get('skill:story-style' as never)?.kind).toBe('skill')
    expect(ctx.rpCapabilities.get('pipeline:rp.turn.test' as never)?.kind).toBe('pipeline')
    expect(ctx.rpCapabilities.get('pipeline:rp.turn.test' as never)).toMatchObject({
      trust: 'L2', permissions: ['rp.pipeline.execute'],
    })
    await expect(ctx.rpCapabilities.invoke('pipeline:rp.turn.test' as never, {
      scope: { kind: 'agent', id: 'actor' }, input: null, grantedTrust: 'L2', grantedPermissions: [],
    })).rejects.toThrow(/denied permission/)
    await expect(ctx.rpCapabilities.invoke('pipeline:rp.turn.test' as never, {
      scope: { kind: 'agent', id: 'actor' }, input: null, grantedTrust: 'L2',
      grantedPermissions: ['rp.pipeline.execute'],
    })).resolves.toEqual({ ok: true })
    expect(ctx.rpCapabilities.get('workflow-backend:deterministic' as never)?.trust).toBe('L0')
    await expect(ctx.rpCapabilities.invoke('workflow-backend:l1-test' as never, {
      scope: { kind: 'agent', id: 'actor' },
      input: { kind: 'workflow', payload: null },
      grantedPermissions: ['script.execute'],
      grantedTrust: 'L1',
    })).resolves.toEqual({ trust: 'L1' })
    await fiber.dispose()
    expect(ctx.rpCapabilities.list()).toHaveLength(0)
  })
})
