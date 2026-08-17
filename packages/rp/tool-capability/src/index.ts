/** Model-facing least-authority bridge into the unified RP Capability Catalog. @module @dsh-rp/tool-capability */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { RpCapabilityId } from '@dsh-rp/contracts'
import type { RpBudget, RpTrustLevel } from '@dsh-rp/contracts'
import type { RpCapabilityAuthorityDecision } from '@dsh-rp/capability-catalog'
import type {} from '@dsh-rp/journal'

/** Cordis plugin name. */
export const name = 'rp-tool-capability'
/** Tool Registry and Capability Catalog required by the Agent bridge. */
export const inject = ['tools', 'rpCapabilities']

/** Deployment-owned ceiling for model-requested RP capability calls. */
export interface Config {
  /** Highest runtime trust an Agent may request through this tool. */
  readonly maxTrust?: RpTrustLevel
  /** Complete permission allowlist available to the Agent tool. */
  readonly permissions?: string[]
  /** Maximum elapsed time for one delegated capability invocation. */
  readonly timeoutMs?: number
  /** Network-domain allowlist; empty denies every network domain. */
  readonly networkDomains?: string[]
  /** Filesystem-root allowlist; empty denies every filesystem root. */
  readonly fileRoots?: string[]
}

/** Loader schema with deny-by-default script and native authority. */
export const Config: z<Config> = z.object({
  maxTrust: z.union(['L0', 'L1', 'L2'] as const).default('L0'),
  permissions: z.array(z.string()).default([]),
  timeoutMs: z.number().min(1).default(5_000),
  networkDomains: z.array(z.string()).default([]),
  fileRoots: z.array(z.string()).default([]),
})

interface ResolvedConfig {
  readonly maxTrust: RpTrustLevel
  readonly permissions: readonly string[]
  readonly budget: RpBudget
  readonly networkDomains: readonly string[]
  readonly fileRoots: readonly string[]
}

/** Register one model tool for filtered discovery and policy-enforced invocation. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.tools.register(defineTool({
    name: 'rp_capability',
    description: 'List executable RP capabilities allowed for this Agent, or invoke one through the '
      + 'Capability Catalog. Use action=list before action=invoke. The Host, plugin, user, Agent, and '
      + 'single-call policy intersection is authoritative; this tool cannot grant itself more access.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'invoke'] },
      capability_id: { type: 'string', description: 'Exact id returned by action=list.' },
      input: { type: 'json', description: 'JSON input declared by the selected capability.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const activeAgent = exec.agent
      if (activeAgent === undefined) throw new Error('rp_capability requires an Agent-owned tool call')
      const agentId = String(activeAgent.id)
      const session = activeAgent.session
      const scope = { kind: 'agent' as const, id: agentId }
      if (args.action === 'list') {
        return ctx.rpCapabilities.list({
          scope: 'agent',
          permittedBy: resolved.permissions,
          trustedBy: resolved.maxTrust,
        }).filter(capability => ctx.rpCapabilities.isExecutable(capability.id)).map(capability => ({
          id: String(capability.id),
          kind: capability.kind,
          title: capability.title,
          description: capability.description,
          trust: capability.trust,
          permissions: [...capability.permissions ?? []],
          ...(capability.inputSchema === undefined ? {} : { inputSchema: capability.inputSchema }),
        }))
      }
      if (args.capability_id === undefined || args.capability_id.trim() === '') {
        throw new Error('rp_capability action=invoke requires capability_id')
      }
      const capabilityId = RpCapabilityId(args.capability_id)
      const callId = String(exec.callId)
      try {
        const result = await ctx.rpCapabilities.invoke(capabilityId, {
          scope,
          input: args.input ?? null,
          grantedPermissions: resolved.permissions,
          grantedTrust: resolved.maxTrust,
          budget: resolved.budget,
          networkDomains: resolved.networkDomains,
          fileRoots: resolved.fileRoots,
          policyLayers: [{
            name: 'agent-tool-config',
            permissions: resolved.permissions,
            maxTrust: resolved.maxTrust,
            budget: resolved.budget,
            networkDomains: resolved.networkDomains,
            fileRoots: resolved.fileRoots,
          }],
          signal: exec.signal,
          onAuthorized: (authority) => {
            appendAuthorized(callId, String(capabilityId), authority)
          },
        })
        session.append('rp/capability-settled', {
          schemaVersion: 1,
          callId,
          capabilityId: String(capabilityId),
          agentId,
          status: 'completed',
          finishedAt: Date.now(),
        })
        return result
      } catch (error: unknown) {
        session.append('rp/capability-settled', {
          schemaVersion: 1,
          callId,
          capabilityId: String(capabilityId),
          agentId,
          status: session.events.some(event =>
            event.type === 'rp/capability-authorized' && event.data.callId === callId)
            ? 'failed'
            : 'denied',
          error: renderError(error),
          finishedAt: Date.now(),
        })
        throw error
      }

      function appendAuthorized(
        callId: string,
        id: string,
        authority: RpCapabilityAuthorityDecision,
      ): void {
        session.append('rp/capability-authorized', {
          schemaVersion: 1,
          callId,
          capabilityId: id,
          agentId,
          scope,
          authority,
          authorizedAt: Date.now(),
        })
      }
    },
  }))
}

function resolveConfig(config: Config): ResolvedConfig {
  const timeoutMs = config.timeoutMs ?? 5_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('rp-tool-capability timeoutMs must be positive')
  }
  return Object.freeze({
    maxTrust: config.maxTrust ?? 'L0',
    permissions: Object.freeze(normalize(config.permissions ?? [])),
    budget: Object.freeze({ timeoutMs }),
    networkDomains: Object.freeze(normalize(config.networkDomains ?? [])),
    fileRoots: Object.freeze(normalize(config.fileRoots ?? [])),
  })
}

function normalize(values: readonly string[]): string[] {
  if (values.some(value => value.trim() === '' || value !== value.trim())) {
    throw new Error('rp-tool-capability allowlists require non-empty normalized values')
  }
  return [...new Set(values)].sort()
}

function renderError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
