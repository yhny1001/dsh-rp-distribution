/** Live discovery bridge from native Harness registries into `ctx.rpCapabilities`. @module @dsh-rp/harness-bridge */

import type { Context } from '@deepseek-ai/cordis'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import { RpCapabilityId } from '@dsh-rp/contracts'
import type { JsonValue, RpTrustLevel } from '@dsh-rp/contracts'
import type { RpCapabilityContribution } from '@dsh-rp/capability-catalog'
import type {} from '@dsh-rp/pipeline-runtime'
import type { RpWorkflowBackend, RpWorkflowKind } from '@dsh-rp/workflow-router'

/** Cordis plugin name. */
export const name = 'rp-harness-bridge'
/** Native and RP registries observed by the bridge. */
export const inject = [
  'tools', 'skills', 'subagents', 'rpCapabilities', 'rpPipelines', 'rpWorkflowRouter',
]

type Disposer = () => void

/**
 * Mirror live Harness capability metadata while leaving execution in the owning registries.
 * @param ctx - Fully composed Harness context.
 */
export async function apply(ctx: Context): Promise<void> {
  const groups = {
    tools: [] as Disposer[],
    skills: [] as Disposer[],
    subagents: [] as Disposer[],
    pipelines: [] as Disposer[],
    workflowBackends: [] as Disposer[],
  }
  let disposed = false
  let skillsTask: Promise<void> = Promise.resolve()

  const replace = (group: keyof typeof groups, contributions: readonly RpCapabilityContribution[]): void => {
    for (const dispose of groups[group].splice(0)) dispose()
    const next: Disposer[] = []
    try {
      for (const contribution of contributions) next.push(ctx.rpCapabilities.register(contribution))
      groups[group].push(...next)
    } catch (error: unknown) {
      for (const dispose of next.reverse()) dispose()
      throw error
    }
  }

  const syncTools = (): void => {
    if (disposed) return
    replace('tools', ctx.tools.schemas().map(schema => ({
      descriptor: {
        id: RpCapabilityId(`tool:${schema.name}`),
        kind: 'tool',
        version: 'harness',
        title: schema.name,
        description: schema.description,
        trust: 'L2',
        scopes: ['turn', 'agent'],
        tags: ['harness', 'tool'],
      },
    })))
  }

  const skillContribution = (skill: SkillSummary): RpCapabilityContribution => ({
    descriptor: {
      id: RpCapabilityId(`skill:${skill.name}`),
      kind: 'skill',
      version: 'harness',
      title: skill.name,
      description: skill.description,
      trust: 'L2',
      scopes: ['conversation', 'scene', 'turn', 'agent'],
      tags: ['harness', 'skill', skill.provider],
    },
    invoke: async (request) => {
      const definition = await ctx.skills.get(skill.name, {
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      if (definition === undefined) throw new Error(`Harness skill ${JSON.stringify(skill.name)} disappeared before invocation`)
      return {
        name: definition.name,
        description: definition.description,
        content: definition.content,
        provider: definition.provider,
      }
    },
  })

  const syncSkills = async (): Promise<void> => {
    const skills = await ctx.skills.list()
    if (disposed) return
    replace('skills', skills.filter(skill => skill.invocation.modelInvocable).map(skillContribution))
  }

  const scheduleSkills = (): void => {
    skillsTask = skillsTask.then(syncSkills).catch((error: unknown) => {
      ctx.logger.warn(`rp-harness-bridge: skill catalog synchronization failed: ${renderError(error)}`)
    })
  }

  const syncSubagents = (): void => {
    if (disposed) return
    replace('subagents', ctx.subagents.list().map((providerName) => {
      const provider = ctx.subagents.getProvider(providerName)
      const capabilities = provider?.capabilities
      return {
        descriptor: {
          id: RpCapabilityId(`subagent:${providerName}`),
          kind: 'subagent',
          version: 'harness',
          title: providerName,
          description: `Harness Subagent provider ${providerName}.`,
          trust: 'L2',
          scopes: ['agent'],
          permissions: ['agent:spawn'],
          tags: [
            'harness', 'subagent',
            ...(capabilities?.outputSchema === true ? ['output-schema'] : []),
            ...(provider?.prepareContinuable === undefined ? [] : ['continuable']),
          ],
        },
      } satisfies RpCapabilityContribution
    }))
  }

  const syncPipelines = (): void => {
    if (disposed) return
    replace('pipelines', ctx.rpPipelines.list().map(pipeline => ({
      descriptor: {
        id: RpCapabilityId(`pipeline:${pipeline.id}`),
        kind: 'pipeline',
        version: pipeline.version,
        title: String(pipeline.id),
        description: pipeline.description,
        trust: pipeline.trust,
        scopes: ['conversation', 'scene', 'turn', 'agent'],
        permissions: pipeline.permissions,
        ...(pipeline.budget === undefined ? {} : { budget: pipeline.budget }),
        tags: ['rp', 'pipeline', pipeline.kind],
      },
      invoke: async (request) => {
        const result = await ctx.rpPipelines.run(pipeline.id, {
          scope: request.scope,
          input: request.input,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          budget: request.effectiveBudget,
          grantedPermissions: request.effectiveAuthority.permissions,
          grantedTrust: request.effectiveAuthority.trust,
          networkDomains: request.effectiveAuthority.networkDomains,
          fileRoots: request.effectiveAuthority.fileRoots,
        })
        return result.frame.values
      },
    })))
  }

  const workflowBackendContribution = (backend: RpWorkflowBackend): RpCapabilityContribution => ({
    descriptor: {
      id: RpCapabilityId(`workflow-backend:${backend.id}`),
      kind: 'pipeline',
      version: '1.0.0',
      title: `Workflow backend: ${backend.id}`,
      description: `Execute a bounded RP payload through the ${backend.kind} backend.`,
      trust: backend.trust,
      scopes: ['conversation', 'scene', 'turn', 'agent'],
      permissions: workflowPermissions(backend.trust),
      tags: ['rp', 'workflow-backend', backend.kind, ...backend.kinds],
    },
    invoke: async (request) => {
      const input = jsonObject(request.input, `workflow-backend:${backend.id}`)
      const kind = workflowKind(input.kind)
      if (!backend.kinds.includes(kind)) {
        throw new Error(`Workflow backend ${JSON.stringify(backend.id)} does not support ${kind}`)
      }
      const run = ctx.rpWorkflowRouter.start({
        kind,
        backend: backend.id,
        payload: input.payload ?? null,
        authority: request.effectiveAuthority,
        budget: request.effectiveBudget,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      const outcome = await run.result
      if (outcome.status !== 'completed') {
        throw new Error(`RP workflow ${run.id} ${outcome.status}: ${outcome.error ?? 'no diagnostic'}`)
      }
      return outcome.value ?? null
    },
  })

  const syncWorkflowBackends = (): void => {
    if (disposed) return
    replace('workflowBackends', ctx.rpWorkflowRouter.list().map(workflowBackendContribution))
  }

  ctx.effect(function* () {
    yield async () => {
      disposed = true
      await skillsTask
      for (const group of Object.values(groups)) {
        for (const dispose of group.splice(0).reverse()) dispose()
      }
    }
  }, 'rp-harness-bridge registrations')

  ctx.on('tools/change', syncTools)
  ctx.on('skills/change', scheduleSkills)
  ctx.on('subagent/provider-added', syncSubagents)
  ctx.on('subagent/provider-removed', syncSubagents)
  ctx.on('rp/pipelines-changed', syncPipelines)
  ctx.on('rp/workflow-backend-changed', syncWorkflowBackends)

  syncTools()
  syncSubagents()
  syncPipelines()
  syncWorkflowBackends()
  await syncSkills()
}

function workflowPermissions(trust: RpTrustLevel): readonly string[] {
  if (trust === 'L0') return []
  return trust === 'L1' ? ['script.execute'] : ['workflow.native']
}

function workflowKind(value: JsonValue | undefined): RpWorkflowKind {
  if (value === 'turn' || value === 'workflow' || value === 'sidecar') return value
  throw new Error('Workflow backend capability input.kind must be turn, workflow, or sidecar')
}

function jsonObject(value: JsonValue, capability: string): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${capability} input must be an object`)
  }
  return value
}

/** Render thrown values without permitting hostile coercion to replace the original failure. */
function renderError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
